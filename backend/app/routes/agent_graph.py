import uuid
import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session

from langgraph.types import Command  # resume interrupts with Command(resume=...) :contentReference[oaicite:7]{index=7}

from ..db import get_session
from ..models import Candidate, Job, AgentRun, AuditLog
from ..schemas import GraphRunRequest, GraphRunResponse, GraphResumeRequest

router = APIRouter(prefix="/agent/graph", tags=["agent-graph"])


def audit(session: Session, action: str, entity_type: str, entity_id: int | None, detail: str | None):
    session.add(AuditLog(action=action, entity_type=entity_type, entity_id=entity_id, detail=detail))


def _extract_interrupt_payload(result: dict):
    intr = result.get("__interrupt__")
    if not intr:
        return None
    # Often it's a list of Interrupt objects; try to get `.value` if present.
    try:
        first = intr[0]
        if hasattr(first, "value"):
            return first.value
        if isinstance(first, dict) and "value" in first:
            return first["value"]
    except Exception:
        pass
    return intr


@router.post("/run", response_model=GraphRunResponse)
def run_graph(payload: GraphRunRequest, request: Request, session: Session = Depends(get_session)):
    # Validate job/candidate exist and candidate is ready
    job = session.get(Job, payload.job_id)
    cand = session.get(Candidate, payload.candidate_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if not cand.resume_text:
        raise HTTPException(status_code=409, detail="Candidate resume_text not ready (still processing or failed).")

    thread_id = uuid.uuid4().hex

    run = AgentRun(thread_id=thread_id, job_id=payload.job_id, candidate_id=payload.candidate_id, status="running")
    session.add(run)
    session.commit()
    session.refresh(run)

    audit(session, "graph_run_created", "agent_run", run.id, f"thread_id={thread_id}")
    session.commit()

    graph = request.app.state.recruiter_graph

    initial_state = {
        "candidate_id": payload.candidate_id,
        "job_id": payload.job_id,
        "require_approval": payload.require_approval,
        "sender_name": payload.sender_name,
        "sender_company": payload.sender_company,
        "tone": payload.tone,
        "updates": [],
    }

    config = {"configurable": {"thread_id": thread_id}}
    result = graph.invoke(initial_state, config=config)

    interrupt_payload = _extract_interrupt_payload(result)
    updates = result.get("updates", [])

    # Update run status
    run.updated_at = datetime.datetime.utcnow()
    if interrupt_payload is not None:
        run.status = "waiting_approval"
        session.add(run)
        audit(session, "graph_waiting_approval", "agent_run", run.id, "interrupt")
        session.commit()
        return GraphRunResponse(
            run_id=run.id,
            thread_id=thread_id,
            status=run.status,
            updates=updates,
            interrupt=interrupt_payload,
        )

    if result.get("error"):
        run.status = "failed"
        run.error = result.get("error")
        session.add(run)
        audit(session, "graph_failed", "agent_run", run.id, run.error)
        session.commit()
        return GraphRunResponse(run_id=run.id, thread_id=thread_id, status=run.status, updates=updates, interrupt=None)

    run.status = "completed"
    session.add(run)
    audit(session, "graph_completed", "agent_run", run.id, None)
    session.commit()

    return GraphRunResponse(run_id=run.id, thread_id=thread_id, status=run.status, updates=updates, interrupt=None)


@router.post("/resume", response_model=GraphRunResponse)
def resume_graph(payload: GraphResumeRequest, request: Request, session: Session = Depends(get_session)):
    run = session.get(AgentRun, payload.run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status != "waiting_approval":
        raise HTTPException(status_code=409, detail=f"Run status is '{run.status}', not waiting_approval.")

    graph = request.app.state.recruiter_graph
    config = {"configurable": {"thread_id": run.thread_id}}

    # Resume the interrupted node
    result = graph.invoke(Command(resume=payload.approved), config=config)  # :contentReference[oaicite:8]{index=8}
    updates = result.get("updates", [])
    interrupt_payload = _extract_interrupt_payload(result)

    run.updated_at = datetime.datetime.utcnow()
    if interrupt_payload is not None:
        run.status = "waiting_approval"
        session.add(run)
        audit(session, "graph_still_waiting_approval", "agent_run", run.id, "interrupt")
        session.commit()
        return GraphRunResponse(run_id=run.id, thread_id=run.thread_id, status=run.status, updates=updates, interrupt=interrupt_payload)

    if result.get("error"):
        run.status = "failed"
        run.error = result.get("error")
        session.add(run)
        audit(session, "graph_failed", "agent_run", run.id, run.error)
        session.commit()
        return GraphRunResponse(run_id=run.id, thread_id=run.thread_id, status=run.status, updates=updates, interrupt=None)

    run.status = "completed"
    session.add(run)
    audit(session, "graph_completed", "agent_run", run.id, None)
    session.commit()

    return GraphRunResponse(run_id=run.id, thread_id=run.thread_id, status=run.status, updates=updates, interrupt=None)