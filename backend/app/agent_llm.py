import json
from fastapi import HTTPException
from openai import OpenAI

from .settings import settings
from .schemas import CandidateExtract, ScoreResult, OutreachResponse


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


def score_candidate(job: dict, candidate: dict) -> ScoreResult:
    client = _client()
    system = (
        "You are scoring a candidate against a job. Use ONLY the provided rubric and candidate evidence. "
        "Return a fair 0-100 score and clear reasons. Do not infer protected attributes."
    )
    payload = {"job": job, "candidate": candidate}
    resp = client.responses.parse(
        model=settings.OPENROUTER_MODEL,
        input=[
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        text_format=ScoreResult,
    )
    return resp.output_parsed


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
