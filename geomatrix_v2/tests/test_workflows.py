from fastapi.testclient import TestClient
from main import app
from database import SessionLocal
from models import Project, Alert, Intervention
from security import require_session

client = TestClient(app)
ACCOUNT = {"name": "Audit", "email": "workflow@example.com", "password": "A long workflow passphrase"}
PROJECT = {"project_code": "AUDIT-1", "name": "Audit project", "state": "Test", "district": "Test", "authority": "QA", "project_type": "Road"}

def headers():
    response = client.post("/api/auth/register", json=ACCOUNT)
    assert response.status_code == 201
    return {"Authorization": "Bearer " + response.json()["token"]}

def test_interventions_persist_and_cascade_with_project():
    auth = headers()
    project = client.post("/api/projects", json=PROJECT, headers=auth).json()
    path = "/api/projects/" + project["id"] + "/interventions"
    body = {"action": "Intervention", "assigned_to": "QA Officer", "priority": "High", "due_date": "2026-12-01", "note": "Verify persisted assignment"}
    assert client.post(path, json=body).status_code == 401
    saved = client.post(path, json=body, headers=auth)
    assert saved.status_code == 201
    assert client.get(path, headers=auth).json()[0]["note"] == body["note"]
    assert client.get("/api/projects/interventions/all/records", headers=auth).json()[0]["project_name"] == PROJECT["name"]
    assert client.post(path, json={**body,"due_date":"invalid"}, headers=auth).status_code == 422
    assert client.delete("/api/projects/"+project["id"], headers=auth).status_code == 204
    with SessionLocal() as db:
        assert db.query(Intervention).count() == 0

def test_alert_all_filter_and_status_assignment_survive_reload():
    auth=headers()
    project=client.post("/api/projects", json=PROJECT, headers=auth).json()
    with SessionLocal() as db:
        db.add(Alert(id="alert-1",project_id=project["id"],severity="High",reason="Audit",status="Open"))
        db.commit()
    assert len(client.get("/api/alerts?status=All",headers=auth).json()) == 1
    assert client.patch("/api/alerts/alert-1",json={"assigned_to":"QA"},headers=auth).status_code == 409
    assert client.patch("/api/alerts/alert-1",json={"status":"Acknowledged","assigned_to":"QA"},headers=auth).status_code == 200
    assert client.get("/api/alerts?status=all",headers=auth).json()[0]["assigned_to"] == "QA"
    assert client.patch("/api/alerts/alert-1",json={"status":"Resolved","outcome":"Verified"},headers=auth).status_code == 200
    assert client.get("/api/alerts?status=Resolved",headers=auth).json()[0]["outcome"] == "Verified"

def test_scenario_is_not_a_persisted_prediction(monkeypatch):
    auth=headers()
    project=client.post("/api/projects",json=PROJECT,headers=auth).json()
    import routers.projects as router
    monkeypatch.setattr(router,"validate_prediction_inputs",lambda _:[])
    monkeypatch.setattr(router,"predict_project_risk",lambda record:{"status":"ok","risk_score":12,"risk_level":"Low"})
    response=client.post("/api/projects/"+project["id"]+"/simulate",json={"objection_count":0,"legal_case_count":0,"doc_completeness_pct":90,"approval_pending":False,"rr_status":"Completed"},headers=auth)
    assert response.status_code == 200
    assert response.json()["prediction"]["risk_score"] == 12
    stored=client.get("/api/projects/"+project["id"],headers=auth).json()
    assert stored["risk_score"] is None
    assert stored["doc_completeness_pct"] == 50

def test_project_coordinates_and_counts_are_validated():
    auth=headers()
    assert client.post("/api/projects",json={**PROJECT,"latitude":95},headers=auth).status_code == 422
    assert client.post("/api/projects",json={**PROJECT,"land_required":-2},headers=auth).status_code == 422
