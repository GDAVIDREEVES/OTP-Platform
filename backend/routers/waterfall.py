"""Waterfall API (Phase 5 W1) — run launcher + run reads + rollback, and the
adjusted P&L read.

Thin router over ``services/waterfall_runner.py`` (orchestrator) and
``state/pl_overlays.py`` (overlay ledger + run table). ``/api/pl/adjusted``
returns the BASE ``segment_pl`` aggregate (the exact source behind
``/api/segments/pl``) side by side with the applied overlay lines and the
post-charge totals — with per-line provenance (step, source_ref, waterfall
run). With no waterfall applied the post-charge columns equal base, so
nothing changes anywhere until a run is launched.

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
from calc import warehouse
from schemas.waterfall import WaterfallRollbackIn, WaterfallRunIn

router = APIRouter()

ZERO = Decimal("0")

#: The segment_pl measure columns — same list /api/segments/pl serves.
MEASURES = ["revenue", "other_income", "cogs", "opex_production", "opex_rd",
            "opex_sm", "opex_ga", "opex_dist", "ic_charges", "depreciation",
            "operating_profit"]

GRAINS = ("entity", "entity_function")


# ------------------------------------------------------------------- runs --


@router.post("/api/waterfall/runs")
def launch_run(payload: WaterfallRunIn):
    """Launch a waterfall run. A failed run is a domain outcome, not an HTTP
    error: the run record (status 'failed', nothing applied) comes back with
    200. Unknown/duplicate steps are a 400."""
    try:
        return runner.run_waterfall(
            actor=payload.actor, year=payload.year, steps=payload.steps)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/waterfall/runs")
def list_runs(status: str | None = None):
    return pl_overlays.list_runs(status=status)


@router.get("/api/waterfall/runs/{run_id}")
def get_run(run_id: str):
    run = pl_overlays.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"unknown run: {run_id}")
    return {**run, "lines": pl_overlays.list_lines(waterfall_run_id=run_id)}


@router.post("/api/waterfall/runs/{run_id}/rollback")
def rollback_run(run_id: str, payload: WaterfallRollbackIn):
    """Roll an applied run back: one reversing overlay row per line (the
    ledger stays append-only), status -> 'rolled_back'."""
    if pl_overlays.get_run(run_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown run: {run_id}")
    try:
        return runner.rollback(run_id, actor=payload.actor)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


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
