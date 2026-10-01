"""
OTP Platform backend — FastAPI service over DuckDB + parquet.

App bootstrap only. Routes live under `routers/`, business logic under
`services/`, persistence under `persistence/`, and config under `config.py`.

Run:  uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from config import CORS_ORIGINS, DATA_DIR, FRONTEND_DIST, HOST, PORT
from db import close_db, db
from state import migrate
from routers import (
    adjustments,
    allocation,
    audit,
    authored_datasets,
    authored_pools,
    beat,
    berry,
    calc_graph,
    calcs,
    cases,
    catalog,
    close,
    csa,
    dataset,
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
    authored_pools.router,
    authored_datasets.router,
    drafts.router,
    review.router,
    lineage.router,
    calc_graph.router,
    calcs.router,
    cases.router,
    catalog.router,
    close.router,
    scenarios.router,
    csa.router,
    dataset.router,
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


# ---- Single-process mode: serve the built React app from the API port. ----
# `npm run build` writes dist/; when it exists, any non-/api path falls through
# to the SPA (index.html) so deep links like /process/OTP-16 work on a cold
# load. Without dist/ the API runs alone and Vite (:5173) proxies to it.
if (FRONTEND_DIST / "index.html").is_file():
    if (FRONTEND_DIST / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = (FRONTEND_DIST / full_path).resolve() if full_path else None
        if candidate and candidate.is_file() and FRONTEND_DIST.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
