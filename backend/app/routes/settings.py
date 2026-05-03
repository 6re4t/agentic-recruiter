"""
User-editable outreach settings stored in data/settings.json.
These are defaults passed to the graph, batch, and outreach endpoints.
"""
import json
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from ..settings import settings as app_settings

router = APIRouter(prefix="/settings", tags=["settings"])

_SETTINGS_FILE = Path(app_settings.DATABASE_URL.replace("sqlite:///", "")).parent / "settings.json"

DEFAULTS = {
    "sender_name": "Recruiting Team",
    "sender_company": "Your Company",
    "tone": "friendly and concise",
    "require_approval": True,
    "default_top_k": 3,
    "rejection_threshold": 50,
}


def _load() -> dict:
    if _SETTINGS_FILE.exists():
        try:
            data = json.loads(_SETTINGS_FILE.read_text(encoding="utf-8"))
            return {**DEFAULTS, **data}
        except Exception:
            pass
    return dict(DEFAULTS)


def _save(data: dict) -> None:
    _SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _SETTINGS_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


class OutreachSettings(BaseModel):
    sender_name: str = DEFAULTS["sender_name"]
    sender_company: str = DEFAULTS["sender_company"]
    tone: str = DEFAULTS["tone"]
    require_approval: bool = DEFAULTS["require_approval"]
    default_top_k: int = DEFAULTS["default_top_k"]
    rejection_threshold: int = DEFAULTS["rejection_threshold"]


@router.get("", response_model=OutreachSettings)
def get_settings():
    return _load()


@router.put("", response_model=OutreachSettings)
def update_settings(payload: OutreachSettings):
    data = payload.model_dump()
    _save(data)
    return data


@router.get("/env")
def get_env_info():
    """Return read-only runtime environment values for display in the settings UI."""
    return {
        "model": app_settings.OPENROUTER_MODEL,
        "openrouter_base_url": app_settings.OPENROUTER_BASE_URL,
        "smtp_enabled": app_settings.SMTP_ENABLED,
        "smtp_host": app_settings.SMTP_HOST,
        "smtp_from_email": app_settings.SMTP_FROM_EMAIL,
        "database_url": app_settings.DATABASE_URL,
    }
