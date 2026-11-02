"""
Geomatrix v2 ML Training Pipeline
Trains RandomForest + XGBoost on REAL labeled historical delay data.
Never creates fake labels or predictions.
Minimum 10 real samples required before training.
"""
import os
import uuid
import json
import pickle
import logging
from datetime import datetime
from typing import Tuple, Dict, Any, Optional

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    precision_score, recall_score, f1_score,
    roc_auc_score, mean_squared_error, classification_report
)

try:
    from xgboost import XGBClassifier, XGBRegressor
    XGBOOST_AVAILABLE = True
except ImportError:
    XGBOOST_AVAILABLE = False

from ml.features import FEATURE_COLUMNS, LABEL_COLUMN, REGRESSION_LABEL

logger = logging.getLogger(__name__)

MIN_SAMPLES = 10
TRAINING_DATA_VERSION = 2
MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "model_artifacts")
os.makedirs(MODEL_DIR, exist_ok=True)


def _clear_active_model_files():
    active_path = os.path.join(MODEL_DIR, "active_model.json")
    if os.path.exists(active_path):
        try:
            os.remove(active_path)
        except OSError:
            pass


class InsufficientDataError(Exception):
    """Raised when there is not enough real labeled data to train."""
    pass


def _normalize_record_list(records: list) -> list:
    cleaned = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        if rec.get("delayed") is None:
            continue
        if rec.get("training_data_version", TRAINING_DATA_VERSION) != TRAINING_DATA_VERSION:
            continue
        classification = str(rec.get("data_classification", "REAL")).strip().upper()
        if classification != "REAL":
            continue
        cleaned.append(rec)
    return cleaned


