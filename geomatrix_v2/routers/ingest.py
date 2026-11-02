"""
Geomatrix v2 Data Ingestion Router
Handles CSV uploads and data.gov.in fetches.
Every record is stored with source_url, source_record_id, imported_at.
"""
import csv
import io
import json
import uuid
import logging
import math
from typing import Literal
from sqlalchemy import or_, and_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from datetime import datetime
from typing import List, Any, Dict

import httpx
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import Project, HistoricalDelayRecord, DataIngestionLog
from schemas import IngestResult, IngestionLogOut

router = APIRouter(prefix="/api/ingest", tags=["ingestion"])
logger = logging.getLogger(__name__)

REQUIRED_PROJECT_FIELDS = ["project_code", "name", "state", "district", "authority", "project_type"]
REQUIRED_HISTORICAL_FIELDS = ["project_code", "state", "project_type", "actual_delay_days", "delayed"]


def _normalize_string(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value).strip()


def _coerce_float(value: Any, *, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_int(value: Any, *, default: int = 0) -> int:
    if value is None or value == "":
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _coerce_bool(value: Any) -> bool | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "real"}:
        return True
    if text in {"0", "false", "no", "n", "test"}:
        return False
    return None


def _validate_coordinates(lat: Any, lng: Any) -> tuple[float | None, float | None]:
    try:
        lat_value = float(lat) if lat not in (None, "", " ") else None
        lng_value = float(lng) if lng not in (None, "", " ") else None
    except (TypeError, ValueError):
        return None, None

    if lat_value is not None and not (-90.0 <= lat_value <= 90.0):
        return None, lng_value
    if lng_value is not None and not (-180.0 <= lng_value <= 180.0):
        return lat_value, None
    return lat_value, lng_value


def _classification_for_record(row: dict, source_name: str) -> str:
    if _classification_for_source(source_name) != "REAL":
        return "TEST"
    explicit = str(_field_value(row, "data_classification") or "REAL").strip().upper()
    return explicit if explicit in {"REAL", "TEST", "TEST/SYNTHETIC", "SYNTHETIC"} else "UNKNOWN"


def _classification_for_source(source_name: str) -> str:
    name = (source_name or "").lower()
    if "test" in name or "sample" in name or "demo" in name:
        return "TEST"
    return "REAL"


def _extract_rows_from_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        if "records" in payload and isinstance(payload["records"], list):
            return [row for row in payload["records"] if isinstance(row, dict)]
        return [payload]
    return []


def _has_required_fields(row: Dict[str, Any], required: list[str]) -> bool:
    for field in required:
        if row.get(field) in (None, ""):
            return False
    return True


def _field_value(row: Dict[str, Any], *candidates: str) -> Any:
    norm_row = {str(k).strip().lstrip('\ufeff').lower(): v for k, v in row.items() if k is not None}
    for field in candidates:
        target = field.strip().lower()
        if target in norm_row:
            value = norm_row[target]
            if value not in (None, ""):
                return value
    return None


# Public data.gov.in API endpoint for land acquisition data
DATAGOVIN_BASE = "https://api.data.gov.in/resource"

# Known public resource IDs on data.gov.in (infrastructure/land acquisition)
DATAGOVIN_RESOURCES = {
    "land_acquisition": "9ef84268-d588-465a-a308-a864a43d0070",  # NH land acquisition
    "infrastructure": "65f7ced4-ee4c-4b96-b9f0-d01038e49099",   # infra project data
}


def _log_start(db: Session, source: str, source_url: str) -> DataIngestionLog:
    entry = DataIngestionLog(
        id=str(uuid.uuid4()),
        source=source,
        source_name=source,
        source_url=source_url,
        started_at=datetime.utcnow(),
        status="running",
    )
    db.add(entry)
    db.commit()
    return entry


def _log_finish(db: Session, entry: DataIngestionLog,
                fetched: int, saved: int, skipped: int, errors: list, status: str):
    entry.finished_at = datetime.utcnow()
    entry.records_fetched = fetched
    entry.records_saved = saved
    entry.records_skipped = skipped
    entry.errors = errors[:20]  # cap errors stored
    entry.status = status
    db.commit()


