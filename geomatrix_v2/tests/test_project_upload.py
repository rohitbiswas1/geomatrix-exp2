import io
import csv
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from main import app
from database import SessionLocal
from models import Project, DataIngestionLog
from security import require_session


@pytest.fixture
def client():
    app.dependency_overrides[require_session] = lambda: object()
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(require_session, None)


def upload(client, rows, filename='projects.json'):
    if filename.lower().endswith('.json'):
        content = json.dumps(rows).encode()
    else:
        text = io.StringIO()
        writer = csv.DictWriter(text, fieldnames=list(rows[0]))
        writer.writeheader(); writer.writerows(rows)
        content = text.getvalue().encode()
    return client.post('/api/ingest/upload?data_type=projects', files={'file': (filename, content)})


def row(code='P-1', **extra):
    return {'project_id': code, 'project_name': 'A project', 'state': 'West Bengal', **extra}


def test_exact_twenty_row_user_sample_imports_and_survives_new_client(client):
    path = Path(__file__).parent / 'fixtures/project_sample_20.csv'
    response = client.post('/api/ingest/upload?data_type=projects', files={'file': (path.name, path.read_bytes(), 'text/csv')})
    assert response.status_code == 200
    result = response.json()
    assert result['records_saved'] == result['records_fetched'] == 20
    assert result['records_failed'] == result['records_duplicated'] == 0
    assert result['errors'] == []
    assert any('Unknown' in note for note in result['warnings'])
    with SessionLocal() as db:
        project = db.query(Project).filter_by(project_code='GM-001').one()
        assert project.name == 'Kolkata Infrastructure Corridor'
        assert project.project_type == project.authority == 'Unknown'
        assert project.land_required == pytest.approx(61.24 * 0.40468564224)
        assert project.legal_case_count == 2
        assert project.env_clearance_status == 'Approved'
        assert project.affected_families == 0  # Landowners are not inferred to be families.
        assert project.risk_level is None and project.risk_score is None
        assert project.data_classification == 'TEST'
    assert TestClient(app).get('/api/projects').json() == []
    assert len(TestClient(app).get('/api/projects?dataset=excluded').json()) == 20
    sample = TestClient(app).get('/api/projects?dataset=excluded').json()[0]
    assert client.post('/api/projects/'+sample['id']+'/predict-risk').status_code == 409
    assert client.get('/api/map/geojson').json()['features'] == []
    repeated = client.post('/api/ingest/upload?data_type=projects', files={'file': (path.name, path.read_bytes())}).json()
    assert repeated['records_saved'] == 0
    assert repeated['records_duplicated'] == repeated['records_skipped'] == 20
    assert repeated['status'] == 'success'


def test_duplicates_in_one_file_and_manual_project_codes_do_not_rollback_other_rows(client):
    with SessionLocal() as db:
        db.add(Project(id='manual', project_code='MANUAL', name='Existing', state='WB', district='Kolkata', authority='Agency', project_type='Highway'))
        db.commit()
    result = upload(client, [row('MANUAL'), row('NEW'), row('NEW'), row('ANOTHER')]).json()
    assert result['records_saved'] == 2
    assert result['records_duplicated'] == 2
    assert result['errors'] == []
    with SessionLocal() as db:
        assert db.query(Project).count() == 3


def test_bad_rows_are_reported_without_losing_valid_rows(client):
    result = upload(client, [row('GOOD'), row('BAD', latitude=200), {'project_id':'MISSING'}]).json()
    assert result['status'] == 'partial'
    assert result['records_saved'] == 1 and result['records_failed'] == 2
    assert 'Row 2' in result['errors'][0]
    assert 'latitude' in result['errors'][0]
    with SessionLocal() as db:
        assert db.query(Project).one().project_code == 'GOOD'


def test_final_commit_failure_reports_zero_and_rolls_back_every_row(client, monkeypatch):
    original = Session.commit
    calls = 0
    def commit(session):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise SQLAlchemyError('simulated commit failure')
        return original(session)
    monkeypatch.setattr(Session, 'commit', commit)
    result = upload(client, [row('ONE'), row('TWO')]).json()
    assert result['status'] == 'failed' and result['records_saved'] == 0
    with SessionLocal() as db:
        assert db.query(Project).count() == 0
        log = db.query(DataIngestionLog).one()
        assert log.records_saved == 0 and log.status == 'failed'


