"""
Conversational recruiter assistant.

Implements a tool-calling agentic loop using the OpenAI chat completions API.
The LLM can call four tools to query the recruiter database:
  - list_jobs              — list all jobs
  - search_candidates      — semantic search over resumes
  - get_top_candidates     — ranked candidate list for a job
  - explain_score          — full scoring breakdown for an application
"""
from __future__ import annotations

import json
from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from openai import OpenAI
from pydantic import BaseModel
from sqlmodel import Session, select

from ..agent_llm import embed_text, embed_texts
from ..db import get_session
from ..models import Application, Candidate, Job
from ..settings import settings

router = APIRouter(prefix="/chat", tags=["chat"])

MAX_TOOL_ROUNDS = 6  # prevent infinite loops

# ─── Request / response schemas ─────────────────────────────────────────────


class ChatMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


class ChatResponse(BaseModel):
    reply: str
    tools_used: list[str]


# ─── Tool definitions ────────────────────────────────────────────────────────

_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "list_jobs",
            "description": "List all jobs in the system with their IDs, titles, and applicant counts.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_candidates",
            "description": (
                "Semantically search candidate resumes for a given query. "
                "Useful for finding candidates with specific skills or background."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural language query to match against resume content",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results to return (default 5, max 15)",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_top_candidates",
            "description": (
                "Get the highest-scoring candidates for a specific job, ranked by AI score descending. "
                "Returns candidate names, scores, stages, and outreach status."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "job_id": {
                        "type": "integer",
                        "description": "The ID of the job to retrieve top candidates for",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Number of top candidates to return (default 5)",
                    },
                },
                "required": ["job_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explain_score",
            "description": (
                "Get the full AI scoring breakdown for a specific application: "
                "category scores with rationale, strengths, gaps, and evidence snippets from the resume."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "application_id": {
                        "type": "integer",
                        "description": "The application ID to explain",
                    },
                },
                "required": ["application_id"],
            },
        },
    },
]

# ─── Tool implementations ────────────────────────────────────────────────────


def _cosine(a: list, b: list) -> float:
    va, vb = np.array(a, dtype=float), np.array(b, dtype=float)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    return float(np.dot(va, vb) / denom) if denom > 0 else 0.0


def _tool_list_jobs(session: Session, _args: dict) -> Any:
    jobs = session.exec(select(Job).order_by(Job.created_at.desc())).all()
    if not jobs:
        return "No jobs found."
    rows = []
    for j in jobs:
        apps = session.exec(select(Application).where(Application.job_id == j.id)).all()
        rows.append({
            "job_id": j.id,
            "title": j.title,
            "applicants": len(apps),
            "scored": sum(1 for a in apps if a.score is not None),
        })
    return rows


def _tool_search_candidates(session: Session, args: dict) -> Any:
    query = (args.get("query") or "").strip()
    limit = min(int(args.get("limit") or 5), 15)
    if not query:
        return "No query provided."

    candidates = session.exec(
        select(Candidate).where(Candidate.resume_text.is_not(None))  # type: ignore[attr-defined]
    ).all()
    if not candidates:
        return "No candidates with resumes found."

    # Batch-embed missing candidates
    need_embed = [c for c in candidates if not c.embedding]
    if need_embed:
        vecs = embed_texts([c.resume_text[:6000] for c in need_embed])
        for c, vec in zip(need_embed, vecs):
            c.embedding = json.dumps(vec)
            session.add(c)
        session.commit()
        for c in need_embed:
            session.refresh(c)

    query_vec = embed_text(query[:1000])

    scored = []
    for c in candidates:
        if not c.embedding:
            continue
        sim = _cosine(query_vec, json.loads(c.embedding))
        scored.append((sim, c))

    scored.sort(key=lambda x: x[0], reverse=True)
    results = []
    for sim, c in scored[:limit]:
        extracted = {}
        if c.extracted_json:
            try:
                extracted = json.loads(c.extracted_json)
            except Exception:
                pass
        results.append({
            "candidate_id": c.id,
            "name": c.name or "(no name)",
            "email": c.email,
            "similarity": round(sim, 3),
            "stage": c.stage,
            "headline": extracted.get("headline"),
            "skills": extracted.get("skills", [])[:8],
            "seniority": extracted.get("seniority"),
        })
    return results if results else "No matching candidates found."


