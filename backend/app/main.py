from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .settings import settings
from .db import create_db_and_tables
from .storage import ensure_upload_dir
from .graph_runtime import init_graph

from .routes.jobs import router as jobs_router
from .routes.candidates import router as candidates_router
from .routes.agent_graph import router as agent_graph_router
from .routes.audit import router as audit_router
from .routes.health import router as health_router
from .routes.batch import router as batch_router
from .routes.outreach import router as outreach_router

app = FastAPI(title="Agentic Recruiter (PDF CV Ingestion + LangGraph + FastAPI)")


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    ensure_upload_dir()
    create_db_and_tables()

    graph, conn = init_graph()
    app.state.recruiter_graph = graph
    app.state.checkpoint_conn = conn


@app.on_event("shutdown")
def on_shutdown():
    conn = getattr(app.state, "checkpoint_conn", None)
    if conn:
        try:
            conn.close()
        except Exception:
            pass


app.include_router(jobs_router)
app.include_router(candidates_router)
app.include_router(agent_graph_router)
app.include_router(audit_router)
app.include_router(health_router)
app.include_router(batch_router)
app.include_router(outreach_router)


@app.get("/")
def health():
    return {"status": "ok"}