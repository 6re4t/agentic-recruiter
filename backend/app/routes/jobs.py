from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..db import get_session
from ..models import Job, AuditLog
from ..schemas import JobCreate

router = APIRouter(prefix="/jobs", tags=["jobs"])


def audit(session: Session, action: str, entity_type: str, entity_id: int | None, detail: str | None):
    session.add(AuditLog(action=action, entity_type=entity_type, entity_id=entity_id, detail=detail))


@router.post("")
def create_job(payload: JobCreate, session: Session = Depends(get_session)):
    job = Job(title=payload.title, description=payload.description, rubric=payload.rubric)
    session.add(job)
    session.commit()
    session.refresh(job)

    audit(session, "job_created", "job", job.id, job.title)
    session.commit()
    return job


@router.get("")
def list_jobs(session: Session = Depends(get_session)):
    return session.exec(select(Job).order_by(Job.created_at.desc())).all()