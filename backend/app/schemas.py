from typing import Optional, List, Any
from pydantic import BaseModel, EmailStr, Field as PydField


class JobCreate(BaseModel):
    title: str
    description: str
    rubric: str


class CandidateCreate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    resume_text: str


class CandidateExtract(BaseModel):
    headline: str
    seniority: str = PydField(description="One of: intern, junior, mid, senior, lead, unknown")
    years_experience: Optional[int] = None
    roles: List[str]
    skills: List[str]
    location: Optional[str] = None
    highlights: List[str]
    red_flags: List[str]


class ScoreResult(BaseModel):
    score: float = PydField(ge=0, le=100)
    strengths: List[str]
    gaps: List[str]
    recommendation: str = PydField(description="One of: reach_out, maybe, pass")
    one_line_reason: str


class OutreachRequest(BaseModel):
    job_id: int
    candidate_id: int
    sender_name: str = "Recruiting Team"
    sender_company: str = "Your Company"
    tone: str = "friendly and concise"


class OutreachResponse(BaseModel):
    subject: str
    body: str


# LangGraph endpoints
class GraphRunRequest(BaseModel):
    job_id: int
    candidate_id: int
    require_approval: bool = True
    sender_name: str = "Recruiting Team"
    sender_company: str = "Your Company"
    tone: str = "friendly and concise"


class GraphRunResponse(BaseModel):
    run_id: int
    thread_id: str
    status: str
    updates: List[dict] = []
    interrupt: Optional[Any] = None  # payload returned by interrupt() if waiting


class GraphResumeRequest(BaseModel):
    run_id: int
    approved: bool


class SendOutreachRequest(BaseModel):
    candidate_id: int


class SendOutreachResponse(BaseModel):
    candidate_id: int
    sent: bool
    outreach_status: str
    detail: Optional[str] = None

class BatchTopKRequest(BaseModel):
    job_id: int
    candidate_ids: Optional[List[int]] = None  # if None: use all Ready candidates
    top_k: int = PydField(default=5, ge=1, le=50)

    sender_name: str = "Recruiting Team"
    sender_company: str = "Your Company"
    tone: str = "friendly and concise"

    # Controls concurrency for LLM calls
    max_concurrency: int = PydField(default=3, ge=1, le=10)


class BatchTopKItem(BaseModel):
    candidate_id: int
    score: float
    recommendation: str
    one_line_reason: str
    outreach: Optional[dict] = None  # {subject, body} only for top_k


class BatchTopKResponse(BaseModel):
    job_id: int
    processed: int
    top_k: int
    ranked: List[BatchTopKItem]