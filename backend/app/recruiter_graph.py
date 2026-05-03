import json
import re
import datetime
from typing import Any, Dict, List
from typing_extensions import TypedDict, NotRequired

from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command

from sqlmodel import Session, select

from .db import engine
from .models import Application, Candidate, Job, AuditLog
from .agent_llm import extract_candidate, analyze_job, score_candidate, draft_outreach
from .settings import settings
from .smtp_mailer import send_email, EmailSendError


# ---------------------------------------------------------------------------
# PII redaction helper — strips lines that look like contact info
# (name headers, email addresses, phone numbers, URLs, location lines)
# ---------------------------------------------------------------------------
_PII_PATTERNS = re.compile(
    r"([\w.+-]+@[\w-]+\.[a-z]{2,})"          # email
    r"|((\+?\d[\d\s\-().]{6,}\d))"            # phone
    r"|(https?://\S+)"                         # URL
    r"|(\blinkedin\.com\S*)"                   # LinkedIn
    r"|(\bgithub\.com\S*)"                     # GitHub
, re.IGNORECASE)

_LOCATION_LINE = re.compile(
    r"^\s*[A-Za-z\s]+,\s+[A-Za-z]{2,}(\s+\d{5})?\s*$"  # "City, State" or "City, Country"
)


def _redact_pii_lines(text: str) -> str:
    """
    Remove lines and sub-strings likely to contain identity signals
    (contact info, location, profile URLs) from a resume excerpt.
    """
    lines = []
    for line in text.splitlines():
        # Drop the whole line if it's a short contact/location line
        stripped = line.strip()
        if not stripped:
            lines.append("")
            continue
        # Drop very short lines that are pure contact info
        if len(stripped) < 80 and _PII_PATTERNS.search(stripped):
            continue
        if _LOCATION_LINE.match(stripped):
            continue
        # Inline redaction for any remaining PII tokens mid-line
        clean = _PII_PATTERNS.sub("[REDACTED]", line)
        lines.append(clean)
    return "\n".join(lines)


class RecruiterState(TypedDict):
    candidate_id: int
    job_id: int
    application_id: int

    require_approval: bool
    blind_scoring: bool
    rejection_threshold: int
    sender_name: str
    sender_company: str
    tone: str

    # Agent outputs — populated progressively as the graph runs
    extracted: NotRequired[dict]      # extraction_agent output
    job_analysis: NotRequired[dict]   # job_analysis_agent output
    score: NotRequired[dict]          # scoring_agent output
    outreach: NotRequired[dict]       # outreach_agent output

    approved: NotRequired[bool]
    error: NotRequired[str]
    updates: NotRequired[List[dict]]


def _audit(session: Session, action: str, entity_type: str, entity_id: int | None, detail: str | None):
    session.add(AuditLog(action=action, entity_type=entity_type, entity_id=entity_id, detail=detail))


def _push(state: RecruiterState, step: str, data: Any = None) -> Dict[str, Any]:
    upd = {"ts": datetime.datetime.utcnow().isoformat(), "step": step, "data": data}
    updates = list(state.get("updates", []))
    updates.append(upd)
    return {"updates": updates}


# ---------------------------------------------------------------------------
# Loader (no LLM — just validates and loads DB entities into state)
# ---------------------------------------------------------------------------

def load_from_db(state: RecruiterState) -> Dict[str, Any]:
    with Session(engine) as session:
        app = session.get(Application, state["application_id"])
        cand = session.get(Candidate, state["candidate_id"])
        job = session.get(Job, state["job_id"])
        if not app or not cand or not job:
            return {"error": "Application, Candidate, or Job not found", **_push(state, "load:error")}

        if not cand.resume_text:
            return {"error": "Candidate resume_text not ready", **_push(state, "load:not_ready")}

        _audit(session, "graph_loaded", "application", app.id, f"candidate={cand.id} job={job.id}")
        session.commit()

    return _push(state, "load:ok", {"application_id": state["application_id"]})


