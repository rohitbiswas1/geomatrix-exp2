"""Database session factory for Geomatrix v2.

SQLite remains the local default; production must provide DATABASE_URL.
"""
import os
import logging
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from models import Base

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), "geomatrix.db")
DATABASE_URL = os.getenv("DATABASE_URL") or f"sqlite:///{DB_PATH}"


class _DynamicEngine:
    """Proxy engine that follows the current DATABASE_URL value."""

    def __init__(self):
        self._engine = None
        self._current_url = None

    def _ensure_engine(self):
        current_url = globals().get("DATABASE_URL", DATABASE_URL)
        if current_url.startswith("postgres://"):
            current_url = current_url.replace("postgres://", "postgresql+psycopg://", 1)
        elif current_url.startswith("postgresql://"):
            current_url = current_url.replace("postgresql://", "postgresql+psycopg://", 1)
        is_sqlite = current_url.startswith("sqlite")
        engine_options = {"echo": False, "pool_pre_ping": True}
        if is_sqlite:
            engine_options.update({
                "connect_args": {"check_same_thread": False},
                "poolclass": StaticPool,
            })
        else:
            engine_options["connect_args"] = {"connect_timeout": 10}
        if self._engine is None or self._current_url != current_url:
            if self._engine is not None:
                self._engine.dispose()
            self._engine = create_engine(current_url, **engine_options)
            self._current_url = current_url
        return self._engine

    def __getattr__(self, name):
        return getattr(self._ensure_engine(), name)

    def __call__(self, *args, **kwargs):
        return self._ensure_engine()(*args, **kwargs)


engine = _DynamicEngine()
_session_factory = sessionmaker(autocommit=False, autoflush=False)


def SessionLocal():
    """Bind to a real Engine so every flush shares the session's transaction.

    SQLAlchemy caches connections by the Engine object, not this module's
    dynamic proxy. Binding the proxy can open another PostgreSQL connection
    between flushes and lose visibility of the transaction's pending records.
    """
    return _session_factory(bind=engine._ensure_engine())

# New columns added in the real-data upgrade. ALTER TABLE is idempotent because
# SQLite raises "duplicate column name" which we silently ignore.
_MIGRATION_STATEMENTS = [
    "ALTER TABLE alerts ADD COLUMN assigned_to TEXT",
    "ALTER TABLE alerts ADD COLUMN due_date TEXT",
    "ALTER TABLE alerts ADD COLUMN outcome TEXT",
    "ALTER TABLE projects ADD COLUMN source_details JSON",
    "ALTER TABLE historical_delay_records ADD COLUMN training_data_version INTEGER DEFAULT 1 NOT NULL",
    "ALTER TABLE projects ADD COLUMN compensation_status TEXT",
    "ALTER TABLE projects ADD COLUMN objection_count INTEGER DEFAULT 0",
    "ALTER TABLE projects ADD COLUMN legal_case_count INTEGER DEFAULT 0",
    "ALTER TABLE projects ADD COLUMN rr_status TEXT",
    "ALTER TABLE projects ADD COLUMN env_clearance_status TEXT",
    "ALTER TABLE projects ADD COLUMN forest_clearance_status TEXT",
    "ALTER TABLE projects ADD COLUMN crz_status TEXT",
    "ALTER TABLE projects ADD COLUMN doc_completeness_pct REAL DEFAULT 50.0",
    "ALTER TABLE projects ADD COLUMN approval_pending INTEGER DEFAULT 0",
    "ALTER TABLE projects ADD COLUMN overdue_milestones INTEGER DEFAULT 0",
]


def _run_migrations():
    """Apply schema migrations safely (idempotent)."""
    # Inspect columns instead of deliberately triggering duplicate-column errors.
    # PostgreSQL aborts a transaction after a failed ALTER TABLE.
    for stmt in _MIGRATION_STATEMENTS:
        parts = stmt.split()
        table, column = parts[2], parts[5]
        with engine.begin() as conn:
            columns = {entry["name"] for entry in inspect(conn).get_columns(table)}
            if column not in columns:
                conn.execute(text(stmt))


def init_db():
    Base.metadata.create_all(bind=engine)
    _run_migrations()
    logger.info("Database initialised and migrations applied.")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
