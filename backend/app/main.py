import warnings
# langchain-core's deprecation shim imports pydantic.v1 which triggers a
# UserWarning on Python 3.14+. The underlying code still works; suppress
# the warning until langchain-core fully drops the pydantic.v1 compat layer.
warnings.filterwarnings(
    "ignore",
    message="Core Pydantic V1 functionality",
    category=UserWarning,
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .settings import settings
from .db import create_db_and_tables
from .storage import ensure_upload_dir
from .graph_runtime import init_graph

from .routes.jobs import router as jobs_router
from .routes.candidates import router as candidates_router
from .routes.applications import router as applications_router
from .routes.agent_graph import router as agent_graph_router
from .routes.audit import router as audit_router
from .routes.health import router as health_router
from .routes.batch import router as batch_router
from .routes.outreach import router as outreach_router
from .routes.settings import router as settings_router
from .routes.search import router as search_router
from .routes.chat import router as chat_router

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
app.include_router(applications_router)
app.include_router(agent_graph_router)
app.include_router(audit_router)
app.include_router(health_router)
app.include_router(batch_router)
app.include_router(outreach_router)
app.include_router(settings_router)
app.include_router(search_router)
app.include_router(chat_router)


@app.get("/")
def health():
    return {"status": "ok"}