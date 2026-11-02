import csv
import io
import json
import pytest
from security import require_session

from fastapi.testclient import TestClient

from database import Base, engine
from main import app
import ml.train as train_module


def _project_row(index: int) -> dict:
    return {
        "project_code": f"REAL-{index}",
        "name": f"Real Corridor {index}",
        "state": "Karnataka",
        "district": "Bengaluru Urban",
        "authority": "NHAI",
        "project_type": "Highway",
        "latitude": "12.9716",
        "longitude": "77.5946",
        "land_required": "120.5",
        "affected_families": "40",
        "current_stage": "Compensation",
        "compensation_status": "Pending",
        "legal_case_count": "2",
        "rr_status": "Pending",
        "env_clearance_status": "Pending",
        "approval_pending": "true",
        "source_record_id": f"project-source-{index}",
    }


def _historical_row(index: int) -> dict:
    return {
        "project_code": f"HIST-{index}",
        "state": "Karnataka",
        "project_type": "Highway",
        "land_area_ha": str(80 + index),
        "affected_families": str(20 + index),
        "pending_claims": str(index % 5),
        "legal_cases": str(index % 3),
        "doc_completeness_pct": str(60 + index),
        "approval_pending": "true" if index % 2 else "false",
        "rr_pending": str(index % 4),
        "overdue_milestones": str(index % 6),
        "actual_delay_days": str(index * 3),
        "delayed": "true" if index % 2 else "false",
        "source_record_id": f"history-source-{index}",
    }


def _csv_bytes(rows: list[dict]) -> bytes:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode()


