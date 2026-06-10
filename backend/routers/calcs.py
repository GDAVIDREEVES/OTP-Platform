"""Calculation registry + run console API (Calc Studio CS-a).

Thin router over ``services/calc_registry.py`` (definitions + runner) and
``state/calc_runs.py`` (run history). Route order matters: the literal
``/api/calcs`` routes are registered before ``/api/calcs/{calc_id}``, and
``/api/runs`` before ``/api/runs/{run_id}``.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

import services.calc_registry as calc_registry
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


@router.get("/api/runs")
def list_runs(
    calc_id: str | None = None,
    scenario_id: str | None = None,
    status: str | None = None,
):
    return calc_runs.list_runs(calc_id=calc_id, scenario_id=scenario_id, status=status)


@router.get("/api/runs/{run_id}")
def get_run(run_id: int):
    run = calc_runs.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"unknown run: {run_id}")
    return run


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
    if calc_registry.get_def(calc_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown calculation: {calc_id}")
    try:
        return calc_registry.run(
            calc_id,
            actor=payload.actor,
            args=payload.args,
            scenario_id=payload.scenario_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/calcs/{calc_id}/runs")
def list_calc_runs(calc_id: str):
    if calc_registry.get_def(calc_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown calculation: {calc_id}")
    return calc_runs.list_runs(calc_id=calc_id)