@router.post("/datagovIn", response_model=IngestResult)
async def ingest_from_datagovin(
    source: str = Query("land_acquisition", description="Resource key"),
    limit: int = Query(50, ge=1, le=200),
    api_key: str = Query("579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b",
                          description="data.gov.in API key (public test key)"),
    db: Session = Depends(get_db)
):
    """Fetch real project data from data.gov.in open APIs."""
    resource_id = DATAGOVIN_RESOURCES.get(source)
    if not resource_id:
        raise HTTPException(400, f"Unknown source '{source}'. Valid: {list(DATAGOVIN_RESOURCES)}")

    url = f"{DATAGOVIN_BASE}/{resource_id}?api-key={api_key}&format=json&limit={limit}"
    log_entry = _log_start(db, "datagovIn", url)

    errors: List[str] = []
    saved = skipped = 0
    records_raw = []

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
            records_raw = data.get("records", [])
            logger.info(f"data.gov.in returned {len(records_raw)} records")
    except httpx.HTTPStatusError as e:
        errors.append(f"HTTP {e.response.status_code}: {str(e)[:200]}")
        _log_finish(db, log_entry, 0, 0, 0, errors, "failed")
        return IngestResult(source="datagovIn", records_fetched=0, records_saved=0,
                            records_skipped=0, errors=errors, status="failed")
    except Exception as e:
        errors.append(f"Network error: {str(e)[:200]}")
        _log_finish(db, log_entry, 0, 0, 0, errors, "failed")
        return IngestResult(source="datagovIn", records_fetched=0, records_saved=0,
                            records_skipped=0, errors=errors, status="failed")

    for rec in records_raw:
        try:
            # Map common data.gov.in field names — adapt per dataset schema
            record_id = str(rec.get("id") or rec.get("_id") or rec.get("project_id") or uuid.uuid4())
            name = str(rec.get("project_name") or rec.get("name") or rec.get("scheme_name") or "Unknown Project")
            state = str(rec.get("state") or rec.get("state_name") or "Unknown")
            district = str(rec.get("district") or rec.get("district_name") or "Unknown")
            authority = str(rec.get("authority") or rec.get("agency") or rec.get("implementing_agency") or "Unknown")
            project_type = str(rec.get("project_type") or rec.get("type") or "Infrastructure")

            # Coordinates
            try:
                lat = float(rec.get("latitude") or rec.get("lat") or 0)
                lng = float(rec.get("longitude") or rec.get("lon") or rec.get("lng") or 0)
            except (ValueError, TypeError):
                lat = lng = None

            # Skip if already imported
            existing = db.query(Project).filter_by(source_record_id=record_id).first()
            if existing:
                skipped += 1
                continue

            proj = Project(
                id=str(uuid.uuid4()),
                project_code=f"DGI-{record_id[:8].upper()}",
                name=name[:200],
                state=state,
                district=district,
                authority=authority,
                project_type=project_type,
                latitude=lat if lat else None,
                longitude=lng if lng else None,
                current_stage=str(rec.get("stage") or rec.get("current_stage") or "Unknown"),
                status=str(rec.get("status") or "Active"),
                land_required=float(rec.get("land_required") or rec.get("land_area") or 0),
                land_acquired=float(rec.get("land_acquired") or 0),
                affected_families=int(float(rec.get("affected_families") or rec.get("families") or 0)),
                source_url=url,
                source_record_id=record_id,
                imported_at=datetime.utcnow(),
            )
            db.add(proj)
            saved += 1
        except Exception as e:
            errors.append(f"Record parse error: {str(e)[:100]}")
            skipped += 1

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        errors.append(f"DB commit error: {str(e)[:100]}")

    status = "success" if not errors else "partial"
    _log_finish(db, log_entry, len(records_raw), saved, skipped, errors, status)

    logger.info(f"data.gov.in ingest complete: fetched={len(records_raw)} saved={saved} skipped={skipped}")
    return IngestResult(source="datagovIn", records_fetched=len(records_raw),
                        records_saved=saved, records_skipped=skipped,
                        errors=errors, status=status)




