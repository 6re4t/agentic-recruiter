from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import Application, Candidate, Job, AuditLog
from ..schemas import ApplicationCreate, NotesUpdate

router = APIRouter(prefix="/applications", tags=["applications"])


def _audit(session: Session, action: str, entity_id: int | None, detail: str | None):
    session.add(AuditLog(action=action, entity_type="application", entity_id=entity_id, detail=detail))


@router.post("", response_model=Application)
def create_application(payload: ApplicationCreate, session: Session = Depends(get_session)):
    if not session.get(Candidate, payload.candidate_id):
        raise HTTPException(status_code=404, detail="Candidate not found")
    if not session.get(Job, payload.job_id):
        raise HTTPException(status_code=404, detail="Job not found")

    existing = session.exec(
        select(Application)
        .where(Application.candidate_id == payload.candidate_id)
        .where(Application.job_id == payload.job_id)
    ).first()
    if existing:
        return existing

    application = Application(candidate_id=payload.candidate_id, job_id=payload.job_id)
    session.add(application)
    session.commit()
    session.refresh(application)

    _audit(session, "application_created", application.id,
           f"candidate={payload.candidate_id} job={payload.job_id}")
    session.commit()
    return application


@router.get("")
def list_applications(
    job_id: Optional[int] = None,
    candidate_id: Optional[int] = None,
    session: Session = Depends(get_session),
):
    q = select(Application)
    if job_id is not None:
        q = q.where(Application.job_id == job_id)
    if candidate_id is not None:
        q = q.where(Application.candidate_id == candidate_id)
    return session.exec(q.order_by(Application.created_at.desc())).all()


@router.get("/{application_id}", response_model=Application)
def get_application(application_id: int, session: Session = Depends(get_session)):
    app = session.get(Application, application_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    return app


@router.patch("/{application_id}/notes", response_model=Application)
def update_notes(
    application_id: int,
    payload: NotesUpdate,
    session: Session = Depends(get_session),
):
    app = session.get(Application, application_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    app.recruiter_notes = payload.notes
    import datetime
    app.updated_at = datetime.datetime.utcnow()
    session.add(app)
    _audit(session, "notes_updated", app.id, None)
    session.commit()
    session.refresh(app)
    return app
