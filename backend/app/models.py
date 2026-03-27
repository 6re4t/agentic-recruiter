import datetime
from typing import Optional
from sqlmodel import SQLModel, Field


class Job(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: str
    rubric: str
    created_at: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)


class Candidate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    name: Optional[str] = None
    email: Optional[str] = None

    pdf_path: Optional[str] = None
    resume_text: Optional[str] = None

    stage: str = "Sourced"          # Sourced, Processing, Ready, Error, Contacted, Scheduled...
    processing_status: str = "new"  # new, extracting, ready, error

    text_extraction_method: Optional[str] = None  # text, ocr, failed
    extraction_error: Optional[str] = None

    extracted_json: Optional[str] = None
    score: Optional[float] = None
    score_reason: Optional[str] = None

    outreach_json: Optional[str] = None
    outreach_status: Optional[str] = None  # draft, approved, rejected

    created_at: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)


class AgentRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    thread_id: str  # LangGraph thread id (checkpoint key)
    job_id: int
    candidate_id: int

    status: str = "running"  # running, waiting_approval, completed, failed, cancelled
    error: Optional[str] = None

    created_at: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)
    updated_at: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)


class AuditLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ts: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)

    action: str
    entity_type: str
    entity_id: Optional[int] = None
    detail: Optional[str] = None