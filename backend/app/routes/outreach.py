import json

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..db import get_session
from ..models import Candidate, AuditLog
from ..schemas import SendOutreachRequest, SendOutreachResponse
from ..smtp_mailer import send_email, EmailSendError

router = APIRouter(prefix="/outreach", tags=["outreach"])


def audit(session: Session, action: str, entity_type: str, entity_id: int | None, detail: str | None):
    session.add(AuditLog(action=action, entity_type=entity_type, entity_id=entity_id, detail=detail))


@router.post("/send", response_model=SendOutreachResponse)
def send_outreach(payload: SendOutreachRequest, session: Session = Depends(get_session)):
    cand = session.get(Candidate, payload.candidate_id)
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if not cand.email:
        raise HTTPException(status_code=409, detail="Candidate has no email")
    if not cand.outreach_json:
        raise HTTPException(status_code=409, detail="Candidate has no outreach draft")

    try:
        outreach = json.loads(cand.outreach_json)
    except Exception:
        raise HTTPException(status_code=500, detail="Invalid outreach_json format")

    subject = outreach.get("subject")
    body = outreach.get("body")
    if not subject or not body:
        raise HTTPException(status_code=409, detail="Outreach draft is missing subject/body")

    try:
        send_email(cand.email, subject, body)
    except EmailSendError as exc:
        cand.outreach_status = "send_failed"
        session.add(cand)
        audit(session, "outreach_send_failed", "candidate", cand.id, str(exc))
        session.commit()
        return SendOutreachResponse(
            candidate_id=cand.id,
            sent=False,
            outreach_status=cand.outreach_status or "send_failed",
            detail=str(exc),
        )

    cand.outreach_status = "sent"
    cand.stage = "Contacted"
    session.add(cand)
    audit(session, "outreach_sent", "candidate", cand.id, cand.email)
    session.commit()

    return SendOutreachResponse(candidate_id=cand.id, sent=True, outreach_status=cand.outreach_status)
