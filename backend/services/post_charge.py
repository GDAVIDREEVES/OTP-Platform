"""Post-charge P&L basis resolution (Phase 5 W2 — Author & Apply).

The TP waterfall (services/waterfall_runner.py) applies intercompany charges
to the append-only ``pl_overlays`` ledger. This module lets the
margin-bearing read endpoints behind OTP-20 / OTP-16 / OTP-1
(``/api/margins/trend``, ``/api/kpis``, ``/api/forecast``) resolve their
P&L basis:

- ``resolve_mode(pl)`` — an explicit ``?pl=base|post_charge`` wins; when the
  query param is omitted the basis comes from the governed parameter
  ``pl.use_post_charge`` (seeded ``false``; edits are hash-chained at
  param:pl.use_post_charge like every governed driver). An unknown value
  raises — no silent default.
- ``entity_adjustments`` / ``monthly_adjustments`` — the per-entity (or
  per-entity-month) Decimal overlay deltas of the CURRENTLY APPLIED waterfall
  run. Both return ``{}`` whenever no run is applied, so even with the toggle
  on every endpoint stays on its untouched base code path (byte-identical)
  until a waterfall is actually applied — "default base until a run exists".

Conventions (documented, never silent):
- Reversing rows are negative amounts on the same ledger, so summing ALL
  lines yields exactly the applied overlay (rolled-back / superseded runs net
  to zero) — the same aggregation /api/pl/adjusted uses.
- Annual overlay lines (period == "YYYY": royalties, CSA true-up, profit
  split) accrue STRAIGHT-LINE 1/12 per fiscal month in monthly views and
  pro-rata ``n/12`` over an ``n``-month window. The ledger itself stays
  exact; the spread is a display-basis convention for sub-year reads (a
  full-year window reproduces the exact annual amount: amount * 12 / 12).
- All arithmetic is Decimal — no float math on overlay amounts.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import state.parameters as parameters
import state.pl_overlays as pl_overlays

ZERO = Decimal("0")
TWELVE = Decimal("12")

PARAM_KEY = "pl.use_post_charge"
MODES = ("base", "post_charge")


def resolve_mode(pl: str | None) -> str:
    """Resolve the requested P&L basis for a read endpoint.

    Explicit ``?pl=`` wins; ``None`` falls back to the governed
    ``pl.use_post_charge`` parameter (default ``False`` == base — equal to
    the pre-W2 behavior, so an unseeded store can never flip a response).
    Raises ``ValueError`` on an unknown value.
    """
    if pl is None:
        return "post_charge" if parameters.get_param(PARAM_KEY, False) else "base"
    if pl not in MODES:
        raise ValueError(f"pl must be one of {MODES}, got {pl!r}")
    return pl


def applied_run_id() -> str | None:
    """The currently applied waterfall run id (at most one), or ``None``."""
    runs = pl_overlays.list_runs(status="applied")
    return runs[-1]["id"] if runs else None


def parse_month(poper: str | None) -> int | None:
    """A POPER query string ("001".."012") as a month int; raises on garbage."""
    if poper is None:
        return None
    month = int(poper)
    if not 1 <= month <= 12:
        raise ValueError(f"period out of range: {poper!r}")
    return month


def _line_month(period: str) -> int | None:
    """Month of a monthly overlay period ("2026-04" -> 4); None for annual."""
    return int(period.split("-")[1]) if "-" in period else None


def entity_adjustments(
    year: int | None = None,
    month_from: int | None = None,
    month_to: int | None = None,
) -> dict[str, dict[str, Decimal]]:
    """Per-entity overlay deltas over a (year, month-window) read.

    Returns ``{entity: {"revenue": D, "cost": D, "net": D}}`` — empty when no
    waterfall run is applied (callers then keep their base code path) and
    entities whose lines fully net out are dropped for the same reason.
    Monthly lines count when their month falls inside the window; annual
    lines accrue ``n/12`` for an ``n``-month window (full window == exact).
    """
    if applied_run_id() is None:
        return {}
    months = [
        m for m in range(1, 13)
        if (month_from is None or m >= month_from)
        and (month_to is None or m <= month_to)
    ]
    out: dict[str, dict[str, Decimal]] = {}
    for line in pl_overlays.list_lines(year=year):
        amount = Decimal(line["amount"])  # reversing rows are negative
        month = _line_month(line["period"])
        if month is not None:
            if month not in months:
                continue
            share = amount
        elif len(months) == 12:
            share = amount
        else:
            share = amount * Decimal(len(months)) / TWELVE
        slot = out.setdefault(line["entity"], {"revenue": ZERO, "cost": ZERO})
        slot[line["side"]] += share
    for slot in out.values():
        slot["net"] = slot["revenue"] - slot["cost"]
    return {
        e: v for e, v in out.items() if v["revenue"] != ZERO or v["cost"] != ZERO
    }


def monthly_adjustments() -> dict[tuple[str, int, int], dict[str, Decimal]]:
    """Per (entity, year, month) overlay deltas for monthly margin views.

    Monthly lines land on their own month; annual lines accrue straight-line
    1/12 on every fiscal month of their year. Returns ``{}`` when no
    waterfall run is applied. Values: ``{"revenue": D, "net": D}`` (net =
    revenue side − cost side — the operating-profit delta).
    """
    if applied_run_id() is None:
        return {}
    agg: dict[tuple[str, int, int], dict[str, Decimal]] = {}

    def add(key: tuple[str, int, int], side: str, share: Decimal) -> None:
        slot = agg.setdefault(key, {"revenue": ZERO, "cost": ZERO})
        slot[side] += share

    for line in pl_overlays.list_lines():
        amount = Decimal(line["amount"])
        month = _line_month(line["period"])
        if month is not None:
            year = int(line["period"].split("-")[0])
            add((line["entity"], year, month), line["side"], amount)
        else:
            year = int(line["period"])
            share = amount / TWELVE
            for m in range(1, 13):
                add((line["entity"], year, m), line["side"], share)

    out: dict[tuple[str, int, int], dict[str, Any]] = {}
    for key, slot in agg.items():
        if slot["revenue"] == ZERO and slot["cost"] == ZERO:
            continue
        out[key] = {"revenue": slot["revenue"],
                    "net": slot["revenue"] - slot["cost"]}
    return out
