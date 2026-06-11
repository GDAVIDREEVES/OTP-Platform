"""What-if scenario API (Calc Studio CS-c).

Thin router over ``state/scenarios.py`` (CRUD + promotion lifecycle) and
``services/calc_registry.py`` (the compare endpoint runs the SAME registered
handler twice — once against the governed store, once under the scenario's
parameter overlay — and diffs every matching numeric path). Route order
matters: the literal ``/api/scenarios`` routes are registered before
``/api/scenarios/{scenario_id}``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

import services.calc_registry as calc_registry
import state.scenarios as scenarios
from schemas.scenarios import (
    ScenarioCompareIn,
    ScenarioDiscardIn,
    ScenarioIn,
    ScenarioPatch,
    ScenarioPromoteIn,
)

router = APIRouter()


def _http_error(e: ValueError) -> HTTPException:
    return HTTPException(status_code=404 if "unknown" in str(e) else 409, detail=str(e))


def _delta(base: Any, scenario: Any) -> Any:
    """Recursive numeric diff (scenario − base) over matching paths.

    Numbers (bool excluded) diff to ``scenario - base`` — zeros are kept so an
    all-zero delta is visibly "nothing moved". Dicts recurse over shared keys,
    equal-length lists pairwise; everything non-numeric prunes to ``None``.
    """
    if isinstance(base, bool) or isinstance(scenario, bool):
        return None
    if isinstance(base, (int, float)) and isinstance(scenario, (int, float)):
        return scenario - base
    if isinstance(base, dict) and isinstance(scenario, dict):
        out = {}
        for k in base:
            if k in scenario:
                d = _delta(base[k], scenario[k])
                if d is not None:
                    out[k] = d
        return out or None
    if isinstance(base, list) and isinstance(scenario, list) and len(base) == len(scenario):
        diffs = [_delta(b, s) for b, s in zip(base, scenario)]
        return diffs if any(d is not None for d in diffs) else None
    return None


@router.get("/api/scenarios")
def list_scenarios(status: str | None = None):
    return scenarios.list_scenarios(status=status)


@router.post("/api/scenarios")
def create_scenario(payload: ScenarioIn):
    try:
        return scenarios.create_scenario(
            name=payload.name, description=payload.description,
            overrides=payload.overrides, actor=payload.actor,
        )
    except ValueError as e:
        raise _http_error(e)


@router.get("/api/scenarios/{scenario_id}")
def get_scenario(scenario_id: str):
    sc = scenarios.get_scenario(scenario_id)
    if sc is None:
        raise HTTPException(status_code=404, detail=f"unknown scenario: {scenario_id}")
    return sc


@router.patch("/api/scenarios/{scenario_id}")
def update_scenario(scenario_id: str, payload: ScenarioPatch):
    try:
        return scenarios.update_scenario(
            scenario_id, actor=payload.actor, name=payload.name,
            description=payload.description, overrides=payload.overrides,
        )
    except ValueError as e:
        raise _http_error(e)


@router.delete("/api/scenarios/{scenario_id}")
def delete_scenario(scenario_id: str, actor: str):
    """DELETE == discard (scenarios are never physically removed — the audit
    chain at scenario:{id} must keep resolving)."""
    try:
        return scenarios.discard(scenario_id, actor)
    except ValueError as e:
        raise _http_error(e)


@router.post("/api/scenarios/{scenario_id}/compare")
def compare(scenario_id: str, payload: ScenarioCompareIn):
    """Run ``calc_id`` twice — base (governed store) and scenario (overlay) —
    and return both outputs plus the recursive numeric delta. Both runs persist
    to calc_runs and hash-chain "run" events at calc:{calc_id} as usual."""
    sc = scenarios.get_scenario(scenario_id)
    if sc is None:
        raise HTTPException(status_code=404, detail=f"unknown scenario: {scenario_id}")
    if not calc_registry.exists(payload.calc_id):
        raise HTTPException(status_code=404, detail=f"unknown calculation: {payload.calc_id}")

    try:
        base = calc_registry.run(payload.calc_id, actor=payload.actor, args=payload.args)
        scen = calc_registry.run(
            payload.calc_id, actor=payload.actor, args=payload.args,
            scenario_id=scenario_id, scenario_overrides=sc["overrides"],
        )
    except ValueError as e:
        # e.g. a user calculation that is not active yet (W3).
        raise HTTPException(status_code=409, detail=str(e))
    return {
        "base": base["output"],
        "scenario": scen["output"],
        "delta": _delta(base["output"], scen["output"]),
        "scenario_sensitive": scen["scenario_sensitive"],
        "base_run_id": base["id"],
        "scenario_run_id": scen["id"],
    }


@router.post("/api/scenarios/{scenario_id}/promote")
def promote(scenario_id: str, payload: ScenarioPromoteIn):
    """Submit for promotion: status -> in_review + one pending maker-checker
    item at scenario:{id}. The actual parameter writes happen only when a
    DIFFERENT reviewer approves the item in the /review queue."""
    try:
        return scenarios.submit_for_review(scenario_id, payload.maker)
    except ValueError as e:
        raise _http_error(e)


@router.post("/api/scenarios/{scenario_id}/discard")
def discard(scenario_id: str, payload: ScenarioDiscardIn):
    try:
        return scenarios.discard(scenario_id, payload.actor)
    except ValueError as e:
        raise _http_error(e)
