import json
import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session, engine
from ..models import Application, Candidate, Job, AuditLog
from ..schemas import BatchTopKRequest, BatchTopKResponse, BatchTopKItem
from ..agent_llm import extract_candidate, score_candidate, draft_outreach, analyze_job


router = APIRouter(prefix="/agent/batch", tags=["agent-batch"])


def audit(session: Session, action: str, entity_type: str, entity_id: int | None, detail: str | None):
    session.add(AuditLog(action=action, entity_type=entity_type, entity_id=entity_id, detail=detail))


def _safe_json_load(s: Optional[str]) -> Optional[dict]:
    if not s:
        return None
    try:
        return json.loads(s)
    except Exception:
        return None


def _get_or_create_application(session: Session, candidate_id: int, job_id: int) -> Application:
    existing = session.exec(
        select(Application)
        .where(Application.candidate_id == candidate_id)
        .where(Application.job_id == job_id)
    ).first()
    if existing:
        return existing
    app_rec = Application(candidate_id=candidate_id, job_id=job_id)
    session.add(app_rec)
    session.commit()
    session.refresh(app_rec)
    return app_rec


@router.post("/topk_outreach", response_model=BatchTopKResponse)
def topk_outreach(payload: BatchTopKRequest, session: Session = Depends(get_session)):
    """
    Phase 1: Extract+Score all selected candidates (writes to Application).
    Phase 2: Pick top_k and draft outreach only for them (writes to Application).
    """

    job = session.get(Job, payload.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Choose candidate set
    if payload.candidate_ids:
        candidates = [c for cid in payload.candidate_ids if (c := session.get(Candidate, cid))]
    else:
        candidates = session.exec(
            select(Candidate).where(Candidate.stage == "Ready").order_by(Candidate.created_at.desc())
        ).all()

    cand_rows = [c for c in candidates if c.resume_text and c.stage == "Ready"]
    if not cand_rows:
        raise HTTPException(status_code=409, detail="No Ready candidates with resume_text to process.")

    # Ensure an Application row exists for every candidate × job
    app_by_cid: Dict[int, int] = {}  # candidate_id -> application_id
    for c in cand_rows:
        app_rec = _get_or_create_application(session, c.id, payload.job_id)
        app_by_cid[c.id] = app_rec.id

    # Optionally skip candidates that already have a score for this job
    if payload.skip_scored:
        cand_rows = [
            c for c in cand_rows
            if not session.exec(
                select(Application)
                .where(Application.candidate_id == c.id)
                .where(Application.job_id == payload.job_id)
                .where(Application.score != None)  # noqa: E711
            ).first()
        ]
        if not cand_rows:
            raise HTTPException(status_code=409, detail="All candidates are already scored for this job.")

    job_obj = {"title": job.title, "description": job.description, "rubric": job.rubric}

    # Load (or compute + cache) job analysis so all candidates use the same scoring categories
    job_analysis: dict | None = None
    if job.analyzed_json:
        try:
            parsed = json.loads(job.analyzed_json)
            if parsed.get("scoring_categories"):
                job_analysis = parsed
        except Exception:
            pass
    if job_analysis is None:
        try:
            job_analysis = analyze_job(job.title, job.description, job.rubric).model_dump()
            job.analyzed_json = json.dumps(job_analysis, ensure_ascii=False)
            session.add(job)
            session.commit()
        except Exception:
            pass  # scoring will still work without it, just with default categories

    cand_data = [
        {
            "id": c.id,
            "name": c.name,
            "email": c.email,
            "resume_text": c.resume_text or "",
            "extracted_json": c.extracted_json,
            "application_id": app_by_cid[c.id],
        }
        for c in cand_rows
    ]

    # --------------------
    # Phase 1: extract + score (concurrent)
    # --------------------
    def process_one(cd: Dict[str, Any]) -> Dict[str, Any]:
        extracted = _safe_json_load(cd.get("extracted_json"))
        if extracted is None:
            parsed = extract_candidate(cd["resume_text"][:8000])
            extracted = parsed.model_dump()

        cand_obj = {
            "name": cd.get("name"),
            "email": cd.get("email"),
            "extracted": extracted,
            "resume_text_excerpt": cd["resume_text"][:2000],
        }

        scored = score_candidate(job_obj, cand_obj, job_analysis=job_analysis).model_dump()
        return {
            "candidate_id": cd["id"],
            "application_id": cd["application_id"],
            "extracted": extracted,
            "score": scored,
        }

    results: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=payload.max_concurrency) as ex:
        futures = [ex.submit(process_one, cd) for cd in cand_data]
        for f in as_completed(futures):
            results.append(f.result())

    results.sort(key=lambda r: float(r["score"]["score"]), reverse=True)

    # Persist extraction to Candidate, scores to Application
    for r in results:
        cand = session.get(Candidate, r["candidate_id"])
        if not cand:
            continue
        # Update extracted_json on Candidate (shared across jobs)
        if not cand.extracted_json:
            cand.extracted_json = json.dumps(r["extracted"], ensure_ascii=False)
            session.add(cand)
            audit(session, "candidate_extracted", "candidate", cand.id,
                  (r["extracted"] or {}).get("headline"))

        # Write score to Application
        app_rec = session.get(Application, r["application_id"])
        if app_rec:
            app_rec.score = float(r["score"]["score"])
            app_rec.score_reason = r["score"]["one_line_reason"]
            app_rec.score_json = json.dumps(r["score"], ensure_ascii=False)
            app_rec.stage = "Scored"
            app_rec.updated_at = datetime.datetime.utcnow()
            session.add(app_rec)
            audit(session, "application_scored", "application", app_rec.id,
                  f"job={job.id} score={app_rec.score}")

    session.commit()

    # --------------------
    # Phase 2: draft outreach only for top_k (concurrent)
    # --------------------
    top = results[: payload.top_k]

    def draft_one(r: Dict[str, Any]) -> Dict[str, Any]:
        sender = {"name": payload.sender_name, "company": payload.sender_company}
        out = draft_outreach(job.title, r["extracted"], sender, payload.tone).model_dump()
        return {"application_id": r["application_id"], "candidate_id": r["candidate_id"], "outreach": out}

    outreach_results: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=min(payload.max_concurrency, max(1, len(top)))) as ex:
        futures = [ex.submit(draft_one, r) for r in top]
        for f in as_completed(futures):
            outreach_results.append(f.result())

    by_app_id = {o["application_id"]: o["outreach"] for o in outreach_results}
    for o in outreach_results:
        app_rec = session.get(Application, o["application_id"])
        if not app_rec:
            continue
        app_rec.outreach_json = json.dumps(o["outreach"], ensure_ascii=False)
        app_rec.outreach_status = "draft"
        app_rec.stage = "Outreach_Draft"
        app_rec.updated_at = datetime.datetime.utcnow()
        session.add(app_rec)
        audit(session, "outreach_drafted", "application", app_rec.id, o["outreach"].get("subject"))

    session.commit()

    # Response
    ranked_items: List[BatchTopKItem] = []
    for r in results:
        s = r["score"]
        ranked_items.append(
            BatchTopKItem(
                application_id=r["application_id"],
                candidate_id=r["candidate_id"],
                score=float(s["score"]),
                recommendation=s["recommendation"],
                one_line_reason=s["one_line_reason"],
                outreach=by_app_id.get(r["application_id"]),
            )
        )

    return BatchTopKResponse(
        job_id=payload.job_id,
        processed=len(results),
        top_k=min(payload.top_k, len(results)),
        ranked=ranked_items,
    )
