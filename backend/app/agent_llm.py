import json
from fastapi import HTTPException
from openai import OpenAI

from .settings import settings
from .schemas import CandidateExtract, JobAnalysis, ScoreResult, OutreachResponse

# ─── Embedding (OpenAI text-embedding-3-small via OpenRouter, cached to DB) ──
EMBED_MODEL = "openai/text-embedding-3-small"


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts. Returns a list of float vectors."""
    client = _client()
    response = client.embeddings.create(
        model=EMBED_MODEL,
        input=[t[:8000] for t in texts],
    )
    # API returns items in the same order as input
    return [item.embedding for item in sorted(response.data, key=lambda x: x.index)]


def embed_text(text: str) -> list[float]:
    return embed_texts([text])[0]


def _client() -> OpenAI:
    if not settings.OPENROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not set on server.")
    return OpenAI(
        api_key=settings.OPENROUTER_API_KEY,
        base_url=settings.OPENROUTER_BASE_URL,
    )


def extract_candidate(resume_text: str) -> CandidateExtract:
    client = _client()
    system = (
        "You are an expert recruiter. Extract a structured candidate profile from the resume text. "
        "Only use evidence from the text. If unknown, use null/empty and seniority='unknown'. "
        "Normalize skills (e.g., 'FastAPI' not 'fast api')."
    )
    resp = client.responses.parse(
        model=settings.OPENROUTER_MODEL,
        input=[
            {"role": "system", "content": system},
            {"role": "user", "content": resume_text},
        ],
        text_format=CandidateExtract,
    )
    return resp.output_parsed


def analyze_job(title: str, description: str, rubric: str) -> JobAnalysis:
    client = _client()
    system = (
        "You are an expert technical recruiter. Analyze the job posting and extract a structured summary "
        "that will be used to evaluate candidates. Be precise and grounded in the text provided. "
        "Do not invent requirements that are not stated or strongly implied.\n\n"
        "IMPORTANT: The scoring_categories field must contain exactly 4 short noun-phrase NAMES of skill/competency "
        "areas relevant to this role (e.g. 'Culinary Skills', 'Kitchen Management'). "
        "These are category names only — do NOT put score ranges, numbers, or calibration scales there."
    )
    payload = {"title": title, "description": description, "rubric": rubric}
    resp = client.responses.parse(
        model=settings.OPENROUTER_MODEL,
        input=[
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        text_format=JobAnalysis,
    )
    return resp.output_parsed


def _normalize_category_names(result: ScoreResult, categories: list) -> ScoreResult:
    """
    Map each returned CategoryScore.category back to the nearest string in `categories`.
    Prevents LLM paraphrasing from breaking consistency across candidates for the same job.
    Priority: 1) exact (case-insensitive), 2) substring, 3) positional fallback.
    """
    if not categories:
        return result

    cat_lower = {c.lower(): c for c in categories}
    normalized = []
    used: list = []

    for cs in result.category_scores:
        # 1. Exact match (case-insensitive)
        match = cat_lower.get(cs.category.lower())

        # 2. Substring match
        if not match:
            for orig_lower, orig in cat_lower.items():
                if orig_lower in cs.category.lower() or cs.category.lower() in orig_lower:
                    match = orig
                    break

        # 3. Positional fallback: take the next unused category in order
        if not match:
            remaining = [c for c in categories if c not in used]
            match = remaining[0] if remaining else cs.category

        used.append(match)
        normalized.append(cs.model_copy(update={"category": match}))

    return result.model_copy(update={"category_scores": normalized})


def score_candidate(job: dict, candidate: dict, job_analysis: dict | None = None) -> ScoreResult:
    client = _client()

    categories = (job_analysis or {}).get("scoring_categories") or [
        "Technical Skills", "Experience Level", "Domain Knowledge", "Culture Fit"
    ]
    categories_str = ", ".join(f'"{c}"' for c in categories)

    system = (
        "You are a calibrated technical recruiter scoring a candidate against a job.\n\n"
        "RULES:\n"
        "1. Score using ONLY evidence explicitly present in the candidate data. Do not assume or infer.\n"
        "2. You MUST produce exactly these category scores (no others): " + categories_str + "\n"
        "3. The 'category' field for each score MUST be the exact string from the list above — "
        "never a number, percentage, or range like '80-100'.\n"
        "4. Calibration scale per category — 0-30: skill/experience absent or far below bar; "
        "31-55: partial match, clear gaps; 56-75: solid match, meets most requirements; "
        "76-90: strong match, exceeds most requirements; 91-100: exceptional, rare match.\n"
        "5. The overall score must be the weighted mean of the category scores (weight by importance to this role).\n"
        "6. Do not infer protected attributes. Do not reward candidates for things not in their resume."
    )
    payload = {"job": job, "candidate": candidate}
    if job_analysis:
        payload["job_analysis"] = job_analysis
    resp = client.responses.parse(
        model=settings.OPENROUTER_MODEL,
        input=[
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        text_format=ScoreResult,
    )
    return _normalize_category_names(resp.output_parsed, categories)


def draft_outreach(job_title: str, candidate_extracted: dict, sender: dict, tone: str) -> OutreachResponse:
    client = _client()
    system = (
        "Write a recruiting outreach email. "
        "Rules: (1) Mention only evidence present in candidate_extracted. "
        "(2) Keep under 140 words. (3) Include a clear CTA for a 15-min chat. "
        "Return JSON with keys: subject, body."
    )
    payload = {
        "job_title": job_title,
        "candidate_extracted": candidate_extracted,
        "sender": sender,
        "tone": tone,
    }
    resp = client.responses.parse(
        model=settings.OPENROUTER_MODEL,
        input=[
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        text_format=OutreachResponse,
    )
    return resp.output_parsed