def train_model(records: list, algorithm: str = "RandomForest") -> Dict[str, Any]:
    """
    Train a delay-prediction model on real labeled records.

    Args:
        records: list of dicts with feature columns + 'delayed' + 'actual_delay_days'
        algorithm: "RandomForest" or "XGBoost"

    Returns:
        dict with model_run_id, metrics, paths

    Raises:
        InsufficientDataError if fewer than MIN_SAMPLES records
    """
    records = _normalize_record_list(records)
    if len(records) < MIN_SAMPLES:
        raise InsufficientDataError(
            f"Only {len(records)} labeled records available. Minimum {MIN_SAMPLES} required; model not trained — insufficient real labeled data."
        )

    from ml.features import build_feature_dataframe
    X = build_feature_dataframe(records)
    y_clf = np.array([1 if bool(r.get(LABEL_COLUMN)) else 0 for r in records])

    unique_classes = sorted(set(y_clf.tolist()))
    if len(unique_classes) < 2:
        raise InsufficientDataError(
            "Training rejected: Minimum 10 real labeled records in a valid two-class dataset are required; current dataset has only one class and is not valid for training."
        )

    if min(np.bincount(y_clf)) < 2:
        raise InsufficientDataError("At least two real labeled records per class are required for a stratified holdout.")

    real_regression_records = [
        r for r in records
        if r.get(REGRESSION_LABEL) is not None and r.get(REGRESSION_LABEL) != ""
    ]
    regression_available = bool(real_regression_records)
    y_reg = np.array([float(r.get(REGRESSION_LABEL, 0) or 0) for r in records]) if regression_available else np.array([0.0 for _ in records])

    logger.info(f"Training on {len(records)} samples, {len(FEATURE_COLUMNS)} features")
    logger.info(f"Class distribution: {y_clf.sum()} delayed, {(y_clf == 0).sum()} on-time")

    if regression_available:
        X_train, X_test, y_clf_train, y_clf_test, y_reg_train, y_reg_test = train_test_split(
            X, y_clf, y_reg, test_size=0.2, random_state=42, stratify=y_clf if len(set(y_clf)) > 1 else None
        )
    else:
        X_train, X_test, y_clf_train, y_clf_test = train_test_split(
            X, y_clf, test_size=0.2, random_state=42, stratify=y_clf if len(set(y_clf)) > 1 else None
        )
        y_reg_train = y_reg_test = np.array([])

    # Fit preprocessing only on the training split; holdout rows stay unseen.
    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train)
    X_test = scaler.transform(X_test)

    if algorithm == "XGBoost" and XGBOOST_AVAILABLE:
        clf = XGBClassifier(n_estimators=100, max_depth=4, learning_rate=0.1,
                            random_state=42, eval_metric="logloss", verbosity=0)
        reg = XGBRegressor(n_estimators=100, max_depth=4, learning_rate=0.1,
                           random_state=42, verbosity=0) if regression_available else None
    else:
        algorithm = "RandomForest"
        clf = RandomForestClassifier(n_estimators=100, max_depth=6, random_state=42,
                                     class_weight="balanced")
        reg = RandomForestRegressor(n_estimators=100, max_depth=6, random_state=42) if regression_available else None

    clf.fit(X_train, y_clf_train)
    if reg is not None:
        reg.fit(X_train, y_reg_train)

    y_pred = clf.predict(X_test)
    y_prob = clf.predict_proba(X_test)[:, 1] if hasattr(clf, "predict_proba") else y_pred.astype(float)

    precision = float(precision_score(y_clf_test, y_pred, zero_division=0))
    recall = float(recall_score(y_clf_test, y_pred, zero_division=0))
    f1 = float(f1_score(y_clf_test, y_pred, zero_division=0))
    try:
        roc_auc = float(roc_auc_score(y_clf_test, y_prob)) if len(set(y_clf_test)) > 1 else 0.5
    except Exception:
        roc_auc = 0.5

    if reg is not None and len(y_reg_test) > 0:
        y_reg_pred = reg.predict(X_test)
        rmse = float(np.sqrt(mean_squared_error(y_reg_test, y_reg_pred)))
    else:
        rmse = None

    logger.info(f"Precision={precision:.3f} Recall={recall:.3f} F1={f1:.3f} "
                f"ROC-AUC={roc_auc:.3f} RMSE={rmse if rmse is not None else 'n/a'}")

    # Save artifacts
    run_id = str(uuid.uuid4())
    clf_path = os.path.join(MODEL_DIR, f"clf_{run_id}.pkl")
    reg_path = os.path.join(MODEL_DIR, f"reg_{run_id}.pkl")
    scaler_path = os.path.join(MODEL_DIR, f"scaler_{run_id}.pkl")
    meta_path = os.path.join(MODEL_DIR, f"meta_{run_id}.json")

    with open(clf_path, "wb") as f:
        pickle.dump(clf, f)
    with open(reg_path, "wb") as f:
        pickle.dump(reg, f)
    with open(scaler_path, "wb") as f:
        pickle.dump(scaler, f)

    version = f"{algorithm.lower()}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    meta = {
        "run_id": run_id,
        "model_version": version,
        "algorithm": algorithm,
        "trained_at": datetime.utcnow().isoformat(),
        "n_samples": len(records),
        "n_features": len(FEATURE_COLUMNS),
        "feature_names": FEATURE_COLUMNS,
        "n_unique_classes": int(len(np.unique(y_clf))),
        "class_counts": {"0": int((y_clf == 0).sum()), "1": int((y_clf == 1).sum())},
        "real_label_source": True,
        "training_data_version": TRAINING_DATA_VERSION,
        "regression_target_available": regression_available,
        "precision": precision,
        "recall": recall,
        "f1_score": f1,
        "roc_auc": roc_auc,
        "rmse": rmse,
        "accuracy": (np.mean(y_pred == y_clf_test) if len(y_clf_test) > 0 else 0.0),
        "clf_path": clf_path,
        "reg_path": reg_path if reg is not None else None,
        "scaler_path": scaler_path,
    }
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    # Save pointer to active model
    active_path = os.path.join(MODEL_DIR, "active_model.json")
    with open(active_path, "w") as f:
        json.dump({"run_id": run_id, "meta_path": meta_path}, f)

    logger.info(f"Model saved: run_id={run_id}")
    return meta


def load_active_model() -> Optional[Tuple[Any, Any, Any, Dict]]:
    """Load the currently active trained model artifacts. Returns None if none trained."""
    active_path = os.path.join(MODEL_DIR, "active_model.json")
    if not os.path.exists(active_path):
        return None
    try:
        with open(active_path) as f:
            ref = json.load(f)
        if not isinstance(ref, dict) or "meta_path" not in ref:
            _clear_active_model_files()
            return None
        with open(ref["meta_path"]) as f:
            meta = json.load(f)
        if not isinstance(meta, dict):
            _clear_active_model_files()
            return None
        if meta.get("training_data_version") != TRAINING_DATA_VERSION:
            _clear_active_model_files(); return None
        if int(meta.get("n_samples", 0) or 0) < MIN_SAMPLES:
            _clear_active_model_files(); return None
        if int(meta.get("n_unique_classes", 0) or 0) < 2:
            _clear_active_model_files(); return None
        if str(meta.get("real_label_source", "false")).lower() not in {"true", "1"}:
            _clear_active_model_files(); return None
        if meta.get("regression_target_available") is None:
            _clear_active_model_files(); return None
        with open(meta["clf_path"], "rb") as f:
            clf = pickle.load(f)
        reg = None
        if meta.get("reg_path"):
            with open(meta["reg_path"], "rb") as f:
                reg = pickle.load(f)
        with open(meta["scaler_path"], "rb") as f:
            scaler = pickle.load(f)
        return clf, reg, scaler, meta
    except Exception as e:
        logger.warning(f"Could not load active model: {e}")
        _clear_active_model_files()
        return None
