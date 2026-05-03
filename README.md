# Agentic Recruiter

A full-stack AI recruiting system built with FastAPI, LangGraph, and React. Automates the end-to-end hiring pipeline from resume ingestion to personalised outreach, with a conversational assistant and interactive relationship graph.

## Features

### Core Pipeline
- **Job management** — create jobs with descriptions and evaluation rubrics
- **Candidate ingestion** — manual text entry, bulk PDF upload, or **folder upload linked to a job** (text extraction + OCR fallback)
- **4-agent LangGraph pipeline** — extraction → job analysis → scoring → outreach, per candidate
- **Human-in-the-loop** — pipeline pauses for recruiter approval before sending outreach; resume via approve/reject
- **Batch Top-K** — score all candidates concurrently, draft outreach for the top N; skip already-scored candidates
- **Rejection threshold** — candidates scoring below the threshold automatically receive a polite rejection email draft instead of an outreach; configurable per run (default 50)

### Intelligence
- **Structured scoring** — per-job fixed category names, category scores with rationale, strengths/gaps, evidence snippets
- **Blind scoring mode** — hide candidate names/contact info from the LLM during scoring to reduce bias
- **JD quality checker** — AI reviews a job description and returns a quality score with actionable improvement suggestions before you start sourcing
- **Semantic search** — search resumes, job descriptions, and recruiter notes by meaning (OpenAI embeddings, cached to DB)
- **Conversational assistant** — tool-calling chat agent that can query jobs, search resumes, rank candidates, and explain scores in natural language
- **LLM resilience** — all structured LLM calls use a retry helper (3 attempts, 1.5 s backoff) to handle transient OpenRouter failures

### Visualisation
- **Relationship graph** — interactive node graph (React Flow) showing jobs → candidates → skills, edges colour-coded by AI score; click any node for full details

### Workflow
- **Recruiter notes** — free-text notes on each application, included in semantic search
- **Outreach drafting** — tone/sender settings, approve/reject flow, SMTP send (HTML multipart with proper paragraph formatting)
- **Settings** — configure sender info, tone presets, default Top-K, rejection threshold, approval requirement; runtime environment card shows live model/SMTP config
- **Audit log** — all key actions recorded

## Tech Stack

- **Backend:** FastAPI, SQLModel, LangGraph 1.x, SQLite (WAL mode)
- **Frontend:** React 19 (Vite), React Flow (@xyflow/react)
- **LLM Provider:** OpenRouter (structured outputs via `openai` SDK)
- **Embeddings:** `openai/text-embedding-3-small` via OpenRouter, cached to DB
- **Email:** SMTP (HTML multipart; manual send + optional auto-send after approval)

## Project Structure

```
backend/app/
  main.py            — FastAPI app, router registration
  models.py          — SQLModel DB models
  schemas.py         — Pydantic request/response schemas
  db.py              — SQLAlchemy engine (WAL mode, connection timeout)
  agent_llm.py       — LLM calls: extract, analyze_job, score, embed, draft_outreach, check_jd_quality
  recruiter_graph.py — LangGraph pipeline (4 agents + human-in-the-loop interrupt + rejection threshold)
  routes/
    jobs.py          — CRUD + delete
    candidates.py    — CRUD + PDF upload + delete
    applications.py  — CRUD + recruiter notes PATCH
    batch.py         — Batch Top-K endpoint
    search.py        — Semantic search endpoint
    agent_graph.py   — Pipeline run/resume
    chat.py          — Conversational assistant (tool-calling agent)
    outreach.py      — SMTP send
    settings.py      — GET/PUT outreach settings + GET /settings/env
    audit.py         — Audit log
    health.py        — OpenRouter connectivity check
frontend/src/
  App.jsx            — Shell + Jobs, Candidates, Search, Settings views
  GraphView.jsx      — Interactive relationship graph (React Flow)
  ChatView.jsx       — Conversational recruiting assistant
data/                — SQLite DB, LangGraph checkpoints, uploaded PDFs, settings.json
run-dev.ps1          — Starts backend + frontend (strips inherited env vars to avoid .env override)
```

## Prerequisites

- Python 3.10+ (tested on 3.14)
- Node.js 18+
- npm
- Conda environment named `agentic` (or adjust `run-dev.ps1`)

## Environment Setup

Create a `.env` file at the repository root:

