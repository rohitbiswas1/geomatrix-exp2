from datetime import datetime, timedelta

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


def test_forged_google_token_is_rejected(client):
    # Real verifier must reject this without accepting its claimed email.
    response = client.post("/api/auth/google", json={"credential": "x.eyJlbWFpbCI6ImFkbWluQGV4YW1wbGUuY29tIn0.x"})
    assert response.status_code == 401
    with SessionLocal() as db:
        assert db.query(AuthSession).count() == 0


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