def _save_historical_row(db, row, source_name, source_url, errors, row_number):
    project_code = _field_value(row, "project_code", "project_id", "source_record_id", "id")
    state = _field_value(row, "state", "state_or_region", "state_name")
    project_type = _field_value(row, "project_type", "sector")
    if project_code is None or state is None or project_type is None:
        errors.append(f"Row {row_number}: missing required historical fields")
        return False

    actual_days_value = _field_value(row, "actual_delay_days", "days_to_original_deadline", "delay_days", "delay_months_original")
    delayed_value = _field_value(row, "delayed", "delay_flag", "land_acquisition_delay_flag")
    if delayed_value is None:
        errors.append(f"Row {row_number}: missing delayed label")
        return False

    record_id = _normalize_string(_field_value(row, "source_record_id", "id", "project_code", "project_id"))
    if not record_id:
        errors.append(f"Row {row_number}: missing source_record_id")
        return False

    existing = db.query(HistoricalDelayRecord).filter_by(source_record_id=record_id).first()
    if existing and existing.training_data_version >= 2:
        return False

    actual_days = _coerce_int(actual_days_value, default=0)
    if _field_value(row, "actual_delay_days") is None and _field_value(row, "delay_months_original") is not None:
        months = _coerce_int(_field_value(row, "delay_months_original"), default=0)
        if months > 0:
            actual_days = months * 30

    delayed = _coerce_bool(delayed_value)
    if delayed is None:
        errors.append(f"Row {row_number}: delayed must be an explicit boolean label")
        return False

    approval_pending = _coerce_bool(_field_value(row, "approval_pending", "approval_pending_flag"))
    if approval_pending is None:
        approval_pending = None  # Missing inputs must never be inferred from the target label.

    classification = _classification_for_record(row, source_name)

    if existing:
        # Replace legacy data using the original source, not by trying
        # to guess which stored feature values were derived from labels.
        db.delete(existing)
    rec = HistoricalDelayRecord(
        training_data_version=2,
        id=str(uuid.uuid4()),
        project_code=_normalize_string(project_code)[:50],
        state=_normalize_string(state)[:100],
        project_type=_normalize_string(project_type)[:100],
        land_area_ha=_coerce_float(_field_value(row, "land_area_ha", "land_required_ha", "land_required")),
        affected_families=_coerce_int(_field_value(row, "affected_families", "families_affected", "families")),
        pending_claims=_coerce_int(_field_value(row, "pending_claims", "objection_count", "claims_pending")),
        legal_cases=_coerce_int(_field_value(row, "legal_cases", "case_count", "court_cases")),
        doc_completeness_pct=_coerce_float(_field_value(row, "doc_completeness_pct", "document_completeness_pct", "physical_progress_pct"), default=50.0),
        approval_pending=approval_pending,
        rr_pending=_coerce_int(_field_value(row, "rr_pending", "rr_pending_count")),
        overdue_milestones=_coerce_int(_field_value(row, "overdue_milestones", "overdue_milestone_count")),
        actual_delay_days=actual_days,
        delayed=delayed,
        validation_status="validated",
        data_classification=classification,
        source_name=source_name,
        source_url=source_url,
        source_record_id=record_id,
    )
    db.add(rec)
    return True


MAX_UPLOAD_BYTES = 4 * 1024 * 1024
MAX_UPLOAD_ROWS = 5000


