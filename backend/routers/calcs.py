"""Calculation registry + run console API (Calc Studio CS-a/CS-d).

Thin router over ``services/calc_registry.py`` (definitions + runner + graph),
``services/calc_traces.py`` (shaped traces) and ``state/calc_runs.py`` (run
history). Route order matters: the literal ``/api/calcs`` and
``/api/calcs/graph`` routes are registered before ``/api/calcs/{calc_id}``
(so "graph" is never captured as a calc id), and ``/api/runs`` before
``/api/runs/{run_id}``.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

import services.calc_registry as calc_registry
import services.calc_traces as calc_traces
import services.catalog as catalog
import state.calc_runs as calc_runs
import state.parameters as parameters
from schemas.calcs import RunIn

router = APIRouter()


@router.get("/api/calcs")
def list_calcs():
    """Every registered calculation, each with its most recent run (or null)."""
    out = []
    for d in calc_registry.defs():
        runs = calc_runs.list_runs(calc_id=d["id"], limit=1)
        out.append({**d, "last_run": runs[0] if runs else None})
    return out


@router.get("/api/calcs/graph")
def calcs_graph():
    """The dependency DAG — sources | parameters | calculations | processes —
    assembled from the registry seed (CS-d Lineage tab)."""
    return calc_registry.graph()


@router.get("/api/runs")
def list_runs(
    calc_id: str | None = None,
    scenario_id: str | None = None,
    status: str | None = None,
):
    return calc_runs.list_runs(calc_id=calc_id, scenario_id=scenario_id, status=status)


@router.get("/api/runs/{run_id}")
def get_run(run_id: int, shaped: bool = False):
    """One run by id. ``?shaped=true`` attaches ``shaped_trace`` — the curated
    explain-steps shaped from the persisted summary/params_read/trace (the
    output body is never stored, so historical runs shape retroactively)."""
    run = calc_runs.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"unknown run: {run_id}")
    if not shaped:
        return run
    d = calc_registry.get_def(run["calc_id"])
    return {**run, "shaped_trace": calc_traces.shape_trace(run, d) if d else []}


@router.get("/api/calcs/{calc_id}")
def get_calc(calc_id: str):
    """One calculation definition with its inputs resolved: each catalog id is
    attached as its full catalog entry, each parameter key as its governed
    parameter row (value/default/provenance), plus the latest run."""
    d = calc_registry.get_def(calc_id)
    if d is None:
        raise HTTPException(status_code=404, detail=f"unknown calculation: {calc_id}")
    runs = calc_runs.list_runs(calc_id=calc_id, limit=1)
    return {
        **d,
        "resolved_inputs": {
            "catalog": [
                catalog.entry(cid) or {"id": cid}
                for cid in d["inputs"]["catalog"]
            ],
            "parameters": [
                parameters.get_param_row(key) or {"key": key}
                for key in d["inputs"]["parameters"]
            ],
        },
        "last_run": runs[0] if runs else None,
    }


@router.post("/api/calcs/{calc_id}/run")
def run_calc(calc_id: str, payload: RunIn):
    d = calc_registry.get_def(calc_id)
    if d is None:
        raise HTTPException(status_code=404, detail=f"unknown calculation: {calc_id}")
    try:
        res = calc_registry.run(
            calc_id,
            actor=payload.actor,
            args=payload.args,
            scenario_id=payload.scenario_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # A fresh run shapes with the full output body — the richest trace
    # (per-participant figures); persisted runs shape from summary/trace alone.
    return {**res, "shaped_trace": calc_traces.shape_trace(res, d, output=res["output"])}


@router.get("/api/calcs/{calc_id}/runs")
def list_calc_runs(calc_id: str):
    if calc_registry.get_def(calc_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown calculation: {calc_id}")
    return calc_runs.list_runs(calc_id=calc_id)
