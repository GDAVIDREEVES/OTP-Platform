"""
OTP Platform backend — FastAPI service over DuckDB + parquet.

App bootstrap only. Routes live under `routers/`, business logic under
`services/`, persistence under `persistence/`, and config under `config.py`.

Run:  uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import CORS_ORIGINS, DATA_DIR, HOST, PORT
from db import close_db, db
from state import migrate
from routers import (
    adjustments,
    audit,
    berry,
    drafts,
    entities,
    evidence,
    health,
    invoices,
    journal_entries,
    kpis,
    margins,
    overrides,
    pnl,
    processes,
    reference,
    research_brain,
    review,
    settings,
    transactions,
    years,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db().execute("SELECT 1").fetchone()
    if not (DATA_DIR / "entity_roles").is_dir():
        raise RuntimeError(f"DATA_DIR not found or missing entity_roles/: {DATA_DIR}")
    migrate.run()  # apply SQLite schema + import any legacy JSON store
    yield
    close_db()


app = FastAPI(title="OTP Platform API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (
    health.router,
    entities.router,
    kpis.router,
    margins.router,
    transactions.router,
    invoices.router,
    pnl.router,
    processes.router,
    adjustments.router,
    overrides.router,
    settings.router,
    berry.router,
    journal_entries.router,
    years.router,
    audit.router,
    drafts.router,
    review.router,
    evidence.router,
    research_brain.router,
    reference.router,
):
    app.include_router(r)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
