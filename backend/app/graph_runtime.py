import os
import sqlite3
from typing import Tuple, Any

from langgraph.checkpoint.sqlite import SqliteSaver  # provided by langgraph-checkpoint-sqlite :contentReference[oaicite:5]{index=5}

from .settings import settings
from .recruiter_graph import build_recruiter_graph


def init_graph() -> Tuple[Any, sqlite3.Connection]:
    os.makedirs("./data", exist_ok=True)

    # Durable checkpoints on disk
    # Docs show disk usage via SqliteSaver + sqlite connection strings / files. :contentReference[oaicite:6]{index=6}
    conn = sqlite3.connect(settings.CHECKPOINT_DB_PATH, check_same_thread=False)
    checkpointer = SqliteSaver(conn)

    builder = build_recruiter_graph()
    graph = builder.compile(checkpointer=checkpointer)
    return graph, conn