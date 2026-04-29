from typing import Optional, List, Any
from pydantic import BaseModel, EmailStr, Field as PydField


class JobCreate(BaseModel):
    title: str
    description: str
    rubric: str
    blind_scoring: bool = False


class JobUpdate(BaseModel):
    blind_scoring: Optional[bool] = None


class CandidateCreate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    resume_text: str


class ApplicationCreate(BaseModel):
    candidate_id: int
    job_id: int


class ApplicationRead(BaseModel):
    id: int
    candidate_id: int
    job_id: int
    stage: str
    score: Optional[float] = None
    score_reason: Optional[str] = None
    outreach_json: Optional[str] = None
    outreach_status: Optional[str] = None
    created_at: Any
    updated_at: Any


class CandidateExtract(BaseModel):
    name: Optional[str] = PydField(default=None, description="Full name of the candidate as stated in the resume, else null")
    headline: str
    seniority: str = PydField(description="One of: intern, junior, mid, senior, lead, unknown")
    years_experience: Optional[int] = None
    roles: List[str]
    skills: List[str]
    location: Optional[str] = None
    email: Optional[str] = PydField(default=None, description="Candidate email address if present in the resume, else null")
    highlights: List[str]
    red_flags: List[str]


class JobAnalysis(BaseModel):
    required_skills: List[str] = PydField(description="Non-negotiable technical/domain skills stated or strongly implied by the job")
    preferred_skills: List[str] = PydField(description="Nice-to-have skills mentioned but not strictly required")
    seniority_level: str = PydField(description="Expected seniority: intern, junior, mid, senior, lead, or unknown")
    key_responsibilities: List[str] = PydField(description="Core duties the role requires, extracted verbatim where possible")
    company_signals: List[str] = PydField(description="Culture, environment, or value signals from the job description")
    deal_breakers: List[str] = PydField(description="Hard requirements or disqualifying criteria stated in the description")
    scoring_categories: List[str] = PydField(
        description=(
            "Exactly 4 scoring dimension NAMES specific to this role, used to evaluate every candidate consistently. "
            "Each entry MUST be a short noun phrase (2-4 words) describing a skill or competency area — "
            "for example: 'Culinary Skills', 'Kitchen Management', 'Food Safety Knowledge', 'Team Leadership'. "
            "NEVER use score ranges, numbers, percentages, or calibration labels like '80-100' or 'strong fit'. "
            "These are category NAMES only, not scores or thresholds. "
            "Derive them from the job's actual requirements. "
            "These same 4 names will be used identically for every candidate scored against this job."
        )
    )


class CategoryScore(BaseModel):
    category: str = PydField(
        description=(
            "The scoring dimension name. MUST be a short noun phrase from the scoring_categories list "
            "(e.g. 'Backend Engineering', 'System Design'). "
            "NEVER use a number, range, percentage, or score as the category name."
        )
    )
    score: float = PydField(ge=0, le=100, description="Score 0-100: 0-30=missing/far below bar, 31-55=partial match, 56-75=solid match, 76-90=strong, 91-100=exceptional")
    rationale: str = PydField(description="One sentence grounded strictly in resume evidence. Quote specific skills, titles, or years. Do NOT infer what is not written.")


class EvidenceSnippet(BaseModel):
    quote: str = PydField(description="Exact short phrase or sentence from the resume that supports the score (max 120 chars)")
    relevance: str = PydField(description="Brief note on why this quote is relevant to the job requirements")


class ScoreResult(BaseModel):
    score: float = PydField(ge=0, le=100, description="Overall score 0-100, computed as the average of category_scores weighted by importance")
    category_scores: List[CategoryScore] = PydField(
        description="One entry per category from the provided scoring_categories list. Must cover ALL provided categories, no more, no less."
    )
    strengths: List[str]
    gaps: List[str]
    evidence_snippets: List[EvidenceSnippet] = PydField(
        description="2-4 direct quotes from the resume that most strongly influenced the score"
    )
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
    application_id: int
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
    application_id: int


class SendOutreachResponse(BaseModel):
    application_id: int
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

    # Skip candidates that already have a score for this job
    skip_scored: bool = False

    # Controls concurrency for LLM calls
    max_concurrency: int = PydField(default=3, ge=1, le=10)


class BatchTopKItem(BaseModel):
    application_id: int
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


# ─── Recruiter notes ─────────────────────────────────────────────────────────

class NotesUpdate(BaseModel):
    notes: Optional[str] = None


# ─── Semantic search ──────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    q: str = PydField(min_length=1, max_length=500)
    types: List[str] = PydField(
        default=["resumes", "jobs", "notes"],
        description="Which entity types to search: resumes, jobs, notes"
    )
    limit: int = PydField(default=10, ge=1, le=50)


class SearchHit(BaseModel):
    type: str            # "resume" | "job" | "note"
    id: int              # candidate_id, job_id, or application_id
    label: str           # display name
    snippet: str         # short excerpt
    score: float         # cosine similarity 0-1
    meta: dict = {}      # extra context (e.g. job title for a resume hit)


# ─── JD quality checker ───────────────────────────────────────────────────────

class JDIssue(BaseModel):
    severity: str = PydField(
        description="One of: critical, warning, suggestion"
    )
    category: str = PydField(
        description=(
            "Short category label. One of: vague_requirement, skill_stacking, "
            "unrealistic_seniority, biased_language, missing_information, "
            "contradictory, scope_creep, other"
        )
    )
    quote: Optional[str] = PydField(
        default=None,
        description="The exact short phrase from the JD that triggered this issue (max 120 chars), or null if it is an omission issue"
    )
    explanation: str = PydField(
        description="One sentence explaining why this is an issue"
    )
    suggestion: str = PydField(
        description="One concrete actionable fix the recruiter can make"
    )


class JDQualityReport(BaseModel):
    overall_score: int = PydField(
        ge=0, le=100,
        description="Overall JD quality score 0-100: 0-40 needs major rework, 41-69 needs improvement, 70-84 good, 85-100 excellent"
    )
    summary: str = PydField(
        description="Two-sentence plain-English summary of the JD's strengths and biggest weaknesses"
    )
    issues: List[JDIssue] = PydField(
        description="List of specific issues found. Empty list if none. Order by severity (critical first, then warning, then suggestion)."
    )