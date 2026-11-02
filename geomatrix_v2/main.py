import os
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from security import require_session
from routers.alerts import router as alerts_router
from routers.auth import router as auth_router
from routers.gemini import router as gemini_router
from routers.ingest import router as ingest_router
from routers.map import router as map_router
from routers.ml import router as ml_router
from routers.projects import router as projects_router

def _cors_origins() -> list[str]:
    configured = os.getenv("CORS_ORIGINS", "")
    origins = [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]
    frontend_url = os.getenv("FRONTEND_URL", "").strip().rstrip("/")
    if frontend_url and frontend_url not in origins:
        origins.append(frontend_url)
    return origins or ["http://localhost:3000", "http://127.0.0.1:3000"]


app = FastAPI(title="Geomatrix v2")
@app.exception_handler(RequestValidationError)
async def safe_validation_error(request: Request, exc: RequestValidationError):
    if request.url.path.startswith("/api/auth/"):
        # Pydantic's default validation payload contains the submitted input.
        # Credentials must never be echoed, even on malformed requests.
        return JSONResponse(status_code=422, content={"detail": "Check your account details and try again."},
                            headers={"Cache-Control": "no-store"})
    return await request_validation_exception_handler(request, exc)


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
for protected_router in (gemini_router, projects_router, alerts_router, ingest_router, map_router, ml_router):
    app.include_router(protected_router, dependencies=[Depends(require_session)])


init_db()


@app.get("/health")
def health():
    return {"status": "ok"}