# ---------------------------------------------------------------------------
# Agent 1 — Extraction Agent
# Parses the raw resume text into a structured candidate profile.
# Result is cached on Candidate.extracted_json to avoid re-extraction.
# ---------------------------------------------------------------------------

def extraction_agent(state: RecruiterState) -> Dict[str, Any]:
    with Session(engine) as session:
        cand = session.get(Candidate, state["candidate_id"])
        if not cand or not cand.resume_text:
            return {"error": "Missing candidate/resume_text", **_push(state, "extraction_agent:error")}

        # Use cached extraction if available
        if cand.extracted_json:
            try:
                extracted = json.loads(cand.extracted_json)
                return {"extracted": extracted, **_push(state, "extraction_agent:cached")}
            except Exception:
                pass

        parsed = extract_candidate(cand.resume_text[:8000])
        extracted = parsed.model_dump()

        cand.extracted_json = json.dumps(extracted, ensure_ascii=False)
        if not cand.name and extracted.get("name"):
            cand.name = extracted["name"]
        if not cand.email and extracted.get("email"):
            cand.email = extracted["email"]
        session.add(cand)
        _audit(session, "candidate_extracted", "candidate", cand.id, extracted.get("headline"))
        session.commit()

    return {"extracted": extracted, **_push(state, "extraction_agent:ok")}


# ---------------------------------------------------------------------------
# Agent 2 — Job Analysis Agent
# Deeply parses the job description into required skills, responsibilities,
# company signals, and deal-breakers.
# Result is cached on Job.analyzed_json so it runs once per unique job.
# ---------------------------------------------------------------------------

def job_analysis_agent(state: RecruiterState) -> Dict[str, Any]:
    with Session(engine) as session:
        job = session.get(Job, state["job_id"])
        if not job:
            return {"error": "Job not found", **_push(state, "job_analysis_agent:error")}

        # Use cached analysis if available and it includes scoring_categories
        if job.analyzed_json:
            try:
                analysis = json.loads(job.analyzed_json)
                if analysis.get("scoring_categories"):
                    return {"job_analysis": analysis, **_push(state, "job_analysis_agent:cached")}
            except Exception:
                pass

        analysis_obj = analyze_job(job.title, job.description, job.rubric)
        analysis = analysis_obj.model_dump()

        job.analyzed_json = json.dumps(analysis, ensure_ascii=False)
        session.add(job)
        _audit(session, "job_analyzed", "job", job.id, job.title)
        session.commit()

    return {"job_analysis": analysis, **_push(state, "job_analysis_agent:ok")}


# ---------------------------------------------------------------------------
# Agent 3 — Scoring Agent
# Scores the candidate against the job using both the raw job definition
# and the enriched job_analysis produced by the job analysis agent.
# Writes score + score_reason to the Application row.
# ---------------------------------------------------------------------------

