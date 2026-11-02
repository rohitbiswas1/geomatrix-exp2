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
    limit: int = Query(50),
    db: Session = Depends(get_db)
):
    q = db.query(Alert)
    if status != "all":
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
