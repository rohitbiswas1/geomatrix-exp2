"""
Geomatrix v2 – SQLAlchemy models (SQLite).
Every imported record carries source provenance fields.
"""
from datetime import datetime
from sqlalchemy import (
    Column, String, Float, Integer, Boolean, DateTime,
    ForeignKey, Text, JSON
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class PasswordAccount(Base):
    __tablename__ = "password_accounts"

    id = Column(String, primary_key=True)
    email = Column(String(254), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AuthAttempt(Base):
    __tablename__ = "auth_attempts"

    id = Column(String, primary_key=True)
    count = Column(Integer, default=0, nullable=False)
    attempted_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    token_hash = Column(String(64), primary_key=True)
    subject = Column(String, nullable=False)
    email = Column(String, nullable=False)
    name = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)


class Project(Base):
    __tablename__ = "projects"

    id             = Column(String, primary_key=True)
    project_code   = Column(String, unique=True, nullable=False)
    name           = Column(String, nullable=False)
    state          = Column(String, nullable=False)
    district       = Column(String, nullable=False)
    authority      = Column(String, nullable=False)
    project_type   = Column(String, nullable=False)
    description    = Column(Text)
    latitude       = Column(Float)
    longitude      = Column(Float)
    land_required  = Column(Float, default=0.0)
    land_acquired  = Column(Float, default=0.0)
    affected_families = Column(Integer, default=0)
    current_stage  = Column(String)
    status         = Column(String)
    validation_status = Column(String, default="pending")
    data_classification = Column(String, default="REAL")

    # provenance
    source_name      = Column(String)
    source_url       = Column(String)
    source_record_id = Column(String)
    imported_at      = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # ── Additional project fields used for ML prediction ──────────────────────
    compensation_status     = Column(String)   # Pending / Settled / Disputed
    objection_count         = Column(Integer, default=0)
    legal_case_count        = Column(Integer, default=0)
    rr_status               = Column(String)   # Pending / In Progress / Completed
    env_clearance_status    = Column(String)   # Pending / Granted / NA
    forest_clearance_status = Column(String)   # Pending / Granted / NA
    crz_status              = Column(String)   # NA / Pending / Granted
    doc_completeness_pct    = Column(Float, default=50.0)  # 0–100
    approval_pending        = Column(Boolean, default=False)
    overdue_milestones      = Column(Integer, default=0)

    # derived risk fields (written by ML or rule-based fallback)
    risk_score         = Column(Float)
    risk_level         = Column(String)
    delay_probability  = Column(Float)
    predicted_delay_days = Column(Integer)
    confidence         = Column(Float)
    primary_driver     = Column(String)

    alerts      = relationship("Alert", back_populates="project", cascade="all, delete-orphan")
    predictions = relationship("RiskPrediction", back_populates="project", cascade="all, delete-orphan")


class HistoricalDelayRecord(Base):
    """Real labeled training data. Never synthetically generated."""
    __tablename__ = "historical_delay_records"

    id                  = Column(String, primary_key=True)
    project_code        = Column(String)
    state               = Column(String)
    project_type        = Column(String)
    land_area_ha        = Column(Float)
    affected_families   = Column(Integer)
    pending_claims      = Column(Integer)
    legal_cases         = Column(Integer)
    doc_completeness_pct= Column(Float)   # 0-100
    approval_pending    = Column(Boolean)
    rr_pending          = Column(Integer)
    overdue_milestones  = Column(Integer)
    # label
    actual_delay_days   = Column(Integer, nullable=False)
    delayed             = Column(Boolean, nullable=False)   # True if delay > 0
    validation_status   = Column(String, default="pending")
    data_classification = Column(String, default="REAL")

    # Version 1 imports may contain approval_pending copied from the label.
    # Re-import original source data before those records can be used again.
    training_data_version = Column(Integer, default=1, nullable=False)

    # provenance
    source_name       = Column(String)
    source_url        = Column(String)
    source_record_id  = Column(String)
    imported_at       = Column(DateTime, default=datetime.utcnow)
    updated_at        = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ModelRun(Base):
    """Records each ML training run with real evaluation metrics."""
    __tablename__ = "model_runs"

    id             = Column(String, primary_key=True)
    algorithm      = Column(String)   # "RandomForest" or "XGBoost"
    trained_at     = Column(DateTime, default=datetime.utcnow)
    n_samples      = Column(Integer)
    n_features     = Column(Integer)
    feature_names  = Column(JSON)
    precision      = Column(Float)
    recall         = Column(Float)
    f1_score       = Column(Float)
    roc_auc        = Column(Float)
    rmse           = Column(Float)   # for regression head
    accuracy       = Column(Float)
    model_path     = Column(String)
    model_version  = Column(String)
    is_active      = Column(Boolean, default=True)
    notes          = Column(Text)


class GeminiInsight(Base):
    __tablename__ = "gemini_insights"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    model_run_id = Column(String, ForeignKey("model_runs.id"))
    summary = Column(Text)
    recommendations = Column(JSON)
    generated_at = Column(DateTime, default=datetime.utcnow)


class RiskPrediction(Base):
    __tablename__ = "risk_predictions"

    id                  = Column(String, primary_key=True)
    project_id          = Column(String, ForeignKey("projects.id"), nullable=False)
    model_run_id        = Column(String, ForeignKey("model_runs.id"))
    risk_score          = Column(Float)
    risk_level          = Column(String)
    delay_probability   = Column(Float)
    predicted_delay_days= Column(Integer)
    confidence          = Column(Float)
    shap_values         = Column(JSON)   # {feature: shap_value}
    predicted_at        = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="predictions")


class Alert(Base):
    __tablename__ = "alerts"

    id                 = Column(String, primary_key=True)
    project_id         = Column(String, ForeignKey("projects.id"), nullable=False)
    severity           = Column(String)
    reason             = Column(Text)
    detected_at        = Column(DateTime, default=datetime.utcnow)
    recommended_action = Column(Text)
    status             = Column(String, default="Open")

    project = relationship("Project", back_populates="alerts")


class DataIngestionLog(Base):
    __tablename__ = "data_ingestion_log"

    id            = Column(String, primary_key=True)
    source        = Column(String)   # "datagovIn", "bhoomi_rashi_csv", "manual_upload"
    source_name   = Column(String)
    source_url    = Column(String)
    started_at    = Column(DateTime, default=datetime.utcnow)
    triggered_at  = Column(DateTime, default=datetime.utcnow)
    finished_at   = Column(DateTime)
    records_fetched = Column(Integer, default=0)
    records_saved   = Column(Integer, default=0)
    records_skipped = Column(Integer, default=0)
    errors          = Column(JSON)
    error_message   = Column(Text)
    status          = Column(String, default="running")  # running | success | failed
