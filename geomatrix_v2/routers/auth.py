"""Verify Google or password credentials, then issue a revocable session."""
import os
import secrets
import re
import time
from uuid import uuid4
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, Request as HTTPRequest
from google.auth.exceptions import GoogleAuthError, TransportError
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from models import AuthSession, PasswordAccount, AuthAttempt
from passwords import hash_password, verify_password, DUMMY_HASH
from security import require_session, session_user, token_digest

router = APIRouter(prefix="/api/auth", tags=["auth"])
SESSION_SECONDS = 8 * 60 * 60


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=1, max_length=16384)


class PasswordLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address.")
        return value


class RegisterRequest(PasswordLoginRequest):
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=12, max_length=128)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Enter your name.")
        return value


def enforce_allowlist(email):
    allowed = {v.strip().lower() for v in os.getenv("AUTH_ALLOWED_EMAILS", "").split(",") if v.strip()}
    if allowed and email.lower() not in allowed:
        raise HTTPException(403, "This account is not authorized for GEOMATRIX.")


def enforce_password_access():
    # A password account has not proven email ownership. Never let it satisfy
    # a verified-email allowlist by simply claiming an authorized address.
    if os.getenv("AUTH_ALLOWED_EMAILS", "").strip():
        raise HTTPException(403, "This workspace requires verified Google sign-in.")


def require_password_storage():
    # Render's free filesystem is replaced on deploy. Never accept accounts
    # into that ephemeral SQLite fallback and later silently lose credentials.
    if os.getenv("RENDER") and not os.getenv("DATABASE_URL", "").startswith(("postgresql://", "postgresql+psycopg://", "postgres://")):
        raise HTTPException(503, "Email sign-in is temporarily unavailable. Please use Google sign-in.")


def limit_attempts(db, email, request):
    # Atomic, database-backed fixed-window counters shared by every worker.
    cutoff = datetime.utcnow() - timedelta(minutes=15)
    db.query(AuthAttempt).filter(AuthAttempt.attempted_at < cutoff).delete()
    db.commit()
    bucket = int(time.time()) // 900
    identities = [("email:" + email, 10),
                  ("ip:" + (request.client.host if request.client else "unknown"), 100)]
    for identity, limit in identities:
        key = token_digest(f"{identity}:{bucket}")
        if db.get(AuthAttempt, key) is None:
            db.add(AuthAttempt(id=key, count=0))
            try:
                db.commit()
            except IntegrityError:
                db.rollback()  # Another worker initialized this bucket first.
        changed = db.query(AuthAttempt).filter(AuthAttempt.id == key, AuthAttempt.count < limit).update(
            {AuthAttempt.count: AuthAttempt.count + 1}, synchronize_session=False)
        db.commit()
        if changed != 1:
            raise HTTPException(429, "Too many attempts. Try again in 15 minutes.", headers={"Retry-After": "900"})


def issue_session(db, response, subject, email, name):
    token = secrets.token_urlsafe(32)
    session = AuthSession(token_hash=token_digest(token), subject=subject, email=email, name=name,
                          expires_at=datetime.utcnow() + timedelta(seconds=SESSION_SECONDS))
    db.query(AuthSession).filter(AuthSession.expires_at <= datetime.utcnow()).delete()
    db.add(session)
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return {"success": True, "user": session_user(session), "token": token, "expires_in": SESSION_SECONDS}


@router.post("/register", status_code=201)
def register(body: RegisterRequest, request: HTTPRequest, response: Response, db: Session = Depends(get_db)):
    require_password_storage()
    limit_attempts(db, body.email, request)
    enforce_password_access()
    account = PasswordAccount(id=str(uuid4()), email=body.email, name=body.name,
                              password_hash=hash_password(body.password))
    db.add(account)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Unable to create this account. Try signing in or use another email.") from exc
    return issue_session(db, response, "password:" + account.id, account.email, account.name)


@router.post("/login")
def login(body: PasswordLoginRequest, request: HTTPRequest, response: Response, db: Session = Depends(get_db)):
    require_password_storage()
    limit_attempts(db, body.email, request)
    account = db.query(PasswordAccount).filter(PasswordAccount.email == body.email).first()
    valid = verify_password(body.password, account.password_hash if account else DUMMY_HASH)
    if not account or not valid:
        raise HTTPException(401, "Email or password is incorrect.")
    enforce_password_access()
    return issue_session(db, response, "password:" + account.id, account.email, account.name)


@router.post("/google")
def google_login(body: GoogleLoginRequest, response: Response, db: Session = Depends(get_db)):
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    if not client_id:
        raise HTTPException(503, "Google sign-in is not configured on the API.")
    try:
        # Google's library checks signature, audience, issuer and expiry.
        claims = id_token.verify_oauth2_token(body.credential, Request(), client_id)
    except TransportError as exc:
        raise HTTPException(503, "Google verification is temporarily unavailable.") from exc
    except (ValueError, GoogleAuthError) as exc:
        raise HTTPException(401, "Google credential could not be verified.") from exc
    if not claims.get("sub") or not claims.get("email") or claims.get("email_verified") is not True:
        raise HTTPException(401, "A verified Google email is required.")

    enforce_allowlist(claims["email"])
    # Google identities and password accounts are deliberately not linked by email.
    return issue_session(db, response, claims["sub"], claims["email"], claims.get("name") or claims["email"])


@router.get("/me")
def me(response: Response, session: AuthSession = Depends(require_session)):
    response.headers["Cache-Control"] = "no-store"
    return {"user": session_user(session)}


@router.post("/logout", status_code=204)
def logout(session: AuthSession = Depends(require_session), db: Session = Depends(get_db)):
    db.delete(session)
    db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
