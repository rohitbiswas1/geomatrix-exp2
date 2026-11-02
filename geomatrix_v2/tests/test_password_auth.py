from datetime import datetime, timedelta
from fastapi.testclient import TestClient
import pytest
from main import app
from database import SessionLocal, init_db
from models import PasswordAccount, AuthAttempt
from passwords import hash_password, verify_password

@pytest.fixture
def client():
    return TestClient(app)

ACCOUNT = {"name": "Test Officer", "email": "officer@example.com", "password": "A long test passphrase 123!"}


def test_registration_login_and_revocation(client):
    created = client.post('/api/auth/register', json={**ACCOUNT, 'email': 'OFFICER@example.com'})
    assert created.status_code == 201
    data = created.json()
    assert data['user']['email'] == ACCOUNT['email']
    assert ACCOUNT['password'] not in str(data)
    assert 'password_hash' not in data['user']
    assert 'password' not in data['user']
    with SessionLocal() as db:
        account = db.query(PasswordAccount).one()
        assert account.password_hash != ACCOUNT['password']
        assert verify_password(ACCOUNT['password'], account.password_hash)
    # Re-initializing the schema and using a new client preserves the account.
    init_db()
    fresh = TestClient(app)
    logged_in = fresh.post('/api/auth/login', json={k:v for k,v in ACCOUNT.items() if k != 'name'})
    assert logged_in.status_code == 200
    assert logged_in.json()['user']['sub'] == data['user']['sub']
    assert logged_in.json()['token'] != data['token']
    headers = {'Authorization': 'Bearer ' + logged_in.json()['token']}
    assert fresh.get('/api/auth/me', headers=headers).status_code == 200
    assert fresh.post('/api/auth/logout', headers=headers).status_code == 204
    assert fresh.get('/api/auth/me', headers=headers).status_code == 401


def test_passwords_are_salted_and_fail_closed():
    one, two = hash_password('a secure passphrase'), hash_password('a secure passphrase')
    assert one != two
    assert verify_password('a secure passphrase', one)
    assert not verify_password('incorrect', one)
    assert not verify_password('anything', 'bad-format')


def test_wrong_password_unknown_account_and_duplicates(client):
    assert client.post('/api/auth/register', json=ACCOUNT).status_code == 201
    assert client.post('/api/auth/register', json=ACCOUNT).status_code == 409
    invalid = client.post('/api/auth/login', json={'email': ACCOUNT['email'], 'password': 'wrong'})
    unknown = client.post('/api/auth/login', json={'email': 'unknown@example.com', 'password': 'wrong'})
    assert invalid.status_code == unknown.status_code == 401
    assert invalid.json() == unknown.json()


@pytest.mark.parametrize('changes', [
    {'password': 'short'}, {'password': 'x'*129}, {'name': '   '}, {'email': 'bad-email'},
])
def test_registration_validates_input(client, changes):
    assert client.post('/api/auth/register', json={**ACCOUNT, **changes}).status_code == 422
    with SessionLocal() as db:
        assert db.query(PasswordAccount).count() == 0


def test_password_flow_respects_allowlist(client, monkeypatch):
    monkeypatch.setenv('AUTH_ALLOWED_EMAILS', ACCOUNT['email'])
    assert client.post('/api/auth/register', json=ACCOUNT).status_code == 403
    monkeypatch.delenv('AUTH_ALLOWED_EMAILS')
    assert client.post('/api/auth/register', json=ACCOUNT).status_code == 201
    monkeypatch.setenv('AUTH_ALLOWED_EMAILS', 'authorized@example.com')
    assert client.post('/api/auth/login', json=ACCOUNT).status_code == 403


def test_attempt_limit_persists_and_expires(client):
    for _ in range(10):
        assert client.post('/api/auth/login', json={'email': ACCOUNT['email'], 'password': 'wrong'}).status_code == 401
    fresh = TestClient(app)
    limited = fresh.post('/api/auth/register', json=ACCOUNT)
    assert limited.status_code == 429
    assert limited.headers['retry-after'] == '900'
    with SessionLocal() as db:
        for attempt in db.query(AuthAttempt).all():
            attempt.attempted_at = datetime.utcnow() - timedelta(minutes=16)
        db.commit()
    assert fresh.post('/api/auth/register', json=ACCOUNT).status_code == 201


def test_render_refuses_ephemeral_password_storage(client, monkeypatch):
    monkeypatch.setenv('RENDER', 'true')
    monkeypatch.delenv('DATABASE_URL')
    assert client.post('/api/auth/register', json=ACCOUNT).status_code == 503
    assert client.post('/api/auth/login', json=ACCOUNT).status_code == 503
    with SessionLocal() as db:
        assert db.query(PasswordAccount).count() == 0
