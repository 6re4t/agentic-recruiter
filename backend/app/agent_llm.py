import json
from fastapi import HTTPException
from openai import OpenAI

from .settings import settings
from .schemas import CandidateExtract, JobAnalysis, ScoreResult, OutreachResponse, JDQualityReport

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
        timeout=60.0,
    )


def _llm_parse(client: OpenAI, model_cls, messages: list, label: str, retries: int = 3):
    """Call responses.parse with retry. Raises RuntimeError with raw output on final failure."""
    import time
    last_error = None
    for attempt in range(retries):
        if attempt > 0:
            time.sleep(1.5 * attempt)
        try:
            resp = client.responses.parse(
                model=settings.OPENROUTER_MODEL,
                input=messages,
                text_format=model_cls,
            )
        except Exception as exc:
            last_error = exc
            continue
        if resp.output_parsed is not None:
            return resp.output_parsed
        raw_parts = []
        for attr in ("output_text", "output", "error"):
            val = getattr(resp, attr, None)
            if val:
                raw_parts.append(f"{attr}={str(val)[:300]}")
        last_error = RuntimeError(f"output_parsed=None, {'; '.join(raw_parts) or 'no output'}")
    raise RuntimeError(
        f"{label}: model returned an unparseable response after {retries} attempts. "
        f"Last error: {last_error}"
    )


def extract_candidate(resume_text: str) -> CandidateExtract:
    client = _client()
    system = (
        "You are an expert recruiter. Extract a structured candidate profile from the resume text. "
        "Only use evidence from the text. If unknown, use null/empty and seniority='unknown'. "
        "Normalize skills (e.g., 'FastAPI' not 'fast api')."
    )
    return _llm_parse(client, CandidateExtract, [
        {"role": "system", "content": system},
        {"role": "user", "content": resume_text},
    ], "extract_candidate")


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
    return _llm_parse(client, JobAnalysis, [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ], "analyze_job")


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
    result = _llm_parse(client, ScoreResult, [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ], "score_candidate")
    return _normalize_category_names(result, categories)


def draft_outreach(job_title: str, candidate_extracted: dict, sender: dict, tone: str, rejection: bool = False) -> OutreachResponse:
    client = _client()
    if rejection:
        system = (
            "You are a recruiting coordinator writing a polite, professional rejection email.\n"
            "Rules:\n"
            "1. Thank the candidate genuinely for their time and interest.\n"
            "2. Decline clearly but kindly — do not be vague.\n"
            "3. Keep the body under 100 words.\n"
            "4. Do NOT mention scores, rankings, or specific weaknesses.\n"
            "5. Encourage them to apply for future roles if appropriate.\n"
            "6. Use natural paragraph breaks — separate the greeting, body, and sign-off with blank lines.\n"
            "7. subject: one-line email subject. body: full email text with newlines between paragraphs."
        )
    else:
        system = (
            "You are a recruiting coordinator writing a personalised outreach email.\n"
            "Rules:\n"
            "1. Mention only skills/experience explicitly present in candidate_extracted.\n"
            "2. Keep the body under 140 words.\n"
            "3. End with a clear CTA inviting a 15-minute chat.\n"
            "4. Tone must match the requested tone.\n"
            "5. Use natural paragraph breaks — separate greeting, body, and sign-off with blank lines.\n"
            "6. subject: one-line email subject. body: full email text with newlines between paragraphs."
        )
    slim = {k: candidate_extracted.get(k) for k in (
        "name", "headline", "seniority", "years_experience", "skills", "highlights"
    ) if candidate_extracted.get(k)}
    payload = {
        "job_title": job_title,
        "candidate": slim,
        "sender": sender,
        "tone": tone,
    }
    return _llm_parse(client, OutreachResponse, [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ], "draft_outreach")


def check_jd_quality(title: str, description: str, rubric: str) -> JDQualityReport:
    client = _client()
    system = (
        "You are an expert technical recruiter and DEI consultant reviewing a job description "
        "for quality issues before it is posted publicly.\n\n"
        "Analyse the job title, description, and scoring rubric for the following problem types:\n"
        "- vague_requirement: requirements that are too vague to evaluate objectively "
        '(e.g. "good communicator", "team player", "strong background in X" without specifics)\n'
        "- skill_stacking: demanding an unrealistic combination of distinct, senior-level skills "
        '(e.g. "5+ years React AND 5+ years Kubernetes AND 5+ years ML")\n'
        "- unrealistic_seniority: the years of experience demanded is inconsistent with the seniority "
        "level stated (e.g. junior role requiring 7+ years)\n"
        "- biased_language: words or phrases that research shows attract or discourage specific "
        'demographic groups (e.g. "rockstar", "ninja", "aggressive", "young and dynamic")\n'
        "- missing_information: a well-written JD should include salary range, location/remote policy, "
        "required vs nice-to-have split, and clear responsibilities — flag meaningful omissions\n"
        "- contradictory: requirements that conflict with each other or with the role description\n"
        "- scope_creep: the role appears to be two or more distinct jobs combined into one\n"
        "- other: any other significant quality issue\n\n"
        "Only raise real issues grounded in the text. Do not invent problems. "
        "If the JD is well-written, return an empty issues list with a high overall_score."
    )
    payload = {"title": title, "description": description, "rubric": rubric}
    return _llm_parse(client, JDQualityReport, [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ], "check_jd_quality")
