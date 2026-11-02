"""Never run tests against the repository snapshot or a production database."""
import os
import tempfile
from pathlib import Path

_TEST_ROOT = tempfile.TemporaryDirectory(prefix="geomatrix-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_TEST_ROOT.name) / 'test.db'}"
os.environ["GOOGLE_CLIENT_ID"] = "test-client.apps.googleusercontent.com"

import pytest
from database import Base, engine


@pytest.fixture(autouse=True)
def clean_test_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