def scoring_agent(state: RecruiterState) -> Dict[str, Any]:
    with Session(engine) as session:
        app = session.get(Application, state["application_id"])
        cand = session.get(Candidate, state["candidate_id"])
        job = session.get(Job, state["job_id"])
        if not app or not cand or not job:
            return {"error": "Application, Candidate, or Job missing", **_push(state, "scoring_agent:error")}

        blind = state.get("blind_scoring", False)

        job_obj = {"title": job.title, "description": job.description, "rubric": job.rubric}

        extracted = state.get("extracted") or {}
        if blind:
            # Strip all PII — only pass skills, roles, highlights, years_experience, seniority
            extracted_for_scoring = {
                "headline": extracted.get("headline", ""),
                "seniority": extracted.get("seniority", ""),
                "years_experience": extracted.get("years_experience"),
                "roles": extracted.get("roles", []),
                "skills": extracted.get("skills", []),
                "highlights": extracted.get("highlights", []),
                "red_flags": extracted.get("red_flags", []),
                # PII fields intentionally omitted: name, email, location
            }
            # Also redact the resume excerpt — strip lines that look like names / contact info
            resume_excerpt = _redact_pii_lines((cand.resume_text or "")[:2000])
            cand_obj = {
                "extracted": extracted_for_scoring,
                "resume_text_excerpt": resume_excerpt,
            }
        else:
            cand_obj = {
                "name": cand.name,
                "email": cand.email,
                "extracted": extracted,
                "resume_text_excerpt": (cand.resume_text or "")[:2000],
            }

        scored = score_candidate(
            job_obj,
            cand_obj,
            job_analysis=state.get("job_analysis"),
        ).model_dump()

        app.score = float(scored["score"])
        app.score_reason = scored["one_line_reason"]
        app.score_json = json.dumps(scored, ensure_ascii=False)
        app.stage = "Scored"
        app.updated_at = datetime.datetime.utcnow()
        session.add(app)
        _audit(session, "application_scored", "application", app.id,
               f"job={job.id} score={app.score} blind={blind}")
        session.commit()

    return {"score": scored, **_push(state, "scoring_agent:ok", scored)}


# ---------------------------------------------------------------------------
# Agent 4 — Outreach Agent
# Drafts a personalised recruiting email based on the candidate profile,
# job title, sender info, and desired tone. Optionally waits for human
# approval, then persists the final status.
# ---------------------------------------------------------------------------

def outreach_agent(state: RecruiterState) -> Dict[str, Any]:
    with Session(engine) as session:
        app = session.get(Application, state["application_id"])
        cand = session.get(Candidate, state["candidate_id"])
        job = session.get(Job, state["job_id"])
        if not app or not cand or not job:
            return {"error": "Application, Candidate, or Job missing", **_push(state, "outreach_agent:error")}

        extracted = state.get("extracted") or {}
        sender = {"name": state["sender_name"], "company": state["sender_company"]}
        score = app.score or 0
        threshold = state.get("rejection_threshold", 50)
        is_rejection = score < threshold

        out = draft_outreach(job.title, extracted, sender, state["tone"], rejection=is_rejection).model_dump()

        app.outreach_json = json.dumps(out, ensure_ascii=False)
        app.outreach_status = "draft"
        app.stage = "Outreach_Draft"
        app.updated_at = datetime.datetime.utcnow()
        session.add(app)
        _audit(session, "outreach_drafted", "application", app.id,
               f"{'rejection' if is_rejection else 'outreach'} score={score} threshold={threshold} subject={out.get('subject')}")
        session.commit()

    return {"outreach": out, **_push(state, "outreach_agent:ok", out)}


def node_approval(state: RecruiterState) -> Dict[str, Any]:
    payload = {
        "application_id": state["application_id"],
        "candidate_id": state["candidate_id"],
        "job_id": state["job_id"],
        "outreach": state.get("outreach"),
        "prompt": "Approve this outreach draft?",
    }
    approved = interrupt(payload)
    return {"approved": bool(approved), **_push(state, "approval:resumed", {"approved": bool(approved)})}


