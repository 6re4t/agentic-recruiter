import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session, engine
from ..models import Candidate, Job, AuditLog
from ..schemas import BatchTopKRequest, BatchTopKResponse, BatchTopKItem
from ..agent_llm import extract_candidate, score_candidate, draft_outreach


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


@router.post("/topk_outreach", response_model=BatchTopKResponse)
def topk_outreach(payload: BatchTopKRequest, session: Session = Depends(get_session)):
    """
    Phase 1: Extract+Score all selected candidates
    Phase 2: Pick top_k and draft outreach only for them
    Persists extracted_json, score, and outreach_json/outreach_status='draft' for top_k.
    """

    job = session.get(Job, payload.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Choose candidate set
    if payload.candidate_ids:
        candidates = []
        for cid in payload.candidate_ids:
            c = session.get(Candidate, cid)
            if c:
                candidates.append(c)
    else:
        candidates = session.exec(
            select(Candidate).where(Candidate.stage == "Ready").order_by(Candidate.created_at.desc())
        ).all()

    # Filter only candidates with resume_text ready
    cand_rows = [c for c in candidates if c.resume_text and c.stage == "Ready"]
    if not cand_rows:
        raise HTTPException(status_code=409, detail="No Ready candidates with resume_text to process.")

    job_obj = {"title": job.title, "description": job.description, "rubric": job.rubric}

    # Prepare plain dicts (avoid sharing SQLModel objects across threads)
    cand_data = [
        {
            "id": c.id,
            "name": c.name,
            "email": c.email,
            "resume_text": c.resume_text or "",
            "extracted_json": c.extracted_json,
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

        scored = score_candidate(job_obj, cand_obj).model_dump()
        return {"candidate_id": cd["id"], "extracted": extracted, "score": scored}

    results: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=payload.max_concurrency) as ex:
        futures = [ex.submit(process_one, cd) for cd in cand_data]
        for f in as_completed(futures):
            results.append(f.result())

    # Sort by score desc
    results.sort(key=lambda r: float(r["score"]["score"]), reverse=True)

    # Persist extraction + scores (sequential DB writes to avoid SQLite locks)
    for r in results:
        cand = session.get(Candidate, r["candidate_id"])
        if not cand:
            continue
        cand.extracted_json = json.dumps(r["extracted"], ensure_ascii=False)
        cand.score = float(r["score"]["score"])
        cand.score_reason = r["score"]["one_line_reason"]
        session.add(cand)

        audit(session, "candidate_extracted", "candidate", cand.id, (r["extracted"] or {}).get("headline"))
        audit(session, "candidate_scored", "candidate", cand.id, f"job={job.id} score={cand.score}")

    session.commit()

    # --------------------
    # Phase 2: draft outreach only for top_k (concurrent)
    # --------------------
    top = results[: payload.top_k]

    def draft_one(r: Dict[str, Any]) -> Dict[str, Any]:
        sender = {"name": payload.sender_name, "company": payload.sender_company}
        out = draft_outreach(job.title, r["extracted"], sender, payload.tone).model_dump()
        return {"candidate_id": r["candidate_id"], "outreach": out}

    outreach_results: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=min(payload.max_concurrency, max(1, len(top)))) as ex:
        futures = [ex.submit(draft_one, r) for r in top]
        for f in as_completed(futures):
            outreach_results.append(f.result())

    # Persist outreach drafts
    by_id = {o["candidate_id"]: o["outreach"] for o in outreach_results}
    for r in top:
        cid = r["candidate_id"]
        out = by_id.get(cid)
        if not out:
            continue
        cand = session.get(Candidate, cid)
        if not cand:
            continue
        cand.outreach_json = json.dumps(out, ensure_ascii=False)
        cand.outreach_status = "draft"
        session.add(cand)

        audit(session, "outreach_drafted", "candidate", cand.id, out.get("subject"))

    session.commit()

    # Response: ranked list (includes outreach only for top_k)
    ranked_items: List[BatchTopKItem] = []
    for r in results:
        s = r["score"]
        cid = r["candidate_id"]
        ranked_items.append(
            BatchTopKItem(
                candidate_id=cid,
                score=float(s["score"]),
                recommendation=s["recommendation"],
                one_line_reason=s["one_line_reason"],
                outreach=by_id.get(cid),  # only present for top_k
            )
        )

    return BatchTopKResponse(
        job_id=payload.job_id,
        processed=len(results),
        top_k=min(payload.top_k, len(results)),
        ranked=ranked_items,
    )