"""Geomatrix v2 Alerts Router"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import Alert, Project
from schemas import AlertOut

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertOut])
def list_alerts(
    status: str = Query("Open"),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db)
):
    q = db.query(Alert)
    if status.lower() != "all":
        q = q.filter(Alert.status == status)
    alerts = q.order_by(Alert.detected_at.desc()).limit(limit).all()

    result = []
    for a in alerts:
        p = db.query(Project).filter_by(id=a.project_id).first()
        out = AlertOut.model_validate(a)
        out.project_name = p.name if p else None
        result.append(out)
    return result


@router.get("/summary")
def alerts_summary(db: Session = Depends(get_db)):
    total = db.query(Alert).count()
    open_count = db.query(Alert).filter_by(status="Open").count()
    critical = db.query(Alert).filter_by(severity="Critical", status="Open").count()
    high = db.query(Alert).filter_by(severity="High", status="Open").count()
    return {
        "total": total,
        "open": open_count,
        "critical": critical,
        "high": high,
    }


@router.post("/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: str, db: Session = Depends(get_db)):
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(404, "Alert not found")
    alert.status = "Acknowledged"
    db.commit()
    return {"id": alert.id, "status": alert.status}


from datetime import date
from typing import Literal, Optional
from pydantic import BaseModel, Field

class AlertUpdate(BaseModel):
    status: Optional[Literal["Open", "Acknowledged", "Monitoring", "Resolved"]] = None
    assigned_to: Optional[str] = Field(default=None, max_length=200)
    due_date: Optional[date] = None
    outcome: Optional[str] = Field(default=None, max_length=4000)

@router.patch("/{alert_id}", response_model=AlertOut)
def update_alert(alert_id: str, body: AlertUpdate, db: Session = Depends(get_db)):
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(404, "Alert not found")
    if body.assigned_to and alert.status == "Open" and body.status not in {"Acknowledged", "Monitoring", "Resolved"}:
        raise HTTPException(409, "Acknowledge the alert before assigning an officer.")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(alert, key, value.isoformat() if isinstance(value, date) else value)
    db.commit()
    db.refresh(alert)
    out = AlertOut.model_validate(alert)
    project = db.get(Project, alert.project_id)
    out.project_name = project.name if project else None
    return out
