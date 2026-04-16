"""
Semantic search across resumes, job descriptions, and recruiter notes.

Embeddings are computed on-demand using fastembed (ONNX, local, no API key)
and cached on the model rows so subsequent searches are instant.
"""
import json
from typing import List

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import Candidate, Job, Application
from ..schemas import SearchRequest, SearchHit
from ..agent_llm import embed_text, embed_texts

router = APIRouter(prefix="/search", tags=["search"])


def _cosine(a: list, b: list) -> float:
    va, vb = np.array(a, dtype=float), np.array(b, dtype=float)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    return float(np.dot(va, vb) / denom) if denom > 0 else 0.0


def _snippet(text: str, max_len: int = 220) -> str:
    t = (text or "").strip().replace("\n", " ")
    return t[:max_len] + "…" if len(t) > max_len else t


@router.post("", response_model=List[SearchHit])
def semantic_search(payload: SearchRequest, session: Session = Depends(get_session)):
    types = [t.lower() for t in payload.types]
    if not types:
        types = ["resumes", "jobs", "notes"]

    query_vec = embed_text(payload.q[:1000])
    hits: List[SearchHit] = []

    # ── Resumes ──────────────────────────────────────────────────────────────
    if "resumes" in types:
        candidates = session.exec(
            select(Candidate).where(Candidate.resume_text != None)  # noqa: E711
        ).all()

        # Batch-compute missing embeddings
        need_embed = [c for c in candidates if not c.embedding]
        if need_embed:
            vecs = embed_texts([c.resume_text[:6000] for c in need_embed])
            for c, vec in zip(need_embed, vecs):
                c.embedding = json.dumps(vec)
                session.add(c)
            session.commit()
            for c in need_embed:
                session.refresh(c)

        for c in candidates:
            if not c.embedding:
                continue
            score = _cosine(query_vec, json.loads(c.embedding))
            hits.append(SearchHit(
                type="resume",
                id=c.id,
                label=c.name or c.email or f"Candidate #{c.id}",
                snippet=_snippet(c.resume_text or ""),
                score=score,
                meta={"email": c.email, "stage": c.stage},
            ))

    # ── Job descriptions ─────────────────────────────────────────────────────
    if "jobs" in types:
        jobs = session.exec(select(Job)).all()

        need_embed = [j for j in jobs if not j.embedding]
        if need_embed:
            vecs = embed_texts([(j.title + "\n\n" + j.description)[:6000] for j in need_embed])
            for j, vec in zip(need_embed, vecs):
                j.embedding = json.dumps(vec)
                session.add(j)
            session.commit()
            for j in need_embed:
                session.refresh(j)

        for j in jobs:
            if not j.embedding:
                continue
            score = _cosine(query_vec, json.loads(j.embedding))
            hits.append(SearchHit(
                type="job",
                id=j.id,
                label=j.title,
                snippet=_snippet(j.description),
                score=score,
                meta={},
            ))

    # ── Recruiter notes ───────────────────────────────────────────────────────
    if "notes" in types:
        apps_with_notes = session.exec(
            select(Application).where(Application.recruiter_notes != None)  # noqa: E711
        ).all()

        if apps_with_notes:
            vecs = embed_texts([a.recruiter_notes[:2000] for a in apps_with_notes])
            for app, vec in zip(apps_with_notes, vecs):
                score = _cosine(query_vec, vec)
                # Enrich label with candidate + job info if possible
                cand = session.get(Candidate, app.candidate_id)
                job = session.get(Job, app.job_id)
                label = (
                    f"{cand.name or cand.email or f'Candidate #{cand.id}'}"
                    f" → {job.title if job else f'Job #{app.job_id}'}"
                ) if cand else f"Application #{app.id}"
                hits.append(SearchHit(
                    type="note",
                    id=app.id,
                    label=label,
                    snippet=_snippet(app.recruiter_notes or ""),
                    score=score,
                    meta={
                        "candidate_id": app.candidate_id,
                        "job_id": app.job_id,
                    },
                ))

    hits.sort(key=lambda h: h.score, reverse=True)
    return hits[: payload.limit]
