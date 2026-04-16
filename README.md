# Agentic Recruiter

FastAPI + LangGraph backend and React frontend for AI-assisted recruiting workflows.

## Features

- **Job management** — create jobs with descriptions and evaluation rubrics
- **Candidate ingestion** — manual text entry or bulk PDF upload (text extraction + OCR fallback)
- **4-agent LangGraph pipeline** — extraction → job analysis → scoring → outreach, per candidate
- **Batch Top-K** — score all candidates concurrently, draft outreach for the top N; skip already-scored candidates
- **Structured scoring** — per-job fixed category names, category scores with rationale, strengths/gaps, evidence snippets
- **Semantic search** — search resumes, job descriptions, and recruiter notes by meaning (OpenAI embeddings, cached to DB)
- **Recruiter notes** — free-text notes on each application, included in semantic search
- **Outreach drafting** — tone/sender settings, approve/reject flow, SMTP send
- **Settings page** — configure sender info, tone presets, default Top-K, approval requirement
- **Audit log** — all key actions recorded

## Tech Stack

- **Backend:** FastAPI, SQLModel, LangGraph, SQLite
- **Frontend:** React (Vite)
- **LLM Provider:** OpenRouter (structured outputs via `openai` SDK)
- **Embeddings:** `openai/text-embedding-3-small` via OpenRouter
- **Email:** SMTP (manual send endpoint + optional auto-send after approval)

## Project Structure

```
backend/app/
  main.py            — FastAPI app, router registration
  models.py          — SQLModel DB models
  schemas.py         — Pydantic request/response schemas
  agent_llm.py       — LLM calls: extract, analyze_job, score, embed, draft_outreach
  recruiter_graph.py — LangGraph pipeline (4 agents)
  routes/
    jobs.py          — CRUD + delete
    candidates.py    — CRUD + PDF upload + delete
    applications.py  — CRUD + recruiter notes PATCH
    batch.py         — Batch Top-K endpoint
    search.py        — Semantic search endpoint
    agent_graph.py   — Pipeline run/resume
    outreach.py      — SMTP send
    settings.py      — GET/PUT outreach settings
    audit.py         — Audit log
    health.py        — OpenRouter connectivity check
frontend/src/
  App.jsx            — All views: Jobs, Candidates, Search, Settings
data/                — SQLite DB, checkpoints, uploaded PDFs, settings.json
run-dev.ps1          — Starts backend + frontend in separate windows
```

## Prerequisites

- Python 3.10+ (tested on 3.14)
- Node.js 18+
- npm

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
# Backend
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
| `POST/GET` | `/candidates` | Create / list candidates |
| `POST` | `/candidates/upload_pdfs` | Bulk PDF upload |
| `DELETE` | `/candidates/{id}` | Delete candidate + applications |
| `GET` | `/candidates/{id}/applications` | Applications for a candidate |
| `PATCH` | `/applications/{id}/notes` | Save recruiter notes |
| `POST` | `/agent/graph/run` | Run pipeline for one candidate × job |
| `POST` | `/agent/graph/resume` | Resume a paused pipeline (approve/reject) |
| `POST` | `/agent/batch/topk_outreach` | Batch score + outreach (supports `skip_scored`) |
| `POST` | `/search` | Semantic search (resumes, jobs, notes) |
| `POST` | `/outreach/send` | Send drafted email via SMTP |
| `GET/PUT` | `/settings` | Outreach settings |
| `GET` | `/audit` | Audit log |
| `GET` | `/health/openrouter` | LLM connectivity check |

## Typical Flow

1. **Create a job** with a description and scoring rubric.
2. **Upload candidate PDFs** (or create candidates manually). The system extracts text and parses name/email automatically.
3. Wait for candidates to reach `Ready` stage.
4. **Run pipeline** (single candidate) or **Batch Top-K** (all ready candidates at once).
   - Enable "Skip scored" to re-run only new candidates.
5. **Review** scores, category breakdowns, strengths/gaps, and evidence snippets in the UI.
6. **Add recruiter notes** to any application.
7. **Send outreach** manually via the UI or automatically if `SMTP_AUTO_SEND_APPROVED=true`.
8. **Search** across all resumes, job descriptions, and notes from the 🔍 Search tab.

## Data

- All runtime data lives under `data/` — SQLite DB (`app.db`), LangGraph checkpoints, uploaded PDFs, and `settings.json`.
- Resume embeddings are computed on first search and cached on the candidate row — subsequent searches are fast.
- Deleting a job or candidate also deletes all associated applications.
- `.env`, `data/`, and build artifacts are gitignored.

## Notes

- OCR fallback requires Tesseract and pdf2image system dependencies.
- Job analysis (scoring categories) is computed once per job and cached; categories stay consistent across all candidates scored for that job.
- The LLM model can be overridden per-deployment via `OPENROUTER_MODEL` in `.env`.
