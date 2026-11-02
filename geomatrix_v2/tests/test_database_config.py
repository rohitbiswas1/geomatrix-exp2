"""Provider URL compatibility without opening a database connection."""
import pytest
import database


@pytest.mark.parametrize('scheme', ['postgres://', 'postgresql://', 'postgresql+psycopg://'])
def test_provider_urls_use_installed_driver_and_reuse_engine(monkeypatch, scheme):
    monkeypatch.setattr(database, 'DATABASE_URL', scheme + 'officer:example-password@localhost/isolated_test')
    dynamic = database._DynamicEngine()
    try:
        assert dynamic.url.drivername == 'postgresql+psycopg'
        initial = dynamic._engine
        assert dynamic.name == 'postgresql'
        assert dynamic._engine is initial
        assert dynamic.url.password == 'example-password'
    finally:
        if dynamic._engine is not None:
            dynamic._engine.dispose()
