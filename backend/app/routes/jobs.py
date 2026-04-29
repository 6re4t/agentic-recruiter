from typing import List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlmodel import Session, select

from ..db import get_session
from ..models import Job, Application, AuditLog
from ..schemas import JobCreate, JobUpdate
from ..storage import save_upload_pdf
from ..agent_llm import check_jd_quality

router = APIRouter(prefix="/jobs", tags=["jobs"])


def audit(session: Session, action: str, entity_type: str, entity_id: int | None, detail: str | None):
    session.add(AuditLog(action=action, entity_type=entity_type, entity_id=entity_id, detail=detail))


@router.post("")
def create_job(payload: JobCreate, session: Session = Depends(get_session)):
    job = Job(
        title=payload.title,
        description=payload.description,
        rubric=payload.rubric,
        blind_scoring=payload.blind_scoring,
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    audit(session, "job_created", "job", job.id, job.title)
    session.commit()
    return job


@router.get("")
def list_jobs(session: Session = Depends(get_session)):
    return session.exec(select(Job).order_by(Job.created_at.desc())).all()


@router.delete("/{job_id}")
def delete_job(job_id: int, session: Session = Depends(get_session)):
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    # Delete all applications for this job first
    apps = session.exec(select(Application).where(Application.job_id == job_id)).all()
    for app in apps:
        session.delete(app)
    session.delete(job)
    audit(session, "job_deleted", "job", job_id, job.title)
    session.commit()
    return {"deleted": job_id}


@router.patch("/{job_id}")
def update_job(job_id: int, payload: JobUpdate, session: Session = Depends(get_session)):
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if payload.blind_scoring is not None:
        job.blind_scoring = payload.blind_scoring
        audit(session, "job_blind_scoring_toggled", "job", job_id,
              f"blind_scoring={payload.blind_scoring}")
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


@router.post("/{job_id}/check-quality")
def check_job_quality(job_id: int, session: Session = Depends(get_session)):
    """Run the JD quality checker on this job. Returns a structured report with issues and an overall score."""
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    report = check_jd_quality(job.title, job.description, job.rubric)
    audit(session, "jd_quality_checked", "job", job_id,
          f"score={report.overall_score} issues={len(report.issues)}")
    session.commit()
    return report


@router.get("/{job_id}/applications")
def list_job_applications(job_id: int, session: Session = Depends(get_session)):
    if not session.get(Job, job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    return session.exec(
        select(Application).where(Application.job_id == job_id).order_by(Application.created_at.desc())
    ).all()


@router.post("/{job_id}/upload-candidates")
async def upload_candidates_for_job(
    job_id: int,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    session: Session = Depends(get_session),
):
    """
    Upload one or more PDF resumes directly against a specific job.
    For each PDF:
      1. Save file and create a Candidate placeholder.
      2. In background: extract text, dedup against existing candidates by hash/email,
         then create an Application for this job (idempotent).
    """
    from .candidates import _process_candidate_pdf, audit as cand_audit
    from ..models import Candidate

    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    pdf_files = [f for f in files if (f.filename or "").lower().endswith(".pdf")]
    if not pdf_files:
        raise HTTPException(status_code=400, detail="No PDF files found in upload")

    created_ids: List[int] = []
    for f in pdf_files:
        path = save_upload_pdf(f)

        cand = Candidate(pdf_path=path, stage="Processing", processing_status="new")
        session.add(cand)
        session.commit()
        session.refresh(cand)

        cand_audit(session, "candidate_pdf_uploaded", "candidate", cand.id, f.filename)
        session.commit()

        created_ids.append(cand.id)
        background_tasks.add_task(_process_candidate_pdf, cand.id, job_id)

    return {"job_id": job_id, "created_candidate_ids": created_ids}
