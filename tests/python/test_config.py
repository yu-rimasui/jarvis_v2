from jarvis.core.config import Settings


def test_local_defaults_are_loopback_safe() -> None:
    settings = Settings()

    assert settings.app_port == 8000
    assert settings.qdrant_url == "http://vector-db:6333"
    assert "postgresql+psycopg://" in settings.database_url
