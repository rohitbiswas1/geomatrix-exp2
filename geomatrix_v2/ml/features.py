"""
Geomatrix v2 ML Feature Engineering
Extracts real features from project records for model training/prediction.
All features map directly to stored project/historical fields — no fabrication.
"""
import pandas as pd
from typing import Dict, Any


FEATURE_COLUMNS = [
    "land_area_ha",
    "affected_families",
    "pending_claims",        # objection_count from project / pending_claims from historical
    "legal_cases",           # legal_case_count from project / legal_cases from historical
    "doc_completeness_pct",
    "approval_pending",
    "rr_pending",            # rr_status == "Pending" from project / rr_pending from historical
    "overdue_milestones",
    "compensation_pending",  # compensation_status == "Pending" from project
    "env_clearance_pending", # env_clearance_status == "Pending" OR forest/crz pending
]

# Required fields that must be present for a reliable prediction.
# Optional status fields are allowed to be absent because the feature builder
# safely defaults them to zero/False when the project is otherwise valid.
PREDICTION_REQUIRED_FIELDS = [
    "land_required",
    "affected_families",
    "current_stage",
]

LABEL_COLUMN = "delayed"
REGRESSION_LABEL = "actual_delay_days"


def build_feature_vector(record: Dict[str, Any]) -> Dict[str, float]:
    """Convert a project/historical record dict into a flat feature vector.
    
    Maps both Project model fields AND historical record fields to the
    same canonical feature names used by the trained model.
    """
    # Land area: accept both field name variants
    land_area = float(
        record.get("land_area_ha")
        or record.get("land_required")
        or 0
    )

    # Pending claims / objection count
    pending_claims = float(
        record.get("pending_claims")
        or record.get("objection_count")
        or 0
    )

    # Legal cases
    legal_cases = float(
        record.get("legal_cases")
        or record.get("legal_case_count")
        or 0
    )

    # R&R pending — both int count (historical) and status string (project)
    rr_raw = record.get("rr_pending") or record.get("rr_status")
    if isinstance(rr_raw, int):
        rr_pending = float(rr_raw)
    elif isinstance(rr_raw, str):
        rr_pending = 1.0 if rr_raw.lower() == "pending" else 0.0
    else:
        rr_pending = 0.0

    # Approval pending — bool or string
    approval_raw = record.get("approval_pending")
    if isinstance(approval_raw, bool):
        approval_pending = 1.0 if approval_raw else 0.0
    elif isinstance(approval_raw, str):
        approval_pending = 1.0 if approval_raw.lower() in {"true", "yes", "1", "pending"} else 0.0
    else:
        approval_pending = 0.0

    # Compensation pending — bool from historical or status string from project
    comp_raw = record.get("compensation_pending") or record.get("compensation_status")
    if isinstance(comp_raw, bool):
        compensation_pending = 1.0 if comp_raw else 0.0
    elif isinstance(comp_raw, str):
        compensation_pending = 1.0 if comp_raw.lower() in {"pending", "disputed"} else 0.0
    else:
        compensation_pending = 0.0

    # Environmental/Forest/CRZ clearance pending (any pending = risk)
    env_raw = record.get("env_clearance_status", "")
    forest_raw = record.get("forest_clearance_status", "")
    crz_raw = record.get("crz_status", "")
    env_clearance_pending = 1.0 if any(
        str(v).lower() == "pending"
        for v in [env_raw, forest_raw, crz_raw]
    ) else 0.0

    # Documentation completeness
    doc_pct = float(record.get("doc_completeness_pct", 50.0) or 50.0)

    # Overdue milestones
    overdue = float(record.get("overdue_milestones", 0) or 0)

    # Affected families
    families = float(record.get("affected_families", 0) or 0)

    return {
        "land_area_ha": land_area,
        "affected_families": families,
        "pending_claims": pending_claims,
        "legal_cases": legal_cases,
        "doc_completeness_pct": doc_pct,
        "approval_pending": approval_pending,
        "rr_pending": rr_pending,
        "overdue_milestones": overdue,
        "compensation_pending": compensation_pending,
        "env_clearance_pending": env_clearance_pending,
    }


def validate_prediction_inputs(record: Dict[str, Any]) -> list[str]:
    """Return list of missing required fields for prediction."""
    missing = []
    for field in PREDICTION_REQUIRED_FIELDS:
        val = record.get(field)
        observed = record.get("observed_fields")
        if val is None or val == "" or val == [] or (isinstance(observed, list) and field not in observed):
            missing.append(field)
    return missing


def build_feature_dataframe(records: list) -> pd.DataFrame:
    """Build a DataFrame of feature vectors from a list of record dicts."""
    rows = [build_feature_vector(r) for r in records]
    return pd.DataFrame(rows, columns=FEATURE_COLUMNS)