def _upload_number(row, *fields, default=0.0, integer=False, minimum=0, maximum=None):
    raw = _field_value(row, *fields)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        value = float(str(raw).replace(",", "").strip())
    except (TypeError, ValueError):
        raise ValueError(f"{fields[0]} must be a number") from None
    if not math.isfinite(value) or (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
        raise ValueError(f"{fields[0]} is outside the permitted range")
    if integer and not value.is_integer():
        raise ValueError(f"{fields[0]} must be a whole number")
    return int(value) if integer else value


def _build_project_row(row, source_name, source_url, warnings):
    code = _normalize_string(_field_value(row, "project_code", "project_id", "source_record_id", "id"))
    name = _normalize_string(_field_value(row, "name", "project_name", "canonical_project_name", "source_project_name"))
    state = _normalize_string(_field_value(row, "state", "state_or_region", "state_name"))
    missing = [label for label, value in [("project_code (or project_id)", code), ("name (or project_name)", name), ("state", state)] if not value]
    if missing:
        raise ValueError("missing required fields: " + ", ".join(missing))
    record_id = _normalize_string(_field_value(row, "source_record_id", "project_code", "project_id", "id"))

    project_type = _normalize_string(_field_value(row, "project_type", "sector"))
    if not project_type:
        warnings.add("Missing project_type values were stored as Unknown. You can edit these projects later.")
    area = _upload_number(row, "land_required", "land_required_ha", "land_area_ha", default=None)
    if area is None:
        acres = _upload_number(row, "land_area_acres", default=None)
        area = acres * 0.40468564224 if acres is not None else 0.0
        if acres is not None:
            warnings.add("land_area_acres was converted to hectares for land_required.")
    if _field_value(row, "risk_level", "risk_score") is not None:
        warnings.add("Uploaded risk labels are not treated as model predictions. Run risk analysis after importing.")
    lat = _upload_number(row, "latitude", "lat", default=None, minimum=-90, maximum=90)
    lng = _upload_number(row, "longitude", "lon", "lng", default=None, minimum=-180, maximum=180)
    project = Project(
        id=str(uuid.uuid4()), project_code=code, name=name, state=state,
        district=_normalize_string(_field_value(row, "district", "district_name")) or "Unknown",
        authority=_normalize_string(_field_value(row, "authority", "implementing_agency", "agency")) or "Unknown",
        project_type=project_type or "Unknown",
        description=_normalize_string(_field_value(row, "description")) or None,
        latitude=lat, longitude=lng, land_required=area,
        land_acquired=_upload_number(row, "land_acquired", "land_acquired_ha"),
        affected_families=_upload_number(row, "affected_families", "families_affected", integer=True, default=0),
        current_stage=_normalize_string(_field_value(row, "current_stage", "stage", "current_acquisition_stage")) or "Unknown",
        status=_normalize_string(_field_value(row, "status", "project_status")) or "Active",
        compensation_status=_normalize_string(_field_value(row, "compensation_status", "compensation_issue")) or None,
        objection_count=_upload_number(row, "objection_count", "public_objection_issue", integer=True, default=0),
        legal_case_count=_upload_number(row, "legal_case_count", "legal_cases", "legal_disputes_count", "legal_issue", integer=True, default=0),
        rr_status=_normalize_string(_field_value(row, "rr_status")) or None,
        env_clearance_status=_normalize_string(_field_value(row, "env_clearance_status", "environment_clearance_status", "environmental_clearance")) or None,
        forest_clearance_status=_normalize_string(_field_value(row, "forest_clearance_status", "forest_clearance_issue")) or None,
        crz_status=_normalize_string(_field_value(row, "crz_status")) or None,
        doc_completeness_pct=_upload_number(row, "doc_completeness_pct", "physical_progress_pct", default=50.0, maximum=100),
        approval_pending=_coerce_bool(_field_value(row, "approval_pending", "approval_issue")),
        overdue_milestones=_upload_number(row, "overdue_milestones", integer=True, default=0),
        validation_status="validated", data_classification=_classification_for_record(row, source_name),
        source_name=source_name, source_url=source_url, source_record_id=record_id,
    )
    return project


def _store_project_rows(db, rows, filename, source_url, warnings, errors, extension):
    pending = []
    failed = duplicates = saved = 0
    for index, row in enumerate(rows):
        number = index + 2 if extension == "csv" else index + 1
        try:
            if None in row:
                raise ValueError("extra values do not match the CSV header; quote values containing commas")
            pending.append((number, _build_project_row(row, filename, source_url, warnings)))
        except (ValueError, TypeError, OverflowError) as exc:
            errors.append(f"Row {number}: {exc}")
            failed += 1

    codes = [p.project_code for _, p in pending]
    source_ids = [p.source_record_id for _, p in pending]
    known_codes, known_sources = set(), set()
    for start in range(0, len(pending), 200):
        existing = db.query(Project.project_code, Project.source_record_id, Project.source_name).filter(
            or_(Project.project_code.in_(codes[start:start + 200]),
                and_(Project.source_record_id.in_(source_ids[start:start + 200]), Project.source_name == filename))).all()
        for code, record_id, source_name in existing:
            known_codes.add(code)
            known_sources.add((record_id, source_name))
    unique = []
    for number, project in pending:
        identity = (project.source_record_id, filename)
        if project.project_code in known_codes or identity in known_sources:
            duplicates += 1
        else:
            known_codes.add(project.project_code)
            known_sources.add(identity)
            unique.append((number, project))

    # Most files need one batch insert rather than a round trip for every row.
    for start in range(0, len(unique), 100):
        batch = unique[start:start + 100]
        try:
            with db.begin_nested():
                db.add_all([project for _, project in batch])
                db.flush()
            saved += len(batch)
        except IntegrityError:
            # Handle a concurrent upload winning a unique code without dropping
            # the other valid records in this batch.
            for number, project in batch:
                try:
                    with db.begin_nested():
                        db.add(project)
                        db.flush()
                    saved += 1
                except IntegrityError as exc:
                    if getattr(exc.orig, "sqlstate", None) == "23505" or "UNIQUE constraint failed" in str(exc.orig):
                        duplicates += 1
                    else:
                        failed += 1
                        errors.append(f"Row {number}: could not save this record. Check its field values.")
    return saved, duplicates, failed


@router.post("/upload", response_model=IngestResult)
async def upload_csv(
    file: UploadFile = File(...),
    data_type: Literal["projects", "historical"] = Query("projects"),
    db: Session = Depends(get_db),
):
    """Import CSV/JSON records, returning only counts of rows actually committed."""
    filename = file.filename or "upload"
    extension = filename.rsplit(".", 1)[-1].lower()
    if extension not in {"csv", "json"}:
        raise HTTPException(400, "Choose a CSV or JSON records file. Save Excel sheets as CSV first.")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Files must be 4 MB or smaller. Split larger files before uploading.")
    source_url = f"file_upload:{filename}"
    log_entry = _log_start(db, f"csv_{data_type}", source_url)
    errors, warnings = [], set()
    try:
        text = content.decode("utf-8-sig")
        if extension == "json":
            payload = json.loads(text)
            rows = payload.get("records") if isinstance(payload, dict) and "records" in payload else payload
            if isinstance(rows, dict):
                rows = [rows]
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ValueError("JSON must contain a list of record objects or an object with a records list.")
        else:
            try:
                dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t")
            except csv.Error:
                dialect = csv.excel
            reader = csv.DictReader(io.StringIO(text, newline=""), dialect=dialect, strict=True)
            rows = [row for row in reader if any(str(v).strip() for v in row.values() if v is not None)]
        if not rows:
            raise ValueError("No records found. Include a header and at least one data row.")
        if len(rows) > MAX_UPLOAD_ROWS:
            raise ValueError(f"Upload at most {MAX_UPLOAD_ROWS} records at a time.")
    except (UnicodeError, ValueError, csv.Error) as exc:
        message = "Save the file as UTF-8 CSV or JSON." if isinstance(exc, UnicodeError) else str(exc)
        errors = ["File could not be read: " + message]
        _log_finish(db, log_entry, 0, 0, 0, errors, "failed")
        return IngestResult(source=f"csv_{data_type}", records_fetched=0, records_saved=0,
                            records_skipped=0, errors=errors, status="failed")

    saved = duplicates = failed = 0
    try:
        connection = db.connection()
        # sqlite3's legacy mode otherwise commits a top-level SAVEPOINT when
        # released, preventing an outer rollback from undoing the upload.
        if connection.dialect.name == "sqlite" and not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN")
        if data_type == "projects":
            saved, duplicates, failed = _store_project_rows(db, rows, filename, source_url, warnings, errors, extension)
        else:
            for index, row in enumerate(rows):
                row_number = index + 2 if extension == "csv" else index + 1
                before = len(errors)
                try:
                    if None in row:
                        raise ValueError("extra values do not match the CSV header; quote values containing commas")
                    with db.begin_nested():
                        imported = _save_historical_row(db, row, filename, source_url, errors, row_number)
                        db.flush()
                    if imported:
                        saved += 1
                    elif len(errors) > before:
                        failed += 1
                    else:
                        duplicates += 1
                except IntegrityError:
                    # A concurrent upload can win the unique project-code constraint.
                    duplicates += 1
                except ValueError as exc:
                    errors.append(f"Row {row_number}: {exc}")
                    failed += 1
                except (SQLAlchemyError, TypeError, OverflowError) as exc:
                    logger.error("Upload row failed: %s", type(exc).__name__)
                    errors.append(f"Row {row_number}: could not save this record. Check its field values and retry.")
                    failed += 1
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        logger.error("Upload commit failed: %s", type(exc).__name__)
        saved, duplicates, failed = 0, 0, len(rows)
        errors = ["Database save failed. No records were imported. Please retry the upload."]
    status = "failed" if failed and not saved else "partial" if failed else "success"
    skipped = duplicates + failed
    _log_finish(db, log_entry, len(rows), saved, skipped, errors, status)
    return IngestResult(source=f"csv_{data_type}", records_fetched=len(rows), records_saved=saved,
                        records_skipped=skipped, records_duplicated=duplicates, records_failed=failed,
                        errors=errors[:20], warnings=sorted(warnings), status=status)


@router.get("/log", response_model=list[IngestionLogOut])
def get_ingestion_log(limit: int = 20, db: Session = Depends(get_db)):
    """Return recent data ingestion history."""
    entries = (db.query(DataIngestionLog)
               .order_by(DataIngestionLog.started_at.desc())
               .limit(limit).all())
    return entries
