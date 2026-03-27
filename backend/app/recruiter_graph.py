import json
import datetime
from typing import Any, Dict, List
from typing_extensions import TypedDict, NotRequired

from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command  # interrupt + resume Command :contentReference[oaicite:3]{index=3}

from sqlmodel import Session, select

from .db import engine
from .models import Candidate, Job, AuditLog
from .agent_llm import extract_candidate, score_candidate, draft_outreach
from .settings import settings
from .smtp_mailer import send_email, EmailSendError


class RecruiterState(TypedDict):
    candidate_id: int
    job_id: int

    require_approval: bool
    sender_name: str
    sender_company: str
    tone: str

    extracted: NotRequired[dict]
    score: NotRequired[dict]
    outreach: NotRequired[dict]

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
        cand = session.get(Candidate, state["candidate_id"])
        job = session.get(Job, state["job_id"])
        if not cand or not job:
            return {"error": "Candidate or Job not found", **_push(state, "load:error")}

        if not cand.resume_text:
            return {"error": "Candidate resume_text not ready", **_push(state, "load:not_ready")}

        _audit(session, "graph_loaded", "candidate", cand.id, f"job={job.id}")
        session.commit()

    return _push(state, "load:ok", {"candidate_id": state["candidate_id"], "job_id": state["job_id"]})


def node_extract(state: RecruiterState) -> Dict[str, Any]:
    with Session(engine) as session:
        cand = session.get(Candidate, state["candidate_id"])
        if not cand or not cand.resume_text:
            return {"error": "Missing candidate/resume_text", **_push(state, "extract:error")}

        # If already extracted, reuse
        if cand.extracted_json:
            try:
                extracted = json.loads(cand.extracted_json)
                return {"extracted": extracted, **_push(state, "extract:reuse")}
            except Exception:
                pass

        parsed = extract_candidate(cand.resume_text[:8000])
        extracted = parsed.model_dump()

        cand.extracted_json = json.dumps(extracted, ensure_ascii=False)
        session.add(cand)
        _audit(session, "candidate_extracted", "candidate", cand.id, extracted.get("headline"))
        session.commit()

    return {"extracted": extracted, **_push(state, "extract:ok")}


def node_score(state: RecruiterState) -> Dict[str, Any]:
    with Session(engine) as session:
        cand = session.get(Candidate, state["candidate_id"])
        job = session.get(Job, state["job_id"])
        if not cand or not job:
            return {"error": "Candidate or Job missing", **_push(state, "score:error")}

        extracted = state.get("extracted")
        job_obj = {"title": job.title, "description": job.description, "rubric": job.rubric}
        cand_obj = {
            "name": cand.name,
            "email": cand.email,
            "extracted": extracted,
            "resume_text_excerpt": (cand.resume_text or "")[:2000],
        }

        scored = score_candidate(job_obj, cand_obj).model_dump()

        cand.score = float(scored["score"])
        cand.score_reason = scored["one_line_reason"]
        session.add(cand)
        _audit(session, "candidate_scored", "candidate", cand.id, f"job={job.id} score={cand.score}")
        session.commit()

    return {"score": scored, **_push(state, "score:ok", scored)}


def node_outreach(state: RecruiterState) -> Dict[str, Any]:
    with Session(engine) as session:
        cand = session.get(Candidate, state["candidate_id"])
        job = session.get(Job, state["job_id"])
        if not cand or not job:
            return {"error": "Candidate or Job missing", **_push(state, "outreach:error")}

        extracted = state.get("extracted") or {}
        sender = {"name": state["sender_name"], "company": state["sender_company"]}

        out = draft_outreach(job.title, extracted, sender, state["tone"]).model_dump()

        # Save as draft immediately
        cand.outreach_json = json.dumps(out, ensure_ascii=False)
        cand.outreach_status = "draft"
        session.add(cand)
        _audit(session, "outreach_drafted", "candidate", cand.id, out.get("subject"))
        session.commit()

    return {"outreach": out, **_push(state, "outreach:ok", out)}


def node_approval(state: RecruiterState) -> Dict[str, Any]:
    # Pause here for human approval if required
    payload = {
        "candidate_id": state["candidate_id"],
        "job_id": state["job_id"],
        "outreach": state.get("outreach"),
        "prompt": "Approve this outreach draft?",
    }
    approved = interrupt(payload)  # returns when resumed via Command(resume=...) :contentReference[oaicite:4]{index=4}
    return {"approved": bool(approved), **_push(state, "approval:resumed", {"approved": bool(approved)})}


def node_persist_final(state: RecruiterState) -> Dict[str, Any]:
    # Finalize outreach status
    approved = state.get("approved")
    final_status = "unknown"

    with Session(engine) as session:
        cand = session.get(Candidate, state["candidate_id"])
        if not cand:
            return {"error": "Candidate missing", **_push(state, "persist:error")}

        if state["require_approval"]:
            if approved is True:
                cand.outreach_status = "approved"
                _audit(session, "outreach_approved", "candidate", cand.id, "approved")
            elif approved is False:
                cand.outreach_status = "rejected"
                _audit(session, "outreach_rejected", "candidate", cand.id, "rejected")
            else:
                _audit(session, "outreach_unknown", "candidate", cand.id, "missing approval value")
        else:
            # No approval required -> treat as approved
            cand.outreach_status = "approved"
            _audit(session, "outreach_auto_approved", "candidate", cand.id, "require_approval=false")

        should_send = bool(
            settings.SMTP_AUTO_SEND_APPROVED and
            cand.outreach_status == "approved" and
            cand.email and
            cand.outreach_json
        )

        if should_send:
            try:
                outreach = json.loads(cand.outreach_json)
                subject = outreach.get("subject")
                body = outreach.get("body")

                if subject and body:
                    send_email(cand.email, subject, body)
                    cand.outreach_status = "sent"
                    cand.stage = "Contacted"
                    _audit(session, "outreach_sent", "candidate", cand.id, cand.email)
                else:
                    cand.outreach_status = "send_failed"
                    _audit(session, "outreach_send_failed", "candidate", cand.id, "missing subject/body")
            except (json.JSONDecodeError, EmailSendError) as exc:
                cand.outreach_status = "send_failed"
                _audit(session, "outreach_send_failed", "candidate", cand.id, str(exc))

        session.add(cand)
        session.commit()
        final_status = cand.outreach_status or "unknown"

    return _push(state, "persist:ok", {"outreach_status": final_status})


def _route_after_outreach(state: RecruiterState) -> str:
    if state.get("error"):
        return "persist"
    return "approve" if state["require_approval"] else "persist"


def build_recruiter_graph():
    g = StateGraph(RecruiterState)

    g.add_node("load", load_from_db)
    g.add_node("extract", node_extract)
    g.add_node("score", node_score)
    g.add_node("outreach", node_outreach)
    g.add_node("approve", node_approval)
    g.add_node("persist", node_persist_final)

    g.add_edge(START, "load")
    g.add_edge("load", "extract")
    g.add_edge("extract", "score")
    g.add_edge("score", "outreach")

    g.add_conditional_edges("outreach", _route_after_outreach, {"approve": "approve", "persist": "persist"})
    g.add_edge("approve", "persist")
    g.add_edge("persist", END)

    return g