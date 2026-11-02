"""Verify Google credentials, then issue a persistent, short-lived session."""
import os
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from google.auth.exceptions import GoogleAuthError, TransportError
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models import AuthSession
from security import require_session, session_user, token_digest

router = APIRouter(prefix="/api/auth", tags=["auth"])
SESSION_SECONDS = 8 * 60 * 60


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=1, max_length=16384)


@router.post("/login")
def login():
    raise HTTPException(403, "Password login is disabled. Use Google sign-in.")


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

    allowed = {value.strip().lower() for value in os.getenv("AUTH_ALLOWED_EMAILS", "").split(",") if value.strip()}
    if allowed and claims["email"].lower() not in allowed:
        raise HTTPException(403, "This account is not authorized for GEOMATRIX.")

    token = secrets.token_urlsafe(32)
    session = AuthSession(
        token_hash=token_digest(token), subject=claims["sub"], email=claims["email"],
        name=claims.get("name") or claims["email"],
        expires_at=datetime.utcnow() + timedelta(seconds=SESSION_SECONDS),
    )
    db.query(AuthSession).filter(AuthSession.expires_at <= datetime.utcnow()).delete()
    db.add(session)
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    # Only the Next.js server consumes this token; browser JS receives user data.
    return {"success": True, "user": session_user(session), "token": token, "expires_in": SESSION_SECONDS}


@router.get("/me")
def me(response: Response, session: AuthSession = Depends(require_session)):
    response.headers["Cache-Control"] = "no-store"
    return {"user": session_user(session)}


@router.post("/logout", status_code=204)
def logout(session: AuthSession = Depends(require_session), db: Session = Depends(get_db)):
    db.delete(session)
    db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
