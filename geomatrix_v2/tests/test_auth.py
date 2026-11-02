from datetime import datetime, timedelta
import json
import time
from types import SimpleNamespace

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from google.auth import crypt, jwt

import pytest
from fastapi.testclient import TestClient
from google.auth.exceptions import TransportError

from database import SessionLocal
from main import app
from models import AuthSession
from security import token_digest


@pytest.fixture
def client():
    return TestClient(app)


def authenticated_headers(token="test-session"):
    with SessionLocal() as db:
        db.add(AuthSession(token_hash=token_digest(token), subject="user-1", email="officer@example.com",
                           name="Officer", expires_at=datetime.utcnow() + timedelta(hours=1)))
        db.commit()
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize("method,path", [
    ("get", "/api/projects"), ("post", "/api/projects"),
    ("patch", "/api/projects/missing"), ("delete", "/api/projects/missing"),
    ("post", "/api/model/train"), ("post", "/api/ingest/upload"),
    ("post", "/api/projects/missing/predict-risk"),
    ("get", "/api/alerts"), ("get", "/api/map/geojson"),
    ("post", "/api/gemini/explain"),
])
def test_api_requires_server_session(client, method, path):
    assert getattr(client, method)(path).status_code == 401


@pytest.fixture(scope="module")
def signing_material():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption())
    public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    return crypt.RSASigner.from_string(private, key_id="test-key"), public.decode()


@pytest.mark.parametrize("invalid", ["forged", "expired", "wrong-audience", "wrong-issuer"])
def test_invalid_google_token_is_rejected(client, monkeypatch, signing_material, invalid):
    signer, public = signing_material
    certs = json.dumps({"test-key": public}).encode()
    monkeypatch.setattr("routers.auth.Request", lambda: lambda *a, **kw: SimpleNamespace(status=200, data=certs))
    claims = {"iss": "https://accounts.google.com", "aud": "test-client.apps.googleusercontent.com",
              "sub": "google-1", "email": "officer@example.com", "email_verified": True,
              "iat": int(time.time()) - 120, "exp": int(time.time()) + 3600}
    if invalid == "expired": claims['exp'] = int(time.time()) - 60
    if invalid == "wrong-audience": claims['aud'] = 'other-client'
    if invalid == "wrong-issuer": claims['iss'] = 'https://attacker.invalid'
    token = jwt.encode(signer, claims).decode()
    if invalid == 'forged':
        header, payload, signature = token.split('.')
        signature = ('A' if signature[0] != 'A' else 'B') + signature[1:]
        token = '.'.join([header, payload, signature])
    response = client.post("/api/auth/google", json={"credential": token})
    assert response.status_code == 401
    with SessionLocal() as db:
        assert db.query(AuthSession).count() == 0


def test_valid_signed_google_token_creates_session(client, monkeypatch, signing_material):
    signer, public = signing_material
    certs = json.dumps({"test-key": public}).encode()
    monkeypatch.setattr("routers.auth.Request", lambda: lambda *a, **kw: SimpleNamespace(status=200, data=certs))
    claims = {"iss": "https://accounts.google.com", "aud": "test-client.apps.googleusercontent.com",
              "sub": "google-1", "email": "officer@example.com", "email_verified": True,
              "iat": int(time.time()) - 60, "exp": int(time.time()) + 3600}
    response = client.post('/api/auth/google', json={'credential': jwt.encode(signer, claims).decode()})
    assert response.status_code == 200
    assert response.json()['user']['sub'] == 'google-1'


def test_google_verifier_receives_configured_audience(client, monkeypatch):
    seen = {}
    def verify(token, request, audience):
        seen.update(token=token, audience=audience)
        return {"sub": "google-123", "email": "officer@example.com", "email_verified": True, "name": "Officer"}
    monkeypatch.setattr("routers.auth.id_token.verify_oauth2_token", verify)
    response = client.post("/api/auth/google", json={"credential": "verified-by-google"})
    assert response.status_code == 200
    assert seen == {"token": "verified-by-google", "audience": "test-client.apps.googleusercontent.com"}
    token = response.json()["token"]
    with SessionLocal() as db:
        assert db.get(AuthSession, token_digest(token)).subject == "google-123"
        assert db.get(AuthSession, token) is None
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200


