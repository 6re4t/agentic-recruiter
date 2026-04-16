import hashlib
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, UploadFile, File, BackgroundTasks, HTTPException
from sqlmodel import Session, select

from ..db import get_session, engine
from ..models import Application, Candidate, AuditLog
from ..storage import save_upload_pdf
from ..pdf_extract import extract_resume_text
from ..agent_llm import extract_candidate
from ..schemas import CandidateCreate

router = APIRouter(prefix="/candidates", tags=["candidates"])


def audit(session: Session, action: str, entity_type: str, entity_id: int | None, detail: str | None):
    session.add(AuditLog(action=action, entity_type=entity_type, entity_id=entity_id, detail=detail))


def _resume_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def find_or_create_candidate(session: Session, *, resume_text: str | None = None,
                              email: str | None = None, name: str | None = None,
                              pdf_path: str | None = None) -> tuple[Candidate, bool]:
    """
    Return (candidate, created).
    Dedup priority: email match → resume_hash match → new record.
    """
    # 1. Match by email
    if email:
        existing = session.exec(select(Candidate).where(Candidate.email == email)).first()
        if existing:
            return existing, False

    # 2. Match by resume hash
    r_hash = _resume_hash(resume_text) if resume_text else None
    if r_hash:
        existing = session.exec(select(Candidate).where(Candidate.resume_hash == r_hash)).first()
        if existing:
            return existing, False

    # 3. Create new
    cand = Candidate(
        name=name,
        email=email,
        resume_text=resume_text,
        resume_hash=r_hash,
        pdf_path=pdf_path,
        stage="Ready" if resume_text else "Processing",
        processing_status="ready" if resume_text else "new",
    )
    session.add(cand)
    session.commit()
    session.refresh(cand)
    return cand, True


def _process_candidate_pdf(candidate_id: int, job_id: int | None = None):
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
            r_hash = _resume_hash(text)
            # Check if another candidate already has this resume
            dupe = session.exec(
                select(Candidate)
                .where(Candidate.resume_hash == r_hash)
                .where(Candidate.id != cand.id)
            ).first()
            if dupe:
                # Merge: delete this placeholder and re-point any application
                if job_id:
                    _ensure_application(session, dupe.id, job_id)
                session.delete(cand)
                session.commit()
                return

            cand.resume_text = text
            cand.resume_hash = r_hash
            cand.processing_status = "ready"
            cand.stage = "Ready"
            audit(session, "cv_text_extracted", "candidate", cand.id, method)

            # Quick LLM extraction so name/email show up immediately without
            # waiting for the full pipeline to run.
            try:
                parsed = extract_candidate(text[:8000])
                extracted = parsed.model_dump()
                if not cand.name and extracted.get("name"):
                    cand.name = extracted["name"]
                if not cand.email and extracted.get("email"):
                    cand.email = extracted["email"]
                cand.extracted_json = json.dumps(extracted, ensure_ascii=False)
                audit(session, "candidate_extracted", "candidate", cand.id, extracted.get("headline"))
            except Exception:
                pass  # extraction failure is non-fatal; pipeline will retry
        else:
            cand.processing_status = "error"
            cand.stage = "Error"
            audit(session, "cv_text_extract_failed", "candidate", cand.id, err)

        session.add(cand)
        session.commit()

        # Create application after extraction if job context provided
        if job_id and cand.processing_status == "ready":
            _ensure_application(session, cand.id, job_id)


def _ensure_application(session: Session, candidate_id: int, job_id: int) -> Application:
    existing = session.exec(
        select(Application)
        .where(Application.candidate_id == candidate_id)
        .where(Application.job_id == job_id)
    ).first()
    if existing:
        return existing
    app = Application(candidate_id=candidate_id, job_id=job_id)
    session.add(app)
    session.commit()
    session.refresh(app)
    audit(session, "application_created", "application", app.id,
          f"candidate={candidate_id} job={job_id}")
    session.commit()
    return app


@router.post("")
def create_candidate(payload: CandidateCreate, session: Session = Depends(get_session)):
    email = str(payload.email) if payload.email else None
    cand, created = find_or_create_candidate(
        session,
        resume_text=payload.resume_text,
        email=email,
        name=payload.name,
    )
    if created:
        cand.text_extraction_method = "manual"
        session.add(cand)
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
        background_tasks.add_task(_process_candidate_pdf, cand.id, None)

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


@router.delete("/{candidate_id}")
def delete_candidate(candidate_id: int, session: Session = Depends(get_session)):
    cand = session.get(Candidate, candidate_id)
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")
    # Delete associated applications first
    apps = session.exec(select(Application).where(Application.candidate_id == candidate_id)).all()
    for app in apps:
        session.delete(app)
    session.delete(cand)
    audit(session, "candidate_deleted", "candidate", candidate_id, cand.name or str(candidate_id))
    session.commit()
    return {"deleted": candidate_id}


@router.get("/{candidate_id}/applications")
def list_candidate_applications(candidate_id: int, session: Session = Depends(get_session)):
    if not session.get(Candidate, candidate_id):
        raise HTTPException(status_code=404, detail="Candidate not found")
    return session.exec(
        select(Application).where(Application.candidate_id == candidate_id)
        .order_by(Application.created_at.desc())
    ).all()