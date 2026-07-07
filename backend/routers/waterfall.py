"""Waterfall API (Phase 5 W1; GP4 governance loop) — run requests + run reads,
and the adjusted P&L read.

Thin router over ``services/waterfall_runner.py`` (orchestrator),
``state/waterfall_requests.py`` (the maker-checker gate) and
``state/pl_overlays.py`` (overlay ledger + run table).

GP4: the waterfall rewrites the group segmented P&L, so it does NOT execute on
an HTTP call. ``POST /api/waterfall/requests`` submits a run/rollback REQUEST
that enqueues one maker-checker item at record_ref="waterfall:{id}"; the P&L is
untouched until a DIFFERENT reviewer approves it in the /review queue, at which
point state/review.py:decide() calls the orchestrator (execute-on-approve, the
same pattern as scenario promotion). There is deliberately no immediate-apply
endpoint — the only path to the group P&L is through review.

``/api/pl/adjusted`` returns the BASE ``segment_pl`` aggregate (the exact source
behind ``/api/segments/pl``) side by side with the applied overlay lines and the
post-charge totals — with per-line provenance (step, source_ref, waterfall
run). With no waterfall applied the post-charge columns equal base, so
nothing changes anywhere until a run is applied.

All overlay arithmetic is Decimal; amounts cross the JSON boundary as exact
decimal strings (overlay/by-kind totals and line amounts) while base /
post-charge measures are floats like every other P&L endpoint (segment_pl is
DECIMAL(23,2) — 2-dp values round-trip exactly through float at these
magnitudes).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException

import services.waterfall_runner as runner
import state.pl_overlays as pl_overlays
import state.waterfall_requests as waterfall_requests
from calc import warehouse
from schemas.waterfall import WaterfallRequestIn

router = APIRouter()

ZERO = Decimal("0")

#: The segment_pl measure columns — same list /api/segments/pl serves.
MEASURES = ["revenue", "other_income", "cogs", "opex_production", "opex_rd",
            "opex_sm", "opex_ga", "opex_dist", "ic_charges", "depreciation",
            "operating_profit"]

GRAINS = ("entity", "entity_function")


# ------------------------------------------------------- run requests (GP4) --


@router.post("/api/waterfall/requests")
def create_request(payload: WaterfallRequestIn):
    """Submit a run/rollback REQUEST for maker-checker review — the ONLY way to
    touch the group P&L. Nothing executes here: the request enqueues one review
    item at waterfall:{id}; approval by a DIFFERENT reviewer runs it. Malformed
    requests (unknown/duplicate steps, unknown/non-applied rollback target) are
    rejected up front (400/404) so a doomed request never reaches the queue."""
    action = payload.action
    if action not in ("run", "rollback"):
        raise HTTPException(status_code=400,
                            detail="action must be 'run' or 'rollback'")
    if action == "run":
        steps = payload.steps
        if steps is not None:
            unknown = [s for s in steps if s not in runner.KNOWN_STEPS]
            if unknown:
                raise HTTPException(
                    status_code=400,
                    detail=f"unknown waterfall steps: {unknown}; "
                           f"known: {sorted(runner.KNOWN_STEPS)}")
            if len(set(steps)) != len(steps):
                raise HTTPException(status_code=400,
                                    detail=f"duplicate waterfall steps: {steps}")
    else:  # rollback
        if not payload.target_run_id:
            raise HTTPException(status_code=400,
                                detail="a rollback request requires target_run_id")
        target = pl_overlays.get_run(payload.target_run_id)
        if target is None:
            raise HTTPException(status_code=404,
                                detail=f"unknown run: {payload.target_run_id}")
        if target["status"] != "applied":
            raise HTTPException(
                status_code=400,
                detail=f"only an applied run can be rolled back; "
                       f"{payload.target_run_id} is {target['status']}")
    try:
        return waterfall_requests.create_request(
            action=action, year=payload.year, requested_by=payload.actor,
            target_run_id=payload.target_run_id, steps=payload.steps,
            rationale=payload.rationale)
    except ValueError as e:
        # Belt-and-suspenders: the store re-validates too — surface any drift
        # between the two layers as a 400, never a 500 (matching how the removed
        # immediate-launch endpoint wrapped runner errors).
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/waterfall/requests")
def list_requests(status: str | None = None):
    """Waterfall run/rollback requests, newest first (optionally by status —
    'pending' surfaces what is awaiting approval)."""
    return waterfall_requests.list_requests(status=status)


# ------------------------------------------------------------------- runs --


@router.get("/api/waterfall/runs")
def list_runs(status: str | None = None):
    return pl_overlays.list_runs(status=status)


@router.get("/api/waterfall/runs/{run_id}")
def get_run(run_id: str):
    run = pl_overlays.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"unknown run: {run_id}")
    return {**run, "lines": pl_overlays.list_lines(waterfall_run_id=run_id)}


# ------------------------------------------------------------ adjusted P&L --


def _dec(value: Any) -> Decimal:
    return Decimal(str(value)) if value is not None else ZERO


def _margin(op: Decimal, revenue: Decimal) -> float | None:
    return float(op / revenue) if revenue != ZERO else None


@router.get("/api/pl/adjusted")
def pl_adjusted(year: int = 2026, grain: str = "entity") -> dict[str, Any]:
    """Base segment_pl aggregate + applied overlay lines + post-charge totals.

    ``grain`` is ``entity`` (RBUKRS) or ``entity_function`` (RBUKRS +
    ROLE_CODE). Reversing rows are negative amounts on the same ledger, so a
    rolled-back/superseded run nets to zero out of the same SUM — the rows
    always reflect exactly the currently applied waterfall.
    """
    if grain not in GRAINS:
        raise HTTPException(status_code=400,
                            detail=f"grain must be one of {GRAINS}")
    group = ["RBUKRS"] if grain == "entity" else ["RBUKRS", "ROLE_CODE"]
    base_rows = warehouse.aggregate("segment_pl", group, MEASURES, year=year)
    lines = pl_overlays.list_lines(year=year)

    def line_key(line: dict[str, Any]) -> tuple:
        if grain == "entity":
            return (line["entity"],)
        return (line["entity"], line["function"])

    # Aggregate the overlay (Decimal) per grain key, per side and per kind.
    agg: dict[tuple, dict[str, Any]] = {}
    lines_by_key: dict[tuple, list[dict[str, Any]]] = {}
    for line in lines:
        key = line_key(line)
        amount = Decimal(line["amount"])  # reversing rows are negative
        slot = agg.setdefault(key, {"revenue": ZERO, "cost": ZERO, "by_kind": {}})
        slot[line["side"]] += amount
        kind = slot["by_kind"].setdefault(
            line["line_kind"], {"revenue": ZERO, "cost": ZERO})
        kind[line["side"]] += amount
        lines_by_key.setdefault(key, []).append(line)

    rows: list[dict[str, Any]] = []
    total_rev = total_cost = ZERO
    seen: set[tuple] = set()
    for r in sorted(base_rows, key=lambda r: tuple(str(r[c]) for c in group)):
        key = tuple(str(r[c]) for c in group)
        seen.add(key)
        base = {m: _dec(r[m]) for m in MEASURES}
        overlay = agg.get(key, {"revenue": ZERO, "cost": ZERO, "by_kind": {}})
        rev, cost = overlay["revenue"], overlay["cost"]
        net = rev - cost
        post_op = base["operating_profit"] + net
        post_rev = base["revenue"] + rev
        total_rev += rev
        total_cost += cost
        rows.append({
            "entity": key[0],
            "function": key[1] if grain == "entity_function" else None,
            "base": {
                **{m: float(base[m]) for m in MEASURES},
                "operating_margin": _margin(base["operating_profit"],
                                            base["revenue"]),
            },
            "overlay": {
                "revenue": str(rev),
                "cost": str(cost),
                "net": str(net),
                "by_kind": {
                    k: {"revenue": str(v["revenue"]), "cost": str(v["cost"]),
                        "net": str(v["revenue"] - v["cost"])}
                    for k, v in sorted(overlay["by_kind"].items())
                },
            },
            "post_charge": {
                "revenue": float(post_rev),
                "ic_cost": float(cost),
                "operating_profit": float(post_op),
                "operating_margin": _margin(post_op, post_rev),
            },
            "lines": lines_by_key.get(key, []),
        })

    # An overlay line whose key has no base row would otherwise vanish from
    # the response — never lose applied money silently.
    orphans = sorted(set(agg) - seen)
    if orphans:
        raise HTTPException(
            status_code=500,
            detail=f"overlay lines reference unknown {grain} keys: {orphans}")

    applied = pl_overlays.list_runs(status="applied")
    return {
        "year": year,
        "grain": grain,
        "applied_run_id": applied[-1]["id"] if applied else None,
        "rows": rows,
        "totals": {
            "overlay_revenue": str(total_rev),
            "overlay_cost": str(total_cost),
            "overlay_net": str(total_rev - total_cost),
        },
    }