def persist_agent(state: RecruiterState) -> Dict[str, Any]:
    approved = state.get("approved")
    final_status = "unknown"

    with Session(engine) as session:
        app = session.get(Application, state["application_id"])
        cand = session.get(Candidate, state["candidate_id"])
        if not app or not cand:
            return {"error": "Application or Candidate missing", **_push(state, "persist_agent:error")}

        if state["require_approval"]:
            if approved is True:
                app.outreach_status = "approved"
                _audit(session, "outreach_approved", "application", app.id, "approved")
            elif approved is False:
                app.outreach_status = "rejected"
                app.stage = "Rejected"
                _audit(session, "outreach_rejected", "application", app.id, "rejected")
            else:
                _audit(session, "outreach_unknown", "application", app.id, "missing approval value")
        else:
            app.outreach_status = "approved"
            _audit(session, "outreach_auto_approved", "application", app.id, "require_approval=false")

        should_send = bool(
            settings.SMTP_AUTO_SEND_APPROVED and
            app.outreach_status == "approved" and
            cand.email and
            app.outreach_json
        )

        if should_send:
            try:
                outreach = json.loads(app.outreach_json)
                subject = outreach.get("subject")
                body = outreach.get("body")

                if subject and body:
                    send_email(cand.email, subject, body)
                    app.outreach_status = "sent"
                    app.stage = "Contacted"
                    _audit(session, "outreach_sent", "application", app.id, cand.email)
                else:
                    app.outreach_status = "send_failed"
                    _audit(session, "outreach_send_failed", "application", app.id, "missing subject/body")
            except (json.JSONDecodeError, EmailSendError) as exc:
                app.outreach_status = "send_failed"
                _audit(session, "outreach_send_failed", "application", app.id, str(exc))

        app.updated_at = datetime.datetime.utcnow()
        session.add(app)
        session.commit()
        final_status = app.outreach_status or "unknown"

    return _push(state, "persist_agent:ok", {"outreach_status": final_status})


def _route_after_outreach(state: RecruiterState) -> str:
    if state.get("error"):
        return "persist"
    return "approve" if state["require_approval"] else "persist"


def build_recruiter_graph():
    g = StateGraph(RecruiterState)

    # Data loader (no LLM)
    g.add_node("load", load_from_db)

    # Agent 1 — extract structured candidate profile from resume
    g.add_node("extraction_agent", extraction_agent)

    # Agent 2 — deeply analyze the job description
    g.add_node("job_analysis_agent", job_analysis_agent)

    # Agent 3 — score candidate against job using both profiles
    g.add_node("scoring_agent", scoring_agent)

    # Agent 4 — draft personalised outreach email
    g.add_node("outreach_agent", outreach_agent)

    # Human-in-the-loop approval step (not an LLM agent)
    g.add_node("approve", node_approval)

    # Final persistence (writes approval/send outcome)
    g.add_node("persist", persist_agent)

    g.add_edge(START, "load")
    g.add_edge("load", "extraction_agent")
    g.add_edge("extraction_agent", "job_analysis_agent")
    g.add_edge("job_analysis_agent", "scoring_agent")
    g.add_edge("scoring_agent", "outreach_agent")

    g.add_conditional_edges(
        "outreach_agent",
        _route_after_outreach,
        {"approve": "approve", "persist": "persist"},
    )
    g.add_edge("approve", "persist")
    g.add_edge("persist", END)

    return g


    approved: NotRequired[bool]
    error: NotRequired[str]
    updates: NotRequired[List[dict]]


def _audit(session: Session, action: str, entity_type: str, entity_id: int | None, detail: str | None):
    session.add(AuditLog(action=action, entity_type=entity_type, entity_id=entity_id, detail=detail))


def _push(state: RecruiterState, step: str, data: Any = None) -> Dict[str, Any]:
    upd = {"ts": datetime.datetime.utcnow().isoformat(), "step": step, "data": data}
    updates = list(state.get("updates", []))
    updates.append(upd)
    return {"updates": updates}


def load_from_db(state: RecruiterState) -> Dict[str, Any]:
    with Session(engine) as session:
        app = session.get(Application, state["application_id"])
        cand = session.get(Candidate, state["candidate_id"])
        job = session.get(Job, state["job_id"])
        if not app or not cand or not job:
            return {"error": "Application, Candidate, or Job not found", **_push(state, "load:error")}

        if not cand.resume_text:
            return {"error": "Candidate resume_text not ready", **_push(state, "load:not_ready")}

        _audit(session, "graph_loaded", "application", app.id, f"candidate={cand.id} job={job.id}")
        session.commit()

    return _push(state, "load:ok", {"application_id": state["application_id"]})
