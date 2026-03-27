import json
from typing import List, Optional

from fastapi import APIRouter, Depends, UploadFile, File, BackgroundTasks, HTTPException
from sqlmodel import Session, select

from ..db import get_session, engine
from ..models import Candidate, AuditLog
from ..storage import save_upload_pdf
from ..pdf_extract import extract_resume_text
from ..schemas import CandidateCreate

router = APIRouter(prefix="/candidates", tags=["candidates"])


def audit(session: Session, action: str, entity_type: str, entity_id: int | None, detail: str | None):
    session.add(AuditLog(action=action, entity_type=entity_type, entity_id=entity_id, detail=detail))


def _process_candidate_pdf(candidate_id: int):
    from sqlmodel import Session

    with Session(engine) as session:
        cand = session.get(Candidate, candidate_id)
        if not cand or not cand.pdf_path:
            return

        cand.processing_status = "extracting"
        cand.stage = "Processing"
        session.add(cand)
        session.commit()

        text, method, err = extract_resume_text(cand.pdf_path)
        cand.text_extraction_method = method
        cand.extraction_error = err

        if text:
            cand.resume_text = text
            cand.processing_status = "ready"
            cand.stage = "Ready"
            audit(session, "cv_text_extracted", "candidate", cand.id, method)
        else:
            cand.processing_status = "error"
            cand.stage = "Error"
            audit(session, "cv_text_extract_failed", "candidate", cand.id, err)

        session.add(cand)
        session.commit()


@router.post("")
def create_candidate(payload: CandidateCreate, session: Session = Depends(get_session)):
    cand = Candidate(
        name=payload.name,
        email=str(payload.email) if payload.email else None,
        resume_text=payload.resume_text,
        stage="Ready",
        processing_status="ready",
        text_extraction_method="manual",
    )
    session.add(cand)
    session.commit()
    session.refresh(cand)

    audit(session, "candidate_created", "candidate", cand.id, "manual")
    session.commit()
    return cand


@router.post("/upload_pdfs")
async def upload_pdfs(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    session: Session = Depends(get_session),
):
    created_ids: List[int] = []

    for f in files:
        if not (f.filename or "").lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail=f"Not a PDF: {f.filename}")

        path = save_upload_pdf(f)

        cand = Candidate(pdf_path=path, stage="Processing", processing_status="new")
        session.add(cand)
        session.commit()
        session.refresh(cand)

        audit(session, "candidate_pdf_uploaded", "candidate", cand.id, f.filename)
        session.commit()

        created_ids.append(cand.id)
        background_tasks.add_task(_process_candidate_pdf, cand.id)

    return {"created_candidate_ids": created_ids}


@router.get("")
def list_candidates(limit: int = 50, stage: Optional[str] = None, session: Session = Depends(get_session)):
    stmt = select(Candidate).order_by(Candidate.created_at.desc()).limit(limit)
    if stage:
        stmt = stmt.where(Candidate.stage == stage)
    return session.exec(stmt).all()


@router.get("/{candidate_id}")
def get_candidate(candidate_id: int, session: Session = Depends(get_session)):
    cand = session.get(Candidate, candidate_id)
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")

    extracted = None
    outreach = None
    if cand.extracted_json:
        try:
            extracted = json.loads(cand.extracted_json)
        except Exception:
            extracted = None
    if cand.outreach_json:
        try:
            outreach = json.loads(cand.outreach_json)
        except Exception:
            outreach = None

    return {"candidate": cand, "extracted": extracted, "outreach": outreach}