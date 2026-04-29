import json

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..db import get_session
from ..models import Application, Candidate, AuditLog
from ..schemas import SendOutreachRequest, SendOutreachResponse
from ..smtp_mailer import send_email, EmailSendError, smtp_configured

router = APIRouter(prefix="/outreach", tags=["outreach"])


def audit(session: Session, action: str, entity_type: str, entity_id: int | None, detail: str | None):
    session.add(AuditLog(action=action, entity_type=entity_type, entity_id=entity_id, detail=detail))


@router.post("/send", response_model=SendOutreachResponse)
def send_outreach(payload: SendOutreachRequest, session: Session = Depends(get_session)):
    app_rec = session.get(Application, payload.application_id)
    if not app_rec:
        raise HTTPException(status_code=404, detail="Application not found")

    cand = session.get(Candidate, app_rec.candidate_id)
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if not cand.email:
        raise HTTPException(status_code=409, detail="Candidate has no email address")
    if not app_rec.outreach_json:
        raise HTTPException(status_code=409, detail="No outreach draft exists for this application")

    # Guard early — don't touch outreach_status if SMTP isn't configured at all
    if not smtp_configured():
        raise HTTPException(status_code=409, detail="SMTP is not configured. Set SMTP_ENABLED and credentials in .env.")

    try:
        outreach = json.loads(app_rec.outreach_json)
    except Exception:
        raise HTTPException(status_code=500, detail="Invalid outreach_json format")

    subject = outreach.get("subject")
    body = outreach.get("body")
    if not subject or not body:
        raise HTTPException(status_code=409, detail="Outreach draft is missing subject or body")

    try:
        send_email(cand.email, subject, body)
    except EmailSendError as exc:
        # Real send failure (network, auth) — record it
        app_rec.outreach_status = "send_failed"
        session.add(app_rec)
        audit(session, "outreach_send_failed", "application", app_rec.id, str(exc))
        session.commit()
        raise HTTPException(status_code=502, detail=f"Email send failed: {exc}")

    app_rec.outreach_status = "sent"
    app_rec.stage = "Contacted"
    session.add(app_rec)
    audit(session, "outreach_sent", "application", app_rec.id, cand.email)
    session.commit()

    return SendOutreachResponse(application_id=app_rec.id, sent=True, outreach_status=app_rec.outreach_status)