def test_real_upload_training_prediction_and_shap_persisted(tmp_path, monkeypatch):
    db_path = tmp_path / "pipeline.db"
    model_dir = tmp_path / "model_artifacts"
    model_dir.mkdir()
    monkeypatch.setattr("database.DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setattr(train_module, "MODEL_DIR", str(model_dir))
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    client = TestClient(app)

    project_response = client.post(
        "/api/ingest/upload?data_type=projects",
        files={"file": ("real-projects.csv", _csv_bytes([_project_row(1)]), "text/csv")},
    )
    assert project_response.status_code == 200
    assert project_response.json()["records_saved"] == 1

    historical = [_historical_row(index) for index in range(20)]
    historical_response = client.post(
        "/api/ingest/upload?data_type=historical",
        files={"file": ("real-history.json", json.dumps(historical).encode(), "application/json")},
    )
    assert historical_response.status_code == 200
    assert historical_response.json()["records_saved"] == 20

    train_response = client.post("/api/model/train?algorithm=RandomForest")
    assert train_response.status_code == 200
    assert train_response.json()["metrics"]["accuracy"] >= 0.0

    projects_response = client.get("/api/projects")
    assert projects_response.status_code == 200
    project_id = projects_response.json()[0]["id"]

    prediction_response = client.post(f"/api/projects/{project_id}/predict-risk")
    assert prediction_response.status_code == 200
    prediction = prediction_response.json()["prediction"]
    assert prediction["status"] == "ok"
    assert 0.0 <= prediction["delay_probability"] <= 1.0
    assert prediction["predicted_delay_days"] is None
    assert prediction["shap_features"]

    explanation_response = client.get(f"/api/projects/{project_id}/explain")
    assert explanation_response.status_code == 200
    assert explanation_response.json()["shap_features"]


def test_missing_historical_label_is_rejected(tmp_path, monkeypatch):
    db_path = tmp_path / "validation.db"
    monkeypatch.setattr("database.DATABASE_URL", f"sqlite:///{db_path}")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    client = TestClient(app)
    row = _historical_row(1)
    del row["delayed"]

    response = client.post(
        "/api/ingest/upload?data_type=historical",
        files={"file": ("real-history.csv", _csv_bytes([row]), "text/csv")},
    )
    assert response.status_code == 200
    assert response.json()["records_saved"] == 0
    assert "delayed" in response.json()["errors"][0]


def test_real_railway_csv_aliases_are_accepted(tmp_path, monkeypatch):
    db_path = tmp_path / "railway_aliases.db"
    monkeypatch.setattr("database.DATABASE_URL", f"sqlite:///{db_path}")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    client = TestClient(app)

    row = {
        "project_id": "705429",
        "state": "Uttarakhand",
        "project_type": "Rail New Line / Doubling / Railway Infrastructure",
        "sector": "Railways",
        "land_required_ha": "38953",
        "affected_families": "120",
        "pending_claims": "7",
        "legal_cases": "2",
        "doc_completeness_pct": "65",
        "approval_pending": "true",
        "rr_pending": "3",
        "overdue_milestones": "4",
        "days_to_original_deadline": "180",
        "delay_flag": "1",
        "source_record_id": "railway-705429",
    }

    response = client.post(
        "/api/ingest/upload?data_type=historical",
        files={"file": ("geomatrix_railways_training.csv", _csv_bytes([row]), "text/csv")},
    )
    assert response.status_code == 200
    assert response.json()["records_saved"] == 1
    assert response.json()["errors"] == []


def test_real_project_master_csv_aliases_are_accepted(tmp_path, monkeypatch):
    db_path = tmp_path / "project_aliases.db"
    monkeypatch.setattr("database.DATABASE_URL", f"sqlite:///{db_path}")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    client = TestClient(app)

    row = {
        "project_id": "617924",
        "canonical_project_name": "Construction of bypass to Nayagarh town from km 235.469 to 252.482 of NH-57 including land acquisition in Odisha",
        "sector": "Highways",
        "project_type": "National Highway / Bypass / Expressway",
        "implementing_agency": "NHAI / MoRTH",
        "state": "Odisha",
        "district": "",
        "land_required_ha": "300",
        "affected_families": "50",
        "status": "In Progress",
        "source_record_id": "project-master-617924",
    }

    response = client.post(
        "/api/ingest/upload?data_type=projects",
        files={"file": ("geomatrix_project_master.csv", _csv_bytes([row]), "text/csv")},
    )
    assert response.status_code == 200
    assert response.json()["records_saved"] == 1
    assert response.json()["errors"] == []


USER_SAMPLE_CSV = """project_id,project_name,sector,implementing_agency,state_or_region,approval_month,original_cost_cr,anticipated_cost_cr,cumulative_expenditure_cr,original_commissioning,anticipated_commissioning,milestones_achieved,milestones_total,milestone_completion_pct,delay_months_original,delay_flag,land_area_ha,affected_families,pending_claims,legal_cases,doc_completeness_pct,approval_pending,rr_pending,overdue_milestones,actual_delay_days,label_definition,features_excluded_from_training,source_name,source_url
N16000302,CONSTRUCTION OF RAIL FED DEPOT AT GUNTAKAL AP,Oil & Gas,IOCL,Andhra Pradesh,2017-08,384.58,384.58,267.12,2021-04,2021-03,0,0,,-1,0,,,,,,,,,,Government-monitored delay w.r.t. original schedule: delay_months_original > 0,"delay_months_original, anticipated_commissioning",MoSPI/PAIMANA Flash Report February 2021,https://www.uatipm.mospi.gov.in/Content/ArchiveReport/flash/2020-21/FR_feb_2021.pdf
N16000235,VISAKH REFINERY MODERNISATION PROJECT,Oil & Gas,HPCL,Andhra Pradesh,2016-07,20928.0,26264.0,13352.7,2020-07,2022-07,92,111,82.88,24,1,,,,,,,,,,Government-monitored delay w.r.t. original schedule: delay_months_original > 0,"delay_months_original, anticipated_commissioning",MoSPI/PAIMANA Flash Report February 2021,https://www.uatipm.mospi.gov.in/Content/ArchiveReport/flash/2020-21/FR_feb_2021.pdf
N16000247,KG-DWN-98-2 CLUSTER II DEVELOPMENT PROJECT,Oil & Gas,ONGC,Andhra Pradesh,2016-03,34012.0,25090.0,10477.71,2020-06,2022-06,15,20,75.0,24,1,,,,,,,,,,Government-monitored delay w.r.t. original schedule: delay_months_original > 0,"delay_months_original, anticipated_commissioning",MoSPI/PAIMANA Flash Report February 2021,https://www.uatipm.mospi.gov.in/Content/ArchiveReport/flash/2020-21/FR_feb_2021.pdf
N08000016,GAS TURBO GENERATOR AND HEAT RECOVERY STEAM GENERATOR PROJECT NFL NANGAL,Fertilisers,NFL,Punjab,2018-01,239.81,239.81,185.55,2019-11,2021-03,0,2,0.0,16,1,,,,,,,,,,Government-monitored delay w.r.t. original schedule: delay_months_original > 0,"delay_months_original, anticipated_commissioning",MoSPI/PAIMANA Flash Report February 2021,https://www.uatipm.mospi.gov.in/Content/ArchiveReport/flash/2020-21/FR_feb_2021.pdf
N10000010,5TH STREAM ALUMINA REFINERY EXPANSION PROJECT,Mines,NALCO,Odisha,2014-12,5540.0,5540.0,698.73,2021-04,2022-12,4,4,100.0,20,1,,,,,,,,,,Government-monitored delay w.r.t. original schedule: delay_months_original > 0,"delay_months_original, anticipated_commissioning",MoSPI/PAIMANA Flash Report February 2021,https://www.uatipm.mospi.gov.in/Content/ArchiveReport/flash/2020-21/FR_feb_2021.pdf
N28000133,C/O PERMANENT CAMPUS FOR NITAP UNDER PHASE 1B AT TADEPALLIGUDEM A.P.,Higher Education,CPWD,Andhra Pradesh,2019-02,186.0,186.0,56.61,2020-09,2020-09,1,7,14.28,0,0,,,,,,,,,,Government-monitored delay w.r.t. original schedule: delay_months_original > 0,"delay_months_original, anticipated_commissioning",MoSPI/PAIMANA Flash Report April 2020,https://www.uatipm.mospi.gov.in/Content/ArchiveReport/flash/2020-21/FR_APril_2020.pdf
N12000108,IRRIGATION WORK OF BAGMATI,Water Resources,HSCL,Bihar,2005-10,956.0,713.0,698.77,2015-03,2021-03,0,0,,72,1,,,,,,,,,,Government-monitored delay w.r.t. original schedule: delay_months_original > 0,"delay_months_original, anticipated_commissioning",MoSPI/PAIMANA Flash Report April 2020,https://www.uatipm.mospi.gov.in/Content/ArchiveReport/flash/2020-21/FR_APril_2020.pdf
N28000100,CONSTRUCTION OF ACADEMIC AND RESIDENTIAL COMPLEX UNDER PHASE-II FOR IIT PATNA,Higher Education,CPWD,Bihar,2016-02,496.18,498.99,142.31,2017-06,2021-03,1,6,16.66,45,1,,,,,,,,,,Government-monitored delay w.r.t. original schedule: delay_months_original > 0,"delay_months_original, anticipated_commissioning",MoSPI/PAIMANA Flash Report April 2020,https://www.uatipm.mospi.gov.in/Content/ArchiveReport/flash/2020-21/FR_APril_2020.pdf
N22000367,KAZIPET-BALHRSHA,Railways,SCR,Multi-State,2015-04,2063.03,2063.03,880.17,2021-03,2023-03,0,0,,24,1,,,,,,,,,,Government-monitored delay w.r.t. original schedule: delay_months_original > 0,"delay_months_original, anticipated_commissioning",MoSPI/PAIMANA Flash Report April 2020,https://www.uatipm.mospi.gov.in/Content/ArchiveReport/flash/2020-21/FR_APril_2020.pdf
N22000463,MUMBAI AHMEDABAD HIGH SPEED RAIL PROJECT,Railways,NHSRCL,Multi-State,2015-12,108000.0,108000.0,6708.69,2023-12,2023-12,0,0,,0,0,,,,,,,,,,Government-monitored delay w.r.t. original schedule: delay_months_original > 0,"delay_months_original, anticipated_commissioning",MoSPI/PAIMANA Flash Report April 2020,https://www.uatipm.mospi.gov.in/Content/ArchiveReport/flash/2020-21/FR_APril_2020.pdf
"""


def test_user_mospi_flash_report_csv_ingestion_and_training(tmp_path, monkeypatch):
    db_path = tmp_path / "user_csv.db"
    model_dir = tmp_path / "model_artifacts"
    model_dir.mkdir()
    monkeypatch.setattr("database.DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setattr(train_module, "MODEL_DIR", str(model_dir))
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    client = TestClient(app)

    # Ingest as historical delay records for training
    hist_resp = client.post(
        "/api/ingest/upload?data_type=historical",
        files={"file": ("mospi_flash_report.csv", USER_SAMPLE_CSV.encode("utf-8"), "text/csv")},
    )
    assert hist_resp.status_code == 200
    assert hist_resp.json()["records_saved"] == 10
    assert hist_resp.json()["errors"] == []

    # Ingest as active projects for prediction
    proj_resp = client.post(
        "/api/ingest/upload?data_type=projects",
        files={"file": ("mospi_flash_report.csv", USER_SAMPLE_CSV.encode("utf-8"), "text/csv")},
    )
    assert proj_resp.status_code == 200
    assert proj_resp.json()["records_saved"] == 10
    assert proj_resp.json()["errors"] == []

    # Train model on historical records
    train_resp = client.post("/api/model/train?algorithm=RandomForest")
    assert train_resp.status_code == 200
    assert train_resp.json()["success"] is True
    assert train_resp.json()["metrics"]["accuracy"] >= 0.0

    # Get project and predict
    projects_resp = client.get("/api/projects")
    assert projects_resp.status_code == 200
    project_id = projects_resp.json()[0]["id"]

    pred_resp = client.post(f"/api/projects/{project_id}/predict-risk")
    assert pred_resp.status_code == 200
    pred = pred_resp.json()["prediction"]
    assert pred["status"] == "ok"
    assert 0.0 <= pred["delay_probability"] <= 1.0


@pytest.fixture(autouse=True)
def authenticated_pipeline():
    # Pipeline tests isolate ingestion/ML behavior; auth is tested separately.
    app.dependency_overrides[require_session] = lambda: object()
    yield
    app.dependency_overrides.pop(require_session, None)


def test_missing_approval_is_not_derived_from_delay_label():
    from database import SessionLocal
    from models import HistoricalDelayRecord
    rows = [_historical_row(0), _historical_row(1)]
    for row in rows:
        del row['approval_pending']
    response = TestClient(app).post('/api/ingest/upload?data_type=historical',
        files={'file': ('real-history.csv', _csv_bytes(rows), 'text/csv')})
    assert response.json()['records_saved'] == 2
    with SessionLocal() as db:
        records = db.query(HistoricalDelayRecord).all()
        assert {r.delayed for r in records} == {True, False}
        assert all(r.approval_pending is None for r in records)


def test_api_training_excludes_synthetic_and_legacy_records(monkeypatch):
    from database import SessionLocal
    from models import HistoricalDelayRecord
    with SessionLocal() as db:
        for index, (classification, version) in enumerate([('REAL', 2), ('TEST', 2), ('SYNTHETIC', 2), ('REAL', 1)]):
            db.add(HistoricalDelayRecord(id=str(index), project_code=f'P{index}', delayed=True,
                actual_delay_days=1, data_classification=classification, training_data_version=version))
        db.commit()
    captured = []
    def capture(records, **kwargs):
        captured.extend(records)
        raise train_module.InsufficientDataError('Too few eligible records')
    monkeypatch.setattr('routers.ml.train_model', capture)
    client = TestClient(app)
    summary = client.get('/api/model/training-data').json()
    assert summary['total_records'] == 1
    assert summary['excluded_records'] == 3
    assert summary['ready_to_train'] is False
    assert client.post('/api/model/train').status_code == 400
    assert len(captured) == 1
    assert captured[0]['data_classification'] == 'REAL'
    assert captured[0]['training_data_version'] == 2


def test_historical_reimport_repairs_legacy_row_without_copying_label():
    from database import SessionLocal
    from models import HistoricalDelayRecord
    with SessionLocal() as db:
        db.add(HistoricalDelayRecord(id='legacy', source_record_id='history-source-1',
            delayed=True, actual_delay_days=4, approval_pending=True, training_data_version=1))
        db.commit()
    row = _historical_row(1)
    del row['approval_pending']
    response = TestClient(app).post('/api/ingest/upload?data_type=historical',
        files={'file': ('real-history.csv', _csv_bytes([row]), 'text/csv')})
    assert response.json()['records_saved'] == 1
    with SessionLocal() as db:
        record = db.query(HistoricalDelayRecord).one()
        assert record.training_data_version == 2
        assert record.approval_pending is None


def test_explicit_synthetic_classification_survives_ingestion():
    from database import SessionLocal
    from models import HistoricalDelayRecord
    row = _historical_row(1)
    row['data_classification'] = 'SYNTHETIC'
    response = TestClient(app).post('/api/ingest/upload?data_type=historical',
        files={'file': ('history.csv', _csv_bytes([row]), 'text/csv')})
    assert response.json()['records_saved'] == 1
    with SessionLocal() as db:
        assert db.query(HistoricalDelayRecord).one().data_classification == 'SYNTHETIC'
