"""Never run tests against the repository snapshot or a production database."""
import os
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

_TEST_ROOT = tempfile.TemporaryDirectory(prefix="geomatrix-tests-")
test_database_url = os.getenv("TEST_DATABASE_URL")
if test_database_url:
    parsed = urlsplit(test_database_url)
    if (os.getenv("CI") != "true" or parsed.hostname not in {"127.0.0.1", "localhost"}
            or parsed.path != "/geomatrix_test"):
        raise RuntimeError("External database tests require the isolated local CI service.")
    os.environ["DATABASE_URL"] = test_database_url
else:
    os.environ["DATABASE_URL"] = f"sqlite:///{Path(_TEST_ROOT.name) / 'test.db'}"
os.environ["GOOGLE_CLIENT_ID"] = "test-client.apps.googleusercontent.com"

import pytest
from database import Base, engine


@pytest.fixture(autouse=True)
def clean_test_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