```env
# Required
OPENROUTER_API_KEY=your_key_here

# Optional — defaults shown
OPENROUTER_MODEL=openai/gpt-4o-2024-08-06
VITE_API_BASE_URL=http://127.0.0.1:8000

# Optional — SMTP for outreach email
SMTP_ENABLED=false
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=user@example.com
SMTP_PASSWORD=secret
SMTP_FROM_EMAIL=recruiter@example.com
SMTP_FROM_NAME=Recruiting Team
SMTP_AUTO_SEND_APPROVED=false
```

## Install

```powershell
# Backend (activate your environment first)
pip install -r requirements.txt

# Frontend
cd frontend
npm install
```

## Run

### Option A — one command (Windows PowerShell)

```powershell
./run-dev.ps1
```

Opens backend on `http://localhost:8000` and frontend on `http://localhost:5173`.

### Option B — separate terminals

```powershell
# Terminal 1 (repo root)
conda activate agentic
uvicorn backend.app.main:app --reload

# Terminal 2
cd frontend
npm run dev
```

## API Overview

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check |
| `POST/GET` | `/jobs` | Create / list jobs |
| `DELETE` | `/jobs/{id}` | Delete job + applications |
| `POST` | `/jobs/{id}/upload-candidates` | Upload PDFs linked to a specific job |
| `POST/GET` | `/candidates` | Create / list candidates |
| `POST` | `/candidates/upload_pdfs` | Bulk PDF upload (unlinked) |
| `DELETE` | `/candidates/{id}` | Delete candidate + applications |
| `GET` | `/candidates/{id}/applications` | Applications for a candidate |
| `PATCH` | `/applications/{id}/notes` | Save recruiter notes |
| `POST` | `/agent/graph/run` | Run pipeline for one candidate × job |
| `POST` | `/agent/graph/resume` | Resume a paused pipeline (approve/reject) |
| `POST` | `/agent/batch/topk_outreach` | Batch score + outreach (supports `skip_scored`) |
| `POST` | `/search` | Semantic search (resumes, jobs, notes) |
| `POST` | `/chat` | Conversational assistant (tool-calling agent) |
| `POST` | `/outreach/send` | Send drafted email via SMTP |
| `GET/PUT` | `/settings` | Outreach settings (incl. rejection threshold) |
| `GET` | `/settings/env` | Live runtime environment info (model, SMTP, DB) |
| `POST` | `/health/check_jd` | AI quality check on a job description |
| `GET` | `/audit` | Audit log |
| `GET` | `/health/openrouter` | LLM connectivity check |

## Typical Flow

1. **Create a job** with a description and scoring rubric. Use the **JD quality checker** to get AI feedback on the description before sourcing.
2. **Upload candidate PDFs** — individually, in bulk, or as a folder directly linked to the job. The system extracts text and parses name/email automatically.
3. Wait for candidates to reach `Ready` stage.
4. **Run pipeline** (single candidate) or **Batch Top-K** (all ready candidates at once).
   - Enable "Skip scored" to re-run only new candidates.
   - Enable "Blind scoring" to hide candidate identifiers from the LLM.
   - Set a **rejection threshold** (0–100) — candidates below the score receive a rejection email draft instead of outreach.
5. **Review** scores, category breakdowns, strengths/gaps, and evidence snippets in the UI.
6. **Explore the Graph tab** — visualise job-candidate relationships and score distribution; click any node for details.
7. **Ask the Chat assistant** — query candidates by skill, get ranked lists, explain scores in plain language.
8. **Add recruiter notes** to any application.
9. **Send outreach or rejection emails** manually via the UI or automatically if `SMTP_AUTO_SEND_APPROVED=true`.
10. **Search** across all resumes, job descriptions, and notes from the Search tab.

## Data

- All runtime data lives under `data/` — SQLite DB (`app.db`), LangGraph checkpoints, uploaded PDFs, and `settings.json`.
- Resume embeddings are computed on first search and cached on the candidate row — subsequent searches are fast.
- Deleting a job or candidate also deletes all associated applications.
- `.env`, `data/`, and build artifacts are gitignored.

## Notes

- OCR fallback requires Tesseract and pdf2image system dependencies.
- Job analysis (scoring categories) is computed once per job and cached; categories stay consistent across all candidates scored for that job.
- The LLM model can be overridden per-deployment via `OPENROUTER_MODEL` in `.env`. Check the live value in **Settings → Runtime Environment**.
- The chat assistant is stateless server-side — the full conversation history is sent with each request from the frontend.
- SQLite runs in WAL journal mode for concurrent read/write access during multi-agent pipeline runs.
- `run-dev.ps1` strips known environment variables from the PowerShell session before starting uvicorn, so `.env` values are never overridden by stale session vars.
