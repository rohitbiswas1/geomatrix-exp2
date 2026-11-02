"""Pydantic schemas for Geomatrix v2 API."""
from __future__ import annotations
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


# ── Project ──────────────────────────────────────────────────────────────────

class ProjectOut(BaseModel):
    id: str
    project_code: str
    name: str
    state: str
    district: str
    authority: str
    project_type: str
    description: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    land_required: float
    land_acquired: float
    affected_families: int
    current_stage: Optional[str]
    status: Optional[str]

    # Extended prediction fields
    compensation_status: Optional[str] = None
    objection_count: Optional[int] = None
    legal_case_count: Optional[int] = None
    rr_status: Optional[str] = None
    env_clearance_status: Optional[str] = None
    forest_clearance_status: Optional[str] = None
    crz_status: Optional[str] = None
    doc_completeness_pct: Optional[float] = None
    approval_pending: Optional[bool] = None
    overdue_milestones: Optional[int] = None

    # ML outputs
    risk_score: Optional[float]
    risk_level: Optional[str]
    delay_probability: Optional[float]
    predicted_delay_days: Optional[int]
    confidence: Optional[float]
    primary_driver: Optional[str]

    source_details: Optional[Dict[str, Any]] = None

    # Provenance
    source_url: Optional[str]
    source_record_id: Optional[str]
    source_name: Optional[str] = None
    validation_status: Optional[str] = None
    data_classification: Optional[str] = None
    imported_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class ProjectCreate(BaseModel):
    project_code: str
    name: str
    state: str
    district: str
    authority: str
    project_type: str
    description: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    land_required: float = 0.0
    land_acquired: float = 0.0
    affected_families: int = 0
    current_stage: Optional[str] = None
    status: Optional[str] = None

    # Extended fields for prediction
    compensation_status: Optional[str] = None
    objection_count: Optional[int] = 0
    legal_case_count: Optional[int] = 0
    rr_status: Optional[str] = None
    env_clearance_status: Optional[str] = None
    forest_clearance_status: Optional[str] = None
    crz_status: Optional[str] = None
    doc_completeness_pct: Optional[float] = 50.0
    approval_pending: Optional[bool] = False
    overdue_milestones: Optional[int] = 0

    source_url: Optional[str] = None
    source_record_id: Optional[str] = None


class ProjectUpdate(BaseModel):
    """Partial update schema — all fields optional."""
    name: Optional[str] = None
    state: Optional[str] = None
    district: Optional[str] = None
    authority: Optional[str] = None
    project_type: Optional[str] = None
    description: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    land_required: Optional[float] = None
    land_acquired: Optional[float] = None
    affected_families: Optional[int] = None
    current_stage: Optional[str] = None
    status: Optional[str] = None
    compensation_status: Optional[str] = None
    objection_count: Optional[int] = None
    legal_case_count: Optional[int] = None
    rr_status: Optional[str] = None
    env_clearance_status: Optional[str] = None
    forest_clearance_status: Optional[str] = None
    crz_status: Optional[str] = None
    doc_completeness_pct: Optional[float] = None
    approval_pending: Optional[bool] = None
    overdue_milestones: Optional[int] = None


# ── Alerts ────────────────────────────────────────────────────────────────────

class AlertOut(BaseModel):
    id: str
    project_id: str
    project_name: Optional[str] = None
    severity: str
    reason: str
    detected_at: datetime
    recommended_action: Optional[str]
    status: str

    model_config = {"from_attributes": True}


# ── ML / Prediction ───────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    project_id: str


class ShapFeature(BaseModel):
    feature: str
    shap_value: float
    direction: str     # "up" | "down"
    description: str


class PredictionOut(BaseModel):
    project_id: str
    risk_score: float
    risk_level: str
    delay_probability: float
    predicted_delay_days: Optional[int]
    confidence: float
    shap_features: List[ShapFeature]
    model_run_id: Optional[str]
    predicted_at: datetime

    model_config = {"protected_namespaces": ()}


class ModelStatusOut(BaseModel):
    trained: bool
    algorithm: Optional[str]
    trained_at: Optional[datetime]
    n_samples: Optional[int]
    precision: Optional[float]
    recall: Optional[float]
    f1_score: Optional[float]
    roc_auc: Optional[float]
    rmse: Optional[float]
    feature_names: Optional[List[str]]
    message: str


class TrainResponse(BaseModel):
    success: bool
    message: str
    model_run_id: Optional[str] = None
    metrics: Optional[Dict[str, Any]] = None

    model_config = {"protected_namespaces": ()}


# ── Ingestion ─────────────────────────────────────────────────────────────────

class IngestResult(BaseModel):
    records_duplicated: int = 0
    records_failed: int = 0
    warnings: List[str] = Field(default_factory=list)
    source: str
    records_fetched: int
    records_saved: int
    records_skipped: int
    errors: List[str]
    status: str


class IngestionLogOut(BaseModel):
    id: str
    source: str
    source_url: Optional[str]
    started_at: datetime
    finished_at: Optional[datetime]
    records_fetched: int
    records_saved: int
    records_skipped: int
    errors: Optional[Any]
    status: str

    model_config = {"from_attributes": True}


# ── GeoJSON ───────────────────────────────────────────────────────────────────

class GeoFeature(BaseModel):
    type: str = "Feature"
    geometry: Dict[str, Any]
    properties: Dict[str, Any]


class GeoFeatureCollection(BaseModel):
    type: str = "FeatureCollection"
    features: List[GeoFeature]


# ── Dashboard ─────────────────────────────────────────────────────────────────

class DashboardSummary(BaseModel):
    total_projects: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int
    total_land_ha: float
    total_families: int
    avg_risk_score: Optional[float]
    alerts_open: int
    data_available: bool
    message: str


# ── Project validation ────────────────────────────────────────────────────────

class ProjectValidation(BaseModel):
    project_id: str
    missing_fields: List[str]
    can_predict: bool
    message: str
