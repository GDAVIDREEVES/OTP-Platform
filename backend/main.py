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
    allocation,
    audit,
    beat,
    berry,
    calcs,
    cases,
    catalog,
    csa,
    documentation,
    drafts,
    entities,
    evidence,
    flows,
    forecast,
    health,
    invoices,
    journal_entries,
    kpis,
    lineage,
    margins,
    master_data,
    overrides,
    parameters,
    pnl,
    processes,
    reconciliation,
    reference,
    research_brain,
    review,
    scenarios,
    settings,
    stewardship,
    transactions,
    treasury,
    user_calcs,
    vat,
    waterfall,
    wht,
    worklist,
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
    flows.router,
    forecast.router,
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
    allocation.router,
    drafts.router,
    review.router,
    lineage.router,
    calcs.router,
    cases.router,
    catalog.router,
    scenarios.router,
    csa.router,
    parameters.router,
    evidence.router,
    reconciliation.router,
    research_brain.router,
    reference.router,
    master_data.router,
    documentation.router,
    treasury.router,
    vat.router,
    wht.router,
    beat.router,
    stewardship.router,
    user_calcs.router,
    waterfall.router,
    worklist.router,
):
    app.include_router(r)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
