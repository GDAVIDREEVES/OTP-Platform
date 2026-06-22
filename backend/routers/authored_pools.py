"""Allocation Pool Builder API (Phase 6 PB2).

Thin router over ``state/authored_pools.py`` (draft -> tested -> in_review ->
active lifecycle) and ``services/allocation_runner.py`` (the engine integration:
preview the capture rule, dry-run the pool through Stages 1-7 in isolation,
launch an authored allocation run). Authored pools are governed EXPERIMENTS —
they overlay the engine and NEVER touch the governed seeded allocation.

Route order: the literal ``/api/allocation/pools/validate``,
``.../preview`` and ``/api/allocation/dimensions`` routes register before the
parameterised ``/api/allocation/pools/{pool_id}`` routes so they never collide.
``validate``, ``preview`` and ``dimensions`` are pure reads — nothing persists,
nothing is audited — so the Builder can syntax-check / live-preview on every
keystroke. Activation happens in the /review queue (a DIFFERENT checker
approves the ``allocpool:{id}`` item; see state/review.py:decide()).
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, HTTPException

import services.allocation_runner as runner
import state.authored_pools as authored_pools
from schemas.authored_pools import (
    ActorIn,
    AuthoredPoolIn,
    AuthoredPoolPatch,
    CaptureRuleIn,
    MakerIn,
    RunAuthoredIn,
    StageGraphIn,
)

router = APIRouter()


def _http_error(e: ValueError) -> HTTPException:
    msg = str(e)
    if msg.startswith("unknown authored pool"):
        return HTTPException(status_code=404, detail=msg)
    if (msg.startswith("invalid authored pool")
            or msg.startswith("invalid stage graph")
            or msg.startswith("supply exactly one")):
        return HTTPException(status_code=400, detail=msg)
    return HTTPException(status_code=409, detail=msg)


# ------------------------------------------------------------- dimensions --


@router.get("/api/allocation/dimensions")
def dimensions(source: str = "actual"):
    """Distinct cost_centers / profit_centers / cost_elements across the
    allocation cost lines, each with its TOTAL cost — the UI pickers for the
    cost-capture rule builder. Decimal-exact totals (strings)."""
    dataset = runner.load_demo_dataset()
    lines = dataset["cost_lines"].get(source) or dataset["cost_lines"]["actual"]

    def totals(key: str) -> list[dict]:
        agg: dict[str, Decimal] = {}
        for line in lines:
            val = line.get(key)
            if val is None:
                continue
            agg[val] = agg.get(val, Decimal("0")) + Decimal(line["amount_local"])
        return [{"value": k, "total_cost": str(agg[k])} for k in sorted(agg)]

    return {
        "source": source,
        "cost_centers": totals("cost_center"),
        "profit_centers": totals("profit_center"),
        "cost_elements": totals("cost_element"),
    }


# --------------------------------------------------------------- pure reads --


@router.get("/api/allocation/pools")
def list_pools(status: str | None = None):
    return authored_pools.list_authored_pools(status=status)


@router.post("/api/allocation/pools/validate")
def validate_pool(payload: AuthoredPoolIn):
    """Structural validation report ``{ok, errors:[...]}`` — nothing persists."""
    errors = authored_pools.validate_definition(payload.definition)
    return {"ok": not errors, "errors": errors}


@router.post("/api/allocation/pools/preview")
def preview_capture(payload: CaptureRuleIn):
    """Evaluate a cost-capture rule over the cost lines -> captured amount /
    line count / by-entity (no persist). The Builder's live preview card."""
    rule = {
        "cost_centers": payload.cost_centers,
        "profit_centers": payload.profit_centers,
        "cost_elements": payload.cost_elements,
        "split_pct": payload.split_pct,
    }
    try:
        return runner.preview_capture_rule(rule, source=payload.source)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/allocation/pools/preview-graph")
