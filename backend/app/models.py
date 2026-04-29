import datetime
from typing import Optional
from sqlmodel import SQLModel, Field


class Job(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: str
    rubric: str
    analyzed_json: Optional[str] = None  # cached output of job_analysis_agent

    # Blind scoring: when True, name/email/location/graduation year are stripped
    # from the candidate profile before it reaches the scoring LLM.
    blind_scoring: bool = Field(default=False)

    # Semantic search embedding (JSON-encoded float list, cached on first search)
    embedding: Optional[str] = None

    created_at: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)


class Candidate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    resume_hash: Optional[str] = Field(default=None, index=True)  # sha256 of resume_text for dedup

    pdf_path: Optional[str] = None
    resume_text: Optional[str] = None

    stage: str = "Sourced"          # Sourced, Processing, Ready, Error
    processing_status: str = "new"  # new, extracting, ready, error

    text_extraction_method: Optional[str] = None  # text, ocr, failed
    extraction_error: Optional[str] = None

    extracted_json: Optional[str] = None

    # Semantic search embedding (JSON-encoded float list, cached on first search)
    embedding: Optional[str] = None
    score: Optional[float] = None
    score_reason: Optional[str] = None
    outreach_json: Optional[str] = None
    outreach_status: Optional[str] = None

    created_at: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)


class Application(SQLModel, table=True):
    """Join between a Candidate and a Job. Holds all job-specific state."""
    id: Optional[int] = Field(default=None, primary_key=True)

    candidate_id: int = Field(index=True)
    job_id: int = Field(index=True)

    stage: str = "Applied"  # Applied, Scoring, Scored, Outreach_Draft, Contacted, Rejected

    score: Optional[float] = None
    score_reason: Optional[str] = None
    score_json: Optional[str] = None  # full ScoreResult JSON (category_scores, strengths, gaps, evidence)

    outreach_json: Optional[str] = None
    outreach_status: Optional[str] = None  # draft, approved, rejected, sent, send_failed

    recruiter_notes: Optional[str] = None  # free-text notes added by the recruiter

    created_at: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)
    updated_at: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)


class AgentRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    thread_id: str  # LangGraph thread id (checkpoint key)
    job_id: int
    candidate_id: int
    application_id: Optional[int] = None  # FK to Application

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