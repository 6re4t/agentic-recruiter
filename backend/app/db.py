import os
from sqlmodel import SQLModel, create_engine, Session
from .settings import settings


def _connect_args_for_sqlite(url: str) -> dict:
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


engine = create_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args=_connect_args_for_sqlite(settings.DATABASE_URL),
)


def create_db_and_tables() -> None:
    if settings.DATABASE_URL.startswith("sqlite"):
        os.makedirs("./data", exist_ok=True)
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session