def preview_stage_graph(payload: StageGraphIn):
    """Compile an allocation STAGE GRAPH (Phase 7 MC3) to an authored-pool
    definition and dry-run it through the REAL Stages 1-7 in isolation, returning
    PER-STAGE results (captured cost, exclusions, allocated recipients, markup,
    charges, recon zero-residual) keyed on the stage node id — what the cockpit
    paints onto each stage node + dock. Nothing persists. A structurally-invalid
    graph returns ``ok:false`` + the stage-order errors (no silent default)."""
    try:
        return runner.stage_graph_dry_run(payload.graph, source=payload.source)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------------------------------------------------ writes --


@router.post("/api/allocation/pools")
def create_pool(payload: AuthoredPoolIn):
    """Create a draft authored pool from EITHER a ``definition`` OR a canvas stage
    ``graph`` (the graph compiles to the same definition — one PB2 path)."""
    try:
        return authored_pools.create_authored_pool(
            definition=payload.definition, graph_json=payload.graph,
            actor=payload.actor, process_id=payload.process_id,
        )
    except ValueError as e:
        raise _http_error(e)


@router.get("/api/allocation/pools/{pool_id}")
def get_pool(pool_id: str):
    p = authored_pools.get_authored_pool(pool_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"unknown authored pool: {pool_id}")
    return p


@router.get("/api/allocation/pools/{pool_id}/graph")
def get_pool_graph(pool_id: str):
    """The canvas stage graph for an authored pool (MC3) — its stored graph_json
    when authored on the canvas. 404 if the pool is unknown; ``null`` when it was
    hand-authored (no canonical stage layout — the definition stays the SoT)."""
    if authored_pools.get_authored_pool(pool_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown authored pool: {pool_id}")
    return authored_pools.get_authored_pool_graph(pool_id)


@router.patch("/api/allocation/pools/{pool_id}")
def update_pool(pool_id: str, payload: AuthoredPoolPatch):
    try:
        return authored_pools.update_authored_pool(
            pool_id, actor=payload.actor, definition=payload.definition,
            graph_json=payload.graph, process_id=payload.process_id,
        )
    except ValueError as e:
        raise _http_error(e)


@router.delete("/api/allocation/pools/{pool_id}")
def delete_pool(pool_id: str, payload: ActorIn):
    try:
        return authored_pools.delete_authored_pool(pool_id, actor=payload.actor)
    except ValueError as e:
        raise _http_error(e)


@router.post("/api/allocation/pools/{pool_id}/test")
def test_pool(pool_id: str, payload: ActorIn):
    """Dry-run the pool through Stages 1-7 in isolation (no persist). On a sound
    result (recon Balanced, no BLOCK) it is marked ``tested`` — the gate
    submit-activation requires. Returns the dry-run charges/recon/exceptions/
    trace either way."""
    try:
        return authored_pools.test_run(pool_id, actor=payload.actor)
    except ValueError as e:
        raise _http_error(e)


@router.post("/api/allocation/pools/{pool_id}/submit-activation")
def submit_activation(pool_id: str, payload: MakerIn):
    """Submit for activation: status -> in_review + one pending maker-checker
    item at allocpool:{id}. The pool activates only when a DIFFERENT reviewer
    approves the item in the /review queue."""
    try:
        return authored_pools.submit_for_activation(pool_id, maker=payload.maker)
    except ValueError as e:
        raise _http_error(e)


# --------------------------------------------------------- authored runs --


@router.post("/api/allocation/authored-runs")
def launch_authored_run(payload: RunAuthoredIn):
    """Launch an authored allocation run for ``period`` — overlays every ACTIVE
    authored pool whose capture rule touches the period through the REAL Stages
    1-7 in isolation, persisted + flagged ``authored`` (config.authored = True),
    audited at allocation:{run_id}. The governed seeded allocation is untouched.
    A failed run is a domain outcome (200, status ``failed`` + exception report).
    """
    try:
        return runner.run_authored_allocation(period=payload.period, actor=payload.actor,
                                              source=payload.source)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
