"""Allocation engine API (M6) — run launcher + run/charge/recon/exception/
doc-pack reads + the charge -> cost-line lineage drill.

Thin router over ``services/allocation_runner.py`` (orchestrator) and
``state/allocation_store.py`` (ledgers, runs, artifacts). Route order: the
literal ``/api/allocation/runs`` is registered before
``/api/allocation/runs/{run_id}`` so list/detail never collide.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

import services.allocation_runner as runner
import state.allocation_store as store
from schemas.allocation import AllocationRunIn

router = APIRouter()


def _run_or_404(run_id: str) -> dict:
    run = store.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"unknown run: {run_id}")
    return run


def _artifact_json(run_id: str, name: str) -> dict:
    art = store.get_artifact(run_id, name)
    if art is None:
        raise HTTPException(status_code=404,
                            detail=f"run {run_id} has no artifact {name!r}")
    return json.loads(art["content"])


@router.post("/api/allocation/runs")
def launch_run(payload: AllocationRunIn):
    """Launch a budget | actual | trueup run (SPEC §6). A failed run is a
    domain outcome, not an HTTP error: the run record (status ``failed``) and
    its exception report come back with 200."""
    period = payload.period or payload.year
    if not period:
        raise HTTPException(status_code=400,
                            detail="period (YYYY-MM) or year (YYYY) required")
    try:
        return runner.run_allocation(
            period=period, run_type=payload.run_type, actor=payload.actor,
            scope=payload.scope, config=payload.config)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/allocation/runs")
def list_runs(period: str | None = None, status: str | None = None):
    """Every recorded run (SPEC §3.2 run table), each with its persisted
    summary artifact when the run succeeded."""
    out = []
    for run in store.list_runs(period=period, status=status):
        summary = store.get_artifact(run["run_id"], "summary.json")
        out.append({**run,
                    "summary": json.loads(summary["content"]) if summary else None})
    return out


@router.get("/api/allocation/runs/{run_id}")
def get_run(run_id: str):
    run = _run_or_404(run_id)
    summary = store.get_artifact(run_id, "summary.json")
    return {
        **run,
        "summary": json.loads(summary["content"]) if summary else None,
        "artifacts": store.list_artifacts(run_id),
    }


@router.get("/api/allocation/runs/{run_id}/charges")
def run_charges(run_id: str):
    _run_or_404(run_id)
    return store.list_charges(run_id=run_id)


@router.get("/api/allocation/runs/{run_id}/recon")
def run_recon(run_id: str):
    _run_or_404(run_id)
    return store.list_recon(run_id=run_id)


@router.get("/api/allocation/runs/{run_id}/exceptions")
def run_exceptions(run_id: str):
    """The SPEC §8.4 exception report: every fired V-rule with severity,
    affected objects and suggested remediation."""
    _run_or_404(run_id)
    return _artifact_json(run_id, "exceptions.json")


@router.get("/api/allocation/runs/{run_id}/docs")
def run_docs(run_id: str):
    """Index of the run's documentation pack (SPEC §8.3 — one Markdown
    document per pool per period)."""
    _run_or_404(run_id)
    return [a for a in store.list_artifacts(run_id)
            if a["name"].startswith("docs/")]


@router.get("/api/allocation/runs/{run_id}/docs/{pool_id}")
def run_doc(run_id: str, pool_id: str):
    _run_or_404(run_id)
    art = store.get_artifact(run_id, f"docs/{pool_id}.md")
    if art is None:
        raise HTTPException(status_code=404,
                            detail=f"run {run_id} has no doc pack for {pool_id}")
    return {"run_id": run_id, "pool_id": pool_id, "markdown": art["content"]}


@router.get("/api/allocation/charges/{charge_id}/lineage")
def charge_lineage(charge_id: str):
    """Drill a ledger charge to its constituent cost lines (SPEC §8 audit
    lineage; the run's persisted lineage index). True-up rows drill to their
    parent Budget charge instead of cost lines."""
    charge = store.get_charge(charge_id)
    if charge is None:
        raise HTTPException(status_code=404,
                            detail=f"unknown charge: {charge_id}")
    run_id = charge.get("run_id")
    lineage = _artifact_json(run_id, "lineage.json") if run_id else {"charges": {}, "lines": {}}
    entry = lineage["charges"].get(charge_id) or {}
    line_ids = list(entry.get("line_ids") or ())
    return {
        "charge": charge,
        "pool_id": entry.get("pool_id", charge.get("pool_id")),
        "charge_kind": entry.get("charge_kind"),
        "key_value_id": entry.get("key_value_id"),
        "true_up_parent_charge_id": entry.get("true_up_parent_charge_id")
        or charge.get("true_up_parent_charge_id"),
        "line_ids": line_ids,
        "lines": [lineage["lines"][lid] for lid in line_ids
                  if lid in lineage["lines"]],
    }
