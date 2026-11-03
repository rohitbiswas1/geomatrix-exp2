"""Geomatrix v2 Projects Router"""
import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import Project, RiskPrediction, Alert
from schemas import ProjectOut, ProjectCreate, ProjectUpdate, ProjectValidation, DashboardSummary
from ml.predict import predict_project_risk
from ml.explain import explain_project
from ml.features import validate_prediction_inputs

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _project_to_record(p: Project) -> dict:
    """Convert a Project ORM object to a feature record dict."""
    return {
        "observed_fields": (p.source_details or {}).get("observed_fields"),
        # Core fields
        "land_area_ha": p.land_required or 0,
        "land_required": p.land_required or 0,
        "affected_families": p.affected_families or 0,
        # Real stored prediction inputs
        "pending_claims": p.objection_count or 0,
        "objection_count": p.objection_count or 0,
        "legal_cases": p.legal_case_count or 0,
        "legal_case_count": p.legal_case_count or 0,
        "doc_completeness_pct": p.doc_completeness_pct if p.doc_completeness_pct is not None else 50.0,
        "approval_pending": p.approval_pending or False,
        "rr_pending": p.rr_status,
        "rr_status": p.rr_status,
        "overdue_milestones": p.overdue_milestones or 0,
        "compensation_status": p.compensation_status,
        "compensation_pending": p.compensation_status,
        "env_clearance_status": p.env_clearance_status,
        "forest_clearance_status": p.forest_clearance_status,
        "crz_status": p.crz_status,
        "current_stage": p.current_stage,
    }


@router.get("/dashboard-summary", response_model=DashboardSummary)
def dashboard_summary(db: Session = Depends(get_db)):
    """Return real counts for the dashboard from database records."""
    total = db.query(Project).filter(Project.data_classification == "REAL").count()
    if total == 0:
        return DashboardSummary(
            total_projects=0, critical_count=0, high_count=0,
            medium_count=0, low_count=0, total_land_ha=0.0,
            total_families=0, avg_risk_score=None, alerts_open=0,
            data_available=False, message="No projects in database yet."
        )

    critical = db.query(Project).filter(Project.data_classification == "REAL").filter(Project.risk_level == "Critical").count()
    high = db.query(Project).filter(Project.data_classification == "REAL").filter(Project.risk_level == "High").count()
    medium = db.query(Project).filter(Project.data_classification == "REAL").filter(Project.risk_level == "Medium").count()
    low = db.query(Project).filter(Project.data_classification == "REAL").filter(Project.risk_level == "Low").count()

    projects = db.query(Project).filter(Project.data_classification == "REAL").all()
    total_land = sum((p.land_required or 0) for p in projects)
    total_families = sum((p.affected_families or 0) for p in projects)

    scored = [p.risk_score for p in projects if p.risk_score is not None]
    avg_risk = round(sum(scored) / len(scored), 1) if scored else None

    alerts_open = db.query(Alert).filter(Alert.status == "Open").count()

    return DashboardSummary(
        total_projects=total,
        critical_count=critical,
        high_count=high,
        medium_count=medium,
        low_count=low,
        total_land_ha=round(total_land, 1),
        total_families=total_families,
        avg_risk_score=avg_risk,
        alerts_open=alerts_open,
        data_available=True,
        message=f"{total} projects loaded from database."
    )


