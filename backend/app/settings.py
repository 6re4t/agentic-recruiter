from typing import List
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    OPENROUTER_API_KEY: str | None = None
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    OPENROUTER_MODEL: str = "openai/gpt-4o-2024-08-06"

    DATABASE_URL: str = f"sqlite:///{(DATA_DIR / 'app.db').as_posix()}"
    UPLOAD_DIR: str = str(DATA_DIR / "uploads")

    CORS_ORIGINS: str = "http://localhost:3000"

    OCR_MAX_PAGES: int = 6
    TEXT_MIN_CHARS_FOR_NO_OCR: int = 300

    CHECKPOINT_DB_PATH: str = str(DATA_DIR / "checkpoints.sqlite")

    SMTP_ENABLED: bool = False
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_USE_TLS: bool = True
    SMTP_USE_SSL: bool = False
    SMTP_FROM_EMAIL: str = "noreply@example.com"
    SMTP_FROM_NAME: str = "Recruiting Team"
    SMTP_AUTO_SEND_APPROVED: bool = False

    def cors_origins_list(self) -> List[str]:
        return [x.strip() for x in self.CORS_ORIGINS.split(",") if x.strip()]


settings = Settings()
