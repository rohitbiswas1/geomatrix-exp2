"""Geomatrix v2 ML Model Router"""
import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import HistoricalDelayRecord, ModelRun
from ml.train import train_model, InsufficientDataError, MIN_SAMPLES
from ml.evaluate import get_model_status

router = APIRouter(prefix="/api/model", tags=["model"])
logger = logging.getLogger(__name__)


@router.get("/status")
def model_status():
    """Return current model training status and metrics."""
    status = get_model_status()
    if not status.get("trained"):
        status["message"] = "Model not trained — insufficient real labeled data."
    return status


def eligible_records(db: Session):
    return db.query(HistoricalDelayRecord).filter(
        HistoricalDelayRecord.data_classification == "REAL",
        HistoricalDelayRecord.training_data_version >= 2,
        HistoricalDelayRecord.delayed.isnot(None),
    )


@router.get("/training-data")
def get_training_data(db: Session = Depends(get_db)):
    """Return count and summary of available labeled training records."""
    total = eligible_records(db).count()
    excluded = db.query(HistoricalDelayRecord).count() - total
    delayed = eligible_records(db).filter_by(delayed=True).count()
    on_time = total - delayed
    from ml.features import build_feature_dataframe
    rows = eligible_records(db).all()
    has_variation = bool(rows) and bool((build_feature_dataframe([r.__dict__ for r in rows]).nunique(dropna=True) > 1).any())
    return {
        "varying_features_available": has_variation,
        "feature_message": "Observed inputs vary." if has_variation else "Acquisition inputs are missing or constant. Supply verified features; schedule labels alone are insufficient.",
        "total_records": total,
        "delayed_count": delayed,
        "on_time_count": on_time,
        "ready_to_train": total >= MIN_SAMPLES and min(delayed, on_time) >= 2 and has_variation,
        "excluded_records": excluded,
        "message": (
            f"{total} eligible real labeled records ({delayed} delayed, {on_time} on-time); {excluded} legacy or non-real records excluded." + (" Acquisition inputs are missing or constant; supply verified features before training." if not has_variation else "")
            if total > 0
            else "No eligible historical records. Upload or re-import original labeled source data; legacy and synthetic rows cannot be used."
        )
    }


@router.get("/runs")
def list_model_runs(db: Session = Depends(get_db)):
    """List all model training runs."""
    runs = db.query(ModelRun).order_by(ModelRun.trained_at.desc()).limit(20).all()
    return [
        {
            "id": r.id,
            "algorithm": r.algorithm,
            "trained_at": r.trained_at.isoformat() if r.trained_at else None,
            "n_samples": r.n_samples,
            "precision": r.precision,
            "recall": r.recall,
            "f1_score": r.f1_score,
            "roc_auc": r.roc_auc,
            "rmse": r.rmse,
            "is_active": r.is_active,
        }
        for r in runs
    ]


@router.post("/train")
def trigger_training(algorithm: str = "RandomForest", db: Session = Depends(get_db)):
    """
    Train the ML model on all available real labeled historical records.
    Refuses if fewer than 10 real labeled records exist.
    """
    records = eligible_records(db).all()
    record_dicts = [
        {
            "data_classification": r.data_classification,
            "training_data_version": r.training_data_version,
            "land_area_ha": r.land_area_ha,
            "affected_families": r.affected_families,
            "pending_claims": r.pending_claims,
            "legal_cases": r.legal_cases,
            "doc_completeness_pct": r.doc_completeness_pct,
            "approval_pending": r.approval_pending,
            "rr_pending": r.rr_pending,
            "overdue_milestones": r.overdue_milestones,
            "actual_delay_days": r.actual_delay_days,
            "delayed": r.delayed,
        }
        for r in records
    ]

    try:
        meta = train_model(record_dicts, algorithm=algorithm)
    except InsufficientDataError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(f"Training error: {e}", exc_info=True)
        raise HTTPException(500, f"Training failed: {str(e)}")

    # Deactivate old runs
    db.query(ModelRun).filter_by(is_active=True).update({"is_active": False})

    run = ModelRun(
        id=meta["run_id"],
        algorithm=meta["algorithm"],
        n_samples=meta["n_samples"],
        n_features=meta["n_features"],
        feature_names=meta["feature_names"],
        precision=meta["precision"],
        recall=meta["recall"],
        f1_score=meta["f1_score"],
        roc_auc=meta["roc_auc"],
        rmse=meta["rmse"],
        accuracy=meta.get("accuracy"),
        model_path=meta["clf_path"],
        model_version=meta.get("model_version"),
        notes="Trained on real labeled historical records only.",
        is_active=True,
    )
    db.add(run)
    db.commit()

    return {
        "success": True,
        "message": f"Model trained on {meta['n_samples']} real samples.",
        "model_run_id": meta["run_id"],
        "metrics": {
            "precision": round(meta["precision"], 3),
            "recall": round(meta["recall"], 3),
            "f1_score": round(meta["f1_score"], 3),
            "roc_auc": round(meta["roc_auc"], 3),
            "accuracy": round(meta["accuracy"], 3),
            "rmse": round(meta["rmse"], 1),
        },
    }
