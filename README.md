# Agentic Recruiter

FastAPI + LangGraph backend and React frontend for recruiter workflows:
- create jobs
- ingest candidate resumes (manual text or PDF upload)
- extract and score candidates with LLM calls
- draft outreach emails
- approve/resume graph runs
- send outreach through SMTP

## Tech Stack

- **Backend:** FastAPI, SQLModel, LangGraph, SQLite
- **Frontend:** React (Vite)
- **LLM Provider:** OpenRouter
- **Email:** SMTP (manual send endpoint + optional auto-send after approval)

## Project Structure

- `backend/app` — API, graph logic, DB models, settings
- `frontend` — React UI
- `data` — runtime artifacts (SQLite DB, checkpoints, uploads)
- `run-dev.ps1` — starts backend + frontend in separate PowerShell windows

## Prerequisites

- Python 3.10+
- Node.js 18+
- npm
- (Optional) Conda env named `agentic` if you use `run-dev.ps1`

## Environment Setup

Use a single env file at repository root.

1. Copy `.env.example` to `.env`.
2. Set required values:
   - `OPENROUTER_API_KEY` (required for extraction/scoring/outreach generation)
3. Optional SMTP values for email sending:
   - `SMTP_ENABLED=true`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`
   - `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`
   - `SMTP_AUTO_SEND_APPROVED=true` to auto-send after graph approval
4. Frontend API base:
   - `VITE_API_BASE_URL` (defaults to `http://127.0.0.1:8000`)

## Install

### Backend

```powershell
pip install -r requirements.txt
```

### Frontend

```powershell
cd frontend
npm install
```

## Run

### Option A: One command (Windows PowerShell)

From repo root:

```powershell
./run-dev.ps1
```

This opens:
- backend on `http://localhost:8000`
- frontend on `http://localhost:5173`

### Option B: Manual terminals

Terminal 1 (repo root):

```powershell
uvicorn backend.app.main:app --reload
```

Terminal 2:

```powershell
cd frontend
npm run dev
```

## API Overview

- `GET /` — health
- `POST /jobs`, `GET /jobs`
- `POST /candidates` (manual candidate)
- `POST /candidates/upload_pdfs` (single/multi PDF upload)
- `GET /candidates`, `GET /candidates/{candidate_id}`
- `POST /agent/graph/run`
- `POST /agent/graph/resume`
- `POST /agent/batch/topk_outreach`
- `POST /outreach/send` (send drafted outreach via SMTP)
- `GET /audit`
- `GET /health/openrouter`

## Typical Flow

1. Create a job.
2. Upload candidate PDFs (or create candidates manually).
3. Wait for candidates to reach `Ready` stage.
4. Run graph or batch top-k.
5. Approve/reject if graph is waiting for approval.
6. Send outreach:
   - manually via UI button / `POST /outreach/send`
   - or automatically if `SMTP_AUTO_SEND_APPROVED=true`.

## Notes

- Runtime data is stored under the root `data` directory.
- `.env`, `data`, uploads, and build artifacts are gitignored.
- OCR fallback requires local OCR tooling (Tesseract + pdf2image dependencies).