def _tool_get_top_candidates(session: Session, args: dict) -> Any:
    job_id = int(args.get("job_id") or 0)
    limit = min(int(args.get("limit") or 5), 20)

    job = session.get(Job, job_id)
    if not job:
        return f"Job #{job_id} not found."

    apps = session.exec(
        select(Application).where(Application.job_id == job_id)
    ).all()
    if not apps:
        return f"No applications found for job #{job_id} ({job.title})."

    # Sort: scored first (desc), then unscored
    scored_apps = sorted([a for a in apps if a.score is not None], key=lambda a: a.score, reverse=True)
    unscored_apps = [a for a in apps if a.score is None]
    ranked = (scored_apps + unscored_apps)[:limit]

    results = []
    for app in ranked:
        cand = session.get(Candidate, app.candidate_id)
        score_data = {}
        if app.score_json:
            try:
                score_data = json.loads(app.score_json)
            except Exception:
                pass
        results.append({
            "application_id": app.id,
            "candidate_id": app.candidate_id,
            "name": cand.name if cand else f"Candidate #{app.candidate_id}",
            "email": cand.email if cand else None,
            "score": app.score,
            "recommendation": score_data.get("recommendation"),
            "one_line_reason": app.score_reason,
            "stage": app.stage,
            "outreach_status": app.outreach_status,
        })
    return {"job": {"id": job.id, "title": job.title}, "candidates": results}


def _tool_explain_score(session: Session, args: dict) -> Any:
    app_id = int(args.get("application_id") or 0)
    app = session.get(Application, app_id)
    if not app:
        return f"Application #{app_id} not found."

    cand = session.get(Candidate, app.candidate_id)
    job = session.get(Job, app.job_id)

    if not app.score_json:
        return (
            f"Application #{app_id} has not been scored yet. "
            f"Run the AI pipeline for {cand.name if cand else 'this candidate'} "
            f"on job '{job.title if job else 'this job'}' first."
        )

    try:
        score_data = json.loads(app.score_json)
    except Exception:
        return "Score data is corrupted."

    return {
        "application_id": app.id,
        "candidate": cand.name if cand else f"#{app.candidate_id}",
        "job": job.title if job else f"#{app.job_id}",
        "overall_score": score_data.get("score"),
        "recommendation": score_data.get("recommendation"),
        "one_line_reason": score_data.get("one_line_reason"),
        "category_scores": score_data.get("category_scores", []),
        "strengths": score_data.get("strengths", []),
        "gaps": score_data.get("gaps", []),
        "evidence_snippets": score_data.get("evidence_snippets", []),
    }


_TOOL_MAP = {
    "list_jobs": _tool_list_jobs,
    "search_candidates": _tool_search_candidates,
    "get_top_candidates": _tool_get_top_candidates,
    "explain_score": _tool_explain_score,
}

# ─── Main endpoint ────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = (
    "You are a helpful recruiting assistant with access to a recruiter's database. "
    "You can search candidate resumes, look up job listings, find top candidates for a role, "
    "and explain AI scoring breakdowns in plain language. "
    "Be concise and factual. When citing candidates or scores, reference names and numbers. "
    "If asked for top candidates or a comparison, always call the appropriate tool to get fresh data. "
    "Format lists and tables using markdown."
)


@router.post("", response_model=ChatResponse)
def chat(payload: ChatRequest, session: Session = Depends(get_session)):
    if not settings.OPENROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured.")
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty.")

    client = OpenAI(
        api_key=settings.OPENROUTER_API_KEY,
        base_url=settings.OPENROUTER_BASE_URL,
    )

    # Build message list for the LLM (system + conversation history)
    llm_messages: list[dict] = [{"role": "system", "content": _SYSTEM_PROMPT}]
    for m in payload.messages:
        if m.role in ("user", "assistant"):
            llm_messages.append({"role": m.role, "content": m.content})

    tools_used: list[str] = []

    # Agentic tool-calling loop
    for _ in range(MAX_TOOL_ROUNDS):
        response = client.chat.completions.create(
            model=settings.OPENROUTER_MODEL,
            messages=llm_messages,
            tools=_TOOLS,
            tool_choice="auto",
        )
        msg = response.choices[0].message

        # No tool calls → final answer
        if not msg.tool_calls:
            return ChatResponse(
                reply=msg.content or "",
                tools_used=tools_used,
            )

        # Execute each tool call
        llm_messages.append(msg.model_dump(exclude_none=True))

        for tc in msg.tool_calls:
            fn_name = tc.function.name
            try:
                fn_args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                fn_args = {}

            fn = _TOOL_MAP.get(fn_name)
            if fn is None:
                tool_result = f"Unknown tool: {fn_name}"
            else:
                try:
                    tool_result = fn(session, fn_args)
                except Exception as exc:
                    tool_result = f"Tool error: {exc}"

            tools_used.append(fn_name)
            llm_messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": json.dumps(tool_result, ensure_ascii=False),
            })

    # Fallback if loop exhausted (shouldn't normally happen)
    raise HTTPException(status_code=500, detail="Chat agent exceeded maximum tool call rounds.")