@router.get("", response_model=list[ProjectOut])
def list_projects(
    state: Optional[str] = Query(None),
    district: Optional[str] = Query(None),
    stage: Optional[str] = Query(None),
    risk_level: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    dataset: str = Query("production", pattern="^(production|all|excluded)$"),
    db: Session = Depends(get_db)
):
    q = db.query(Project)
    if dataset == "production":
        q = q.filter(Project.data_classification == "REAL")
    elif dataset == "excluded":
        q = q.filter(Project.data_classification != "REAL")
    if state:
        q = q.filter(Project.state.ilike(f"%{state}%"))
    if district:
        q = q.filter(Project.district.ilike(f"%{district}%"))
    if stage:
        q = q.filter(Project.current_stage.ilike(f"%{stage}%"))
    if risk_level:
        q = q.filter(Project.risk_level == risk_level)
    return q.order_by(Project.imported_at.desc()).limit(limit).all()


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db)):
    p = db.query(Project).filter_by(id=project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    if body.land_acquired > body.land_required:
        raise HTTPException(422, "Acquired land cannot exceed required land.")
    existing = db.query(Project).filter_by(project_code=body.project_code).first()
    if existing:
        raise HTTPException(409, f"Project code '{body.project_code}' already exists")
    proj = Project(
        id=str(uuid.uuid4()),
        imported_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        validation_status="pending",
        data_classification="REAL",
        **body.model_dump(exclude_none=False)
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)
    return proj


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: str, body: ProjectUpdate, db: Session = Depends(get_db)):
    p = db.query(Project).filter_by(id=project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    required = body.land_required if body.land_required is not None else p.land_required
    acquired = body.land_acquired if body.land_acquired is not None else p.land_acquired
    if acquired > required:
        raise HTTPException(422, "Acquired land cannot exceed required land.")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(p, field, value)
    if p.source_details is not None:
        details = dict(p.source_details)
        observed = set(details.get("observed_fields", []))
        observed.update(body.model_dump(exclude_none=True))
        details["observed_fields"] = sorted(observed)
        details["missing_fields"] = [field for field in details.get("missing_fields", []) if field not in observed]
        p.source_details = details
    p.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return p


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, db: Session = Depends(get_db)):
    p = db.query(Project).filter_by(id=project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    db.delete(p)
    db.commit()


@router.get("/{project_id}/validate", response_model=ProjectValidation)
def validate_project(project_id: str, db: Session = Depends(get_db)):
    """Check which required prediction fields are missing."""
    p = db.query(Project).filter_by(id=project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    record = _project_to_record(p)
    missing = validate_prediction_inputs(record)
    can_predict = len(missing) == 0
    if can_predict:
        msg = "All required fields present — prediction can proceed."
    else:
        msg = f"Prediction unavailable: {len(missing)} required field(s) are missing: {', '.join(missing)}."
    return ProjectValidation(
        project_id=project_id,
        missing_fields=missing,
        can_predict=can_predict,
        message=msg
    )


@router.post("/{project_id}/predict-risk")
def predict_risk(project_id: str, db: Session = Depends(get_db)):
    """Run ML risk prediction for a project using real stored project fields.
    Returns 503 if model not trained or 422 if project data is incomplete.
    """
    p = db.query(Project).filter_by(id=project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    if p.data_classification != "REAL":
        raise HTTPException(409, "Sample and non-production records cannot produce production predictions.")
    record = _project_to_record(p)

    # Validate required fields before calling the model
    missing = validate_prediction_inputs(record)
    if missing:
        raise HTTPException(
            422,
            f"Prediction unavailable — incomplete project data. Missing: {', '.join(missing)}"
        )

    result = predict_project_risk(record)
    if result is None or result.get("status") in {"not_trained", "error"}:
        raise HTTPException(503, "Model not trained — insufficient real labeled data.")

    shap_features = explain_project(record) or []

    p.risk_score = result["risk_score"]
    p.risk_level = result["risk_level"]
    p.delay_probability = result["delay_probability"]
    p.predicted_delay_days = result["predicted_delay_days"]
    p.confidence = result["confidence"]
    p.primary_driver = result.get("model_version")
    p.updated_at = datetime.utcnow()

    db.add(RiskPrediction(
        id=str(uuid.uuid4()),
        project_id=p.id,
        model_run_id=result.get("model_run_id"),
        risk_score=result.get("risk_score"),
        risk_level=result.get("risk_level"),
        delay_probability=result.get("delay_probability"),
        predicted_delay_days=result.get("predicted_delay_days"),
        confidence=result.get("confidence"),
        shap_values={item["feature"]: item["shap_value"] for item in shap_features},
    ))
    db.commit()

    return {"project_id": project_id, "prediction": {**result, "shap_features": shap_features}}


@router.get("/{project_id}/explain")
def get_explanation(project_id: str, db: Session = Depends(get_db)):
    """Get SHAP feature explanations for a project using real trained model."""
    p = db.query(Project).filter_by(id=project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    record = _project_to_record(p)
    shap_features = explain_project(record)
    if shap_features is None:
        raise HTTPException(503, "ML model not trained. Cannot compute SHAP explanations.")

    return {"project_id": project_id, "shap_features": shap_features}


@router.get("/{project_id}/explanation")
def get_explanation_alias(project_id: str, db: Session = Depends(get_db)):
    return get_explanation(project_id, db)


@router.get("/{project_id}/recommendations")
def get_recommendations_alias(project_id: str, db: Session = Depends(get_db)):
    return get_explanation(project_id, db)


@router.post("/{project_id}/risk")
def predict_risk_alias(project_id: str, db: Session = Depends(get_db)):
    return predict_risk(project_id, db)


@router.get("/{project_id}/predictions")
def list_predictions(project_id: str, db: Session = Depends(get_db)):
    """Return prediction history for a project."""
    p = db.query(Project).filter_by(id=project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    preds = db.query(RiskPrediction).filter_by(project_id=project_id)\
               .order_by(RiskPrediction.predicted_at.desc()).limit(10).all()
    return [
        {
            "id": pr.id,
            "risk_score": pr.risk_score,
            "risk_level": pr.risk_level,
            "delay_probability": pr.delay_probability,
            "confidence": pr.confidence,
            "predicted_at": pr.predicted_at.isoformat() if pr.predicted_at else None,
            "model_run_id": pr.model_run_id,
        }
        for pr in preds
    ]


@router.get('/{project_id}/risk')
def stored_risk(project_id: str, db: Session = Depends(get_db)):
    project = get_project(project_id, db)
    fields = ('risk_score', 'risk_level', 'delay_probability', 'predicted_delay_days', 'confidence')
    return {'project_id': project.id, 'status': 'ok' if project.risk_score is not None else 'not_predicted',
            **{field: getattr(project, field) for field in fields}}


# Workflow records are persisted independently of project source provenance.
from datetime import date
from typing import Literal
from pydantic import BaseModel, Field
from models import Intervention

class InterventionCreate(BaseModel):
    model_config = {"str_strip_whitespace": True}
    action: str = Field(min_length=1, max_length=100)
    assigned_to: str = Field(min_length=1, max_length=200)
    priority: Literal["Critical", "High", "Medium", "Low"] = "Medium"
    due_date: Optional[date] = None
    note: str = Field(min_length=1, max_length=4000)

def intervention_record(item):
    return {key: getattr(item, key) for key in
            ("id", "project_id", "action", "assigned_to", "priority", "due_date", "note", "created_at")}

@router.get("/{project_id}/interventions")
def list_interventions(project_id: str, db: Session = Depends(get_db)):
    get_project(project_id, db)
    return [intervention_record(item) for item in db.query(Intervention)
            .filter_by(project_id=project_id).order_by(Intervention.created_at.desc()).all()]

@router.post("/{project_id}/interventions", status_code=201)
def create_intervention(project_id: str, body: InterventionCreate, db: Session = Depends(get_db)):
    get_project(project_id, db)
    values = body.model_dump()
    if body.due_date:
        values["due_date"] = body.due_date.isoformat()
    item = Intervention(id=str(uuid.uuid4()), project_id=project_id, **values)
    db.add(item)
    db.commit()
    db.refresh(item)
    return intervention_record(item)

class ScenarioInputs(BaseModel):
    objection_count: int = Field(ge=0, le=100000)
    legal_case_count: int = Field(ge=0, le=100000)
    doc_completeness_pct: float = Field(ge=0, le=100)
    approval_pending: bool
    rr_status: Literal["Pending", "Completed"]

@router.post("/{project_id}/simulate")
def simulate_project(project_id: str, body: ScenarioInputs, db: Session = Depends(get_db)):
    project = get_project(project_id, db)
    if project.data_classification != "REAL":
        raise HTTPException(409, "Sample records cannot be used for production scenarios.")
    record = _project_to_record(project)
    values = body.model_dump()
    record.update(values)
    record.update(pending_claims=body.objection_count, legal_cases=body.legal_case_count,
                  rr_pending=body.rr_status)
    if record.get("observed_fields") is not None:
        record["observed_fields"] = sorted(set(record["observed_fields"]) | set(values))
    missing = validate_prediction_inputs(record)
    if missing:
        raise HTTPException(422, "Scenario is missing verified inputs: " + ", ".join(missing))
    result = predict_project_risk(record)
    if not result or result.get("status") != "ok":
        raise HTTPException(503, "Train a model on eligible historical data before running scenarios.")
    # A scenario never changes the stored project, predictions, or alerts.
    return {"project_id": project_id, "prediction": result}


@router.get("/interventions/all/records")
def all_interventions(limit: int = Query(500, ge=1, le=500), db: Session = Depends(get_db)):
    rows = db.query(Intervention, Project.name).join(Project, Intervention.project_id == Project.id).order_by(Intervention.created_at.desc()).limit(limit).all()
    return [{**intervention_record(item), "project_name": name} for item, name in rows]