def test_uppercase_extension_bom_semicolon_and_explicit_hectares(client):
    content = '\ufeffproject_id;project_name;state;land_required_ha;land_area_acres\nP-1;Project;WB;12;99\n'.encode()
    result = client.post('/api/ingest/upload', files={'file':('records.CSV', content)}).json()
    assert result['records_saved'] == 1
    with SessionLocal() as db:
        assert db.query(Project).one().land_required == 12


@pytest.mark.parametrize('content', [b'', b'project_id,name,state\n', b'{"records":[1]}', b'{broken'])
def test_empty_and_malformed_files_never_claim_success(client, content):
    filename = 'records.json' if content.startswith(b'{') else 'records.csv'
    result = client.post('/api/ingest/upload', files={'file': (filename, content)}).json()
    assert result['status'] == 'failed' and result['records_saved'] == 0
    assert result['errors']


@pytest.mark.parametrize('number', ['NaN', 'Infinity', '-5', 'not-a-number'])
def test_invalid_numeric_fields_are_rejected(client, number):
    result = upload(client, [row(land_required=number)]).json()
    assert result['records_saved'] == 0 and result['records_failed'] == 1
    assert result['status'] == 'failed'


def test_unsupported_file_type_size_and_data_type_are_clear(client):
    assert client.post('/api/ingest/upload', files={'file': ('records.xlsx', b'Excel')}).status_code == 400
    assert client.post('/api/ingest/upload', files={'file': ('records.csv', b'x' * (4*1024*1024+1))}).status_code == 413
    assert client.post('/api/ingest/upload?data_type=typo', files={'file': ('records.csv', b'x')}).status_code == 422
    with SessionLocal() as db:
        assert db.query(DataIngestionLog).count() == 0


def test_official_bundle_import_preserves_source_and_blocks_unknown_prediction(client):
    path = Path(__file__).resolve().parents[2] / "public/datasets/mospi-may2024-projects.json"
    records = json.loads(path.read_text())
    assert len(records) == 30
    assert len({r["project_code"] for r in records}) == 30
    result = upload(client, records, "mospi-may2024-projects.json")
    assert result.status_code == 200
    assert result.json()["records_saved"] == 30
    assert result.json()["records_failed"] == 0
    projects = client.get("/api/projects").json()
    assert len(projects) == 30
    item = next(p for p in projects if p["project_code"] == "N04000100")
    assert item["source_details"]["reported_schedule_slippage_months"] == 8
    assert item["source_details"]["observed_fields"] == []
    assert item["source_name"] == "MoSPI Flash Report — May 2024"
    assert item["source_url"].endswith("#page=159")
    assert item["risk_score"] is None
    assert client.get(f"/api/projects/{item['id']}/validate").json()["can_predict"] is False
    assert client.post(f"/api/projects/{item['id']}/predict-risk").status_code == 422
    repeat = upload(client, records, "mospi-may2024-projects.json").json()
    assert repeat["records_saved"] == 0
    assert repeat["records_duplicated"] == 30

    # An explicit measured zero is different from an absent source value.
    updated = client.patch(f"/api/projects/{item['id']}", json={
        "land_required": 12.5, "affected_families": 0, "current_stage": "Notification"
    })
    assert updated.status_code == 200
    detail = updated.json()
    assert "affected_families" in detail["source_details"]["observed_fields"]
    assert "affected_families" not in detail["source_details"]["missing_fields"]
    assert detail["source_details"]["original_cost_cr"] == 499
    assert client.get(f"/api/projects/{item['id']}/validate").json()["can_predict"] is True


def test_production_map_never_invents_coordinates(client):
    with SessionLocal() as db:
        db.add(Project(id='real-unlocated',project_code='UNLOCATED',name='Official',state='West Bengal',district='Unknown',authority='Agency',project_type='Road',data_classification='REAL'))
        db.add(Project(id='sample-located',project_code='SAMPLE',name='Sample',state='WB',district='Kolkata',authority='Agency',project_type='Road',data_classification='TEST',latitude=22.5,longitude=88.3))
        db.commit()
    assert len(client.get('/api/projects').json()) == 1
    assert len(client.get('/api/projects?dataset=all').json()) == 2
    assert client.get('/api/projects/dashboard-summary').json()['total_projects'] == 1
    assert client.get('/api/map/geojson').json()['features'] == []
    assert client.get('/api/map/summary').json()['projects_without_coordinates'] == 1
