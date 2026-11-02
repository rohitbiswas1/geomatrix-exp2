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


@router.post("/upload", response_model=IngestResult)
async def upload_csv(
    file: UploadFile = File(...),
    data_type: str = Query("projects", description="'projects' or 'historical'"),
    db: Session = Depends(get_db)
):
    """
    Upload a CSV file to import project data or historical labeled records.

    For 'projects': columns should include name, state, district, authority,
                    project_type, latitude, longitude, land_required, affected_families,
                    current_stage, status

    For 'historical': columns should include project_code, state, project_type,
                      land_area_ha, affected_families, pending_claims, legal_cases,
                      doc_completeness_pct, approval_pending, rr_pending,
                      overdue_milestones, actual_delay_days, delayed
    """
    filename = file.filename or "upload"
    source_url = f"file_upload:{filename}"
    source_name = filename
    log_entry = _log_start(db, f"csv_{data_type}", source_url)

    if not (filename.endswith(".csv") or filename.endswith(".json")):
        raise HTTPException(400, "Only CSV or JSON files accepted")

    content = await file.read()

    errors: List[str] = []
    saved = skipped = 0
    rows = []

    try:
        if filename.endswith(".json"):
            payload = json.loads(content.decode("utf-8-sig"))
            rows = _extract_rows_from_payload(payload)
        else:
            text = content.decode("utf-8-sig")
            reader = csv.DictReader(io.StringIO(text))
            rows = list(reader)
    except Exception as e:
        errors.append(f"File parse error: {str(e)}")
        _log_finish(db, log_entry, 0, 0, 0, errors, "failed")
        return IngestResult(source=f"csv_{data_type}", records_fetched=0,
                            records_saved=0, records_skipped=0, errors=errors, status="failed")

    for i, row in enumerate(rows):
        try:
            if data_type == "historical":
                project_code = _field_value(row, "project_code", "project_id", "source_record_id", "id")
                state = _field_value(row, "state", "state_or_region", "state_name")
                project_type = _field_value(row, "project_type", "sector")
                if project_code is None or state is None or project_type is None:
                    errors.append(f"Row {i+2}: missing required historical fields")
                    skipped += 1
                    continue

                actual_days_value = _field_value(row, "actual_delay_days", "days_to_original_deadline", "delay_days", "delay_months_original")
                delayed_value = _field_value(row, "delayed", "delay_flag", "land_acquisition_delay_flag")
                if delayed_value is None:
                    errors.append(f"Row {i+2}: missing delayed label")
                    skipped += 1
                    continue

                record_id = _normalize_string(_field_value(row, "source_record_id", "id", "project_code", "project_id"))
                if not record_id:
                    errors.append(f"Row {i+2}: missing source_record_id")
                    skipped += 1
                    continue

                existing = db.query(HistoricalDelayRecord).filter_by(source_record_id=record_id).first()
                if existing:
                    skipped += 1
                    continue

                actual_days = _coerce_int(actual_days_value, default=0)
                if _field_value(row, "actual_delay_days") is None and _field_value(row, "delay_months_original") is not None:
                    months = _coerce_int(_field_value(row, "delay_months_original"), default=0)
                    if months > 0:
                        actual_days = months * 30

                delayed = _coerce_bool(delayed_value)
                if delayed is None:
                    errors.append(f"Row {i+2}: delayed must be an explicit boolean label")
                    skipped += 1
                    continue

                approval_pending = _coerce_bool(_field_value(row, "approval_pending", "approval_pending_flag"))
                if approval_pending is None:
                    approval_pending = None  # Missing inputs must never be inferred from the target label.

                classification = _classification_for_source(source_name)

                rec = HistoricalDelayRecord(
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
                saved += 1

            else:  # projects
                project_code = _field_value(row, "project_code", "project_id", "source_record_id", "id")
                name = _field_value(row, "name", "project_name", "canonical_project_name", "source_project_name")
                state = _field_value(row, "state", "state_or_region", "state_name")
                project_type = _field_value(row, "project_type", "sector")
                authority = _field_value(row, "authority", "implementing_agency", "agency")

                if project_code is None or name is None or state is None or project_type is None:
                    errors.append(f"Row {i+2}: missing required project fields")
                    skipped += 1
                    continue

                record_id = _normalize_string(_field_value(row, "source_record_id", "id", "project_id", "project_code"))
                if not record_id:
                    errors.append(f"Row {i+2}: missing project identifier")
                    skipped += 1
                    continue

                existing = db.query(Project).filter_by(source_record_id=record_id).first()
                if existing:
                    skipped += 1
                    continue

                lat_raw = _field_value(row, "latitude", "lat")
                lng_raw = _field_value(row, "longitude", "lon", "lng")
                lat, lng = _validate_coordinates(lat_raw, lng_raw)

                classification = _classification_for_source(source_name)

                proj = Project(
                    id=str(uuid.uuid4()),
                    project_code=_normalize_string(project_code)[:50],
                    name=_normalize_string(name)[:200],
                    state=_normalize_string(state)[:100],
                    district=_normalize_string(_field_value(row, "district", "district_name"))[:100] or "Unknown",
                    authority=_normalize_string(authority)[:200] or "Unknown",
                    project_type=_normalize_string(project_type)[:100],
                    latitude=lat,
                    longitude=lng,
                    current_stage=_normalize_string(_field_value(row, "current_stage", "stage", "current_acquisition_stage"))[:100] or "Unknown",
                    status=_normalize_string(_field_value(row, "status", "project_status"))[:50] or "Active",
                    land_required=_coerce_float(_field_value(row, "land_required", "land_required_ha", "land_area_ha")),
                    land_acquired=_coerce_float(_field_value(row, "land_acquired", "land_acquired_ha")),
                    affected_families=_coerce_int(_field_value(row, "affected_families", "families_affected")),
                    compensation_status=_normalize_string(_field_value(row, "compensation_status", "compensation_issue"))[:50] or None,
                    objection_count=_coerce_int(_field_value(row, "objection_count", "public_objection_issue")),
                    legal_case_count=_coerce_int(_field_value(row, "legal_case_count", "legal_issue")),
                    rr_status=_normalize_string(_field_value(row, "rr_status", "rr_amount_cr"))[:50] or None,
                    env_clearance_status=_normalize_string(_field_value(row, "env_clearance_status", "environment_clearance_status"))[:50] or None,
                    forest_clearance_status=_normalize_string(_field_value(row, "forest_clearance_status", "forest_clearance_issue"))[:50] or None,
                    crz_status=_normalize_string(_field_value(row, "crz_status"))[:50] or None,
                    doc_completeness_pct=_coerce_float(_field_value(row, "doc_completeness_pct", "physical_progress_pct"), default=50.0),
                    approval_pending=_coerce_bool(_field_value(row, "approval_pending", "approval_issue")),
                    overdue_milestones=_coerce_int(_field_value(row, "overdue_milestones", "days_to_original_deadline")),
                    validation_status="validated",
                    data_classification=classification,
                    source_name=source_name,
                    source_url=source_url,
                    source_record_id=record_id,
                )
                db.add(proj)
                saved += 1

        except Exception as e:
            errors.append(f"Row {i+2}: {str(e)[:100]}")
            skipped += 1

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        errors.append(f"DB commit error: {str(e)[:100]}")

    status = "success" if not errors else "partial"
    _log_finish(db, log_entry, len(rows), saved, skipped, errors, status)

    return IngestResult(source=f"csv_{data_type}", records_fetched=len(rows),
                        records_saved=saved, records_skipped=skipped,
                        errors=errors, status=status)


@router.get("/log", response_model=list[IngestionLogOut])
def get_ingestion_log(limit: int = 20, db: Session = Depends(get_db)):
    """Return recent data ingestion history."""
    entries = (db.query(DataIngestionLog)
               .order_by(DataIngestionLog.started_at.desc())
               .limit(limit).all())
    return entries
