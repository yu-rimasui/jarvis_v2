from fastapi import FastAPI

from jarvis.core.config import get_settings


settings = get_settings()
app = FastAPI(title="Jarvis v2", version="0.1.0")


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    """Return a bounded liveness response without exposing credentials."""

    return {"status": "ok", "environment": settings.app_env}
