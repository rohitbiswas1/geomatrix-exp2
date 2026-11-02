"""Database-backed, revocable bearer sessions for API access."""
import hashlib
from datetime import datetime

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from database import get_db
from models import AuthSession

bearer = HTTPBearer(auto_error=False)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def require_session(
    credential: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> AuthSession:
    if credential is None or credential.scheme.lower() != "bearer":
        raise HTTPException(401, "Sign in required", headers={"WWW-Authenticate": "Bearer"})
    session = db.get(AuthSession, token_digest(credential.credentials))
    if session is None or session.expires_at <= datetime.utcnow():
        raise HTTPException(401, "Session is invalid or expired", headers={"WWW-Authenticate": "Bearer"})
    return session


def session_user(session: AuthSession) -> dict:
    return {"sub": session.subject, "email": session.email, "name": session.name,
            "role": "Project Officer"}
