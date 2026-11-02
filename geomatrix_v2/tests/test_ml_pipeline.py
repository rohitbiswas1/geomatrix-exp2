import numpy as np
import pytest
import ml.train as train_module

from ml.evaluate import get_model_status
from ml.explain import explain_project
from ml.features import validate_prediction_inputs, build_feature_vector
from ml.predict import predict_project_risk
from ml.train import train_model, InsufficientDataError


@pytest.fixture(autouse=True)
def isolated_model_artifacts(tmp_path, monkeypatch):
    model_dir = tmp_path / "model_artifacts"
    model_dir.mkdir()
    monkeypatch.setattr(train_module, "MODEL_DIR", str(model_dir))


def _real_record(**overrides):
    record = {
        "land_area_ha": 120.0,
        "affected_families": 150,
        "pending_claims": 14,
        "legal_cases": 5,
        "doc_completeness_pct": 72,
        "approval_pending": True,
        "rr_pending": 8,
        "overdue_milestones": 4,
        "actual_delay_days": 45,
        "delayed": True,
    }
    record.update(overrides)
    return record


def test_model_status_reports_insufficient_real_data_message():
    status = get_model_status()
    assert status["trained"] is False
    assert "insufficient real labeled data" in status["message"].lower()


def test_predict_project_risk_returns_clear_message_when_model_is_missing():
    result = predict_project_risk(_real_record())
    assert result is not None
    assert result["status"] == "not_trained"
    assert "insufficient real labeled data" in result["message"].lower()


def test_validate_prediction_inputs_allows_missing_optional_status_fields():
    record = {
        "land_required": 300.0,
        "affected_families": 50,
        "current_stage": "Compensation",
        "approval_pending": False,
    }
    assert validate_prediction_inputs(record) == []


def test_train_model_rejects_insufficient_real_labeled_data():
    records = [_real_record() for _ in range(9)]
    with pytest.raises(InsufficientDataError, match="insufficient real labeled data|Minimum"):
        train_model(records)


def test_train_model_rejects_one_class_data():
    records = [_real_record(delayed=True, actual_delay_days=45) for _ in range(12)]
    with pytest.raises(InsufficientDataError, match="two-class|real labeled data|Minimum"):
        train_model(records)


def test_synthetic_records_are_excluded_from_training():
    records = [
        _real_record(delayed=True, actual_delay_days=45, data_classification="REAL"),
        _real_record(delayed=False, actual_delay_days=10, data_classification="TEST"),
    ]
    from ml.train import _normalize_record_list
    filtered = _normalize_record_list(records)
    assert len(filtered) == 1
    assert filtered[0]["data_classification"] == "REAL"


def test_confidence_never_exceeds_unit_interval():
    fake_clf = type("FakeClf", (), {"predict_proba": lambda self, X: np.array([[0.9, 0.1]])})()
    fake_scaler = type("FakeScaler", (), {"transform": lambda self, X: X})()
    fake_meta = {"roc_auc": 1.5, "run_id": "r1", "model_version": "v1", "trained_at": "2026-09-19T00:00:00", "n_samples": 10}
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr("ml.predict.load_active_model", lambda: (fake_clf, None, fake_scaler, fake_meta))
    result = predict_project_risk({"land_required": 100, "affected_families": 10, "current_stage": "In Progress"})
    monkeypatch.undo()
    assert result["status"] == "ok"
    assert 0.0 <= result["confidence"] <= 1.0


def test_objection_count_is_preserved_in_feature_vector():
    vector = build_feature_vector({"objection_count": 27, "legal_case_count": 5})
    assert vector["pending_claims"] == 27.0


def test_missing_actual_delay_days_makes_predicted_delay_days_unavailable():
    fake_clf = type("FakeClf", (), {"predict_proba": lambda self, X: np.array([[0.6, 0.4]])})()
    fake_scaler = type("FakeScaler", (), {"transform": lambda self, X: X})()
    fake_meta = {"roc_auc": 0.75, "run_id": "r2", "model_version": "v2", "trained_at": "2026-09-19T00:00:00", "n_samples": 10}
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr("ml.predict.load_active_model", lambda: (fake_clf, None, fake_scaler, fake_meta))
    result = predict_project_risk({"land_required": 100, "affected_families": 10, "current_stage": "In Progress"})
    monkeypatch.undo()
    assert result["predicted_delay_days"] is None


def test_shap_unavailable_without_valid_model():
    assert explain_project({}) is None


def test_prediction_blocked_without_valid_model():
    result = predict_project_risk({"land_required": 100, "affected_families": 10, "current_stage": "In Progress"})
    assert result["status"] == "not_trained"
    assert "insufficient real labeled data" in result["message"].lower()


def test_train_model_writes_real_metrics_for_valid_training_data():
    records = [_real_record(delayed=(i % 2 == 0), actual_delay_days=(30 + i * 4), data_classification="REAL") for i in range(30)]
    meta = train_model(records)
    assert meta["n_samples"] == 30
    assert meta["precision"] >= 0.0
    assert meta["f1_score"] >= 0.0
    assert meta["feature_names"]
    assert meta["model_version"]
    assert meta["n_unique_classes"] == 2



def test_legacy_model_metadata_is_not_loaded():
    import json
    from pathlib import Path
    from ml.train import load_active_model
    records = [_real_record(delayed=(i % 2 == 0)) for i in range(20)]
    meta = train_model(records)
    assert load_active_model() is not None
    path = Path(train_module.MODEL_DIR) / f"meta_{meta['run_id']}.json"
    del meta['training_data_version']
    path.write_text(json.dumps(meta))
    assert load_active_model() is None


def test_too_few_samples_in_minority_class_rejected():
    records = [_real_record(delayed=(i == 0)) for i in range(10)]
    with pytest.raises(InsufficientDataError, match="per class"):
        train_model(records)


def test_training_rejects_only_labels_with_constant_or_missing_features():
    records = [{"delayed": bool(i % 2), "actual_delay_days": 10 if i % 2 else 0} for i in range(20)]
    with pytest.raises(InsufficientDataError, match="missing or constant"):
        train_model(records)


def test_missing_observed_values_do_not_become_zero_for_prediction():
    record = {"land_required": 0, "affected_families": 0, "current_stage": "Unknown", "observed_fields": []}
    assert set(validate_prediction_inputs(record)) == {"land_required", "affected_families", "current_stage"}
    record.update(current_stage="Notification", observed_fields=["land_required", "affected_families", "current_stage"])
    assert validate_prediction_inputs(record) == []