@pytest.mark.parametrize("claims", [
    {"sub": "1", "email": "x@example.com", "email_verified": False},
    {"email": "x@example.com", "email_verified": True},
    {"sub": "1", "email": "x@example.com", "email_verified": "true"},
])
def test_unverified_or_incomplete_identity_rejected(client, monkeypatch, claims):
    monkeypatch.setattr("routers.auth.id_token.verify_oauth2_token", lambda *args: claims)
    assert client.post("/api/auth/google", json={"credential": "token"}).status_code == 401


def test_allowlist_and_verification_outage(client, monkeypatch):
    monkeypatch.setenv("AUTH_ALLOWED_EMAILS", "authorized@example.com")
    monkeypatch.setattr("routers.auth.id_token.verify_oauth2_token", lambda *args: {
        "sub": "1", "email": "other@example.com", "email_verified": True})
    assert client.post("/api/auth/google", json={"credential": "token"}).status_code == 403
    def unavailable(*args):
        raise TransportError("Network unavailable")
    monkeypatch.setattr("routers.auth.id_token.verify_oauth2_token", unavailable)
    assert client.post("/api/auth/google", json={"credential": "token"}).status_code == 503


def test_expired_unknown_and_revoked_sessions(client):
    assert client.get("/api/projects", headers={"Authorization": "Bearer invented"}).status_code == 401
    headers = authenticated_headers()
    assert client.get("/api/projects", headers=headers).status_code == 200
    assert client.post("/api/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/projects", headers=headers).status_code == 401
    headers = authenticated_headers("expired")
    with SessionLocal() as db:
        db.get(AuthSession, token_digest("expired")).expires_at = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    assert client.get("/api/projects", headers=headers).status_code == 401


def test_health_is_public(client):
    assert client.get("/health").status_code == 200


def test_project_crud_persists_without_invented_predictions(client):
    headers = authenticated_headers()
    payload = {'project_code': 'PERSIST-1', 'name': 'Saved project', 'state': 'West Bengal',
               'district': 'Kolkata', 'authority': 'Test agency', 'project_type': 'Highway',
               'land_required': 100, 'affected_families': 20, 'current_stage': 'Notification'}
    response = client.post('/api/projects', headers=headers, json=payload)
    assert response.status_code == 201
    project = response.json()
    for field in ('risk_score', 'delay_probability', 'predicted_delay_days', 'confidence'):
        assert project[field] is None
    project_id = project['id']
    # A fresh HTTP client reads the persisted record, independent of process-local arrays.
    fresh_client = TestClient(app)
    assert fresh_client.get(f'/api/projects/{project_id}', headers=headers).json()['name'] == 'Saved project'
    assert fresh_client.patch(f'/api/projects/{project_id}', headers=headers, json={'name': 'Updated'}).status_code == 200
    assert client.get(f'/api/projects/{project_id}', headers=headers).json()['name'] == 'Updated'
    assert client.get(f'/api/projects/{project_id}/risk', headers=headers).json()['risk_score'] is None
    assert client.post('/api/projects', headers=headers, json=payload).status_code == 409
    assert client.delete(f'/api/projects/{project_id}', headers=headers).status_code == 204
    assert fresh_client.get(f'/api/projects/{project_id}', headers=headers).status_code == 404


def test_acknowledgement_is_persisted(client):
    from models import Alert, Project
    headers = authenticated_headers()
    with SessionLocal() as db:
        db.add(Project(id='p', project_code='p', name='Project', state='WB', district='Kolkata',
                       authority='Agency', project_type='Highway'))
        db.flush()
        db.add(Alert(id='a', project_id='p', severity='High', reason='Needs review'))
        db.commit()
    assert client.post('/api/alerts/a/acknowledge', headers=headers).status_code == 200
    with SessionLocal() as db:
        assert db.get(Alert, 'a').status == 'Acknowledged'
    assert client.post('/api/alerts/missing/acknowledge', headers=headers).status_code == 404
