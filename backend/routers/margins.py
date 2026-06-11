"""Margin trend — Dashboard chart + EntityDetail trend.

Phase 5 W2: the endpoint accepts ``?pl=base|post_charge`` (omitted = the
governed ``pl.use_post_charge`` parameter via services/post_charge.py). On
the base path the code below is UNTOUCHED — byte-identical responses,
golden-gated in tests/test_post_charge.py. On the post-charge path each
month's margin recomputes as (operating_profit + overlay net) / (revenue +
overlay revenue) from the applied waterfall's overlay ledger; with no run
applied the adjustments are empty and the base path runs regardless.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

import services.post_charge as post_charge
from db import q
from period_filter import PeriodFilter

router = APIRouter()


@router.get("/api/margins/trend")
def margin_trend(
    entities: Optional[str] = Query(None, description="Comma-separated RBUKRS list"),
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
    # P&L basis: base | post_charge; omitted = the governed param. Plain None
    # default so the handler stays directly callable (registry pattern).
    pl: str | None = None,
):
    """Returns wide-format rows usable directly by Recharts."""
    try:
        mode = post_charge.resolve_mode(pl)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    where_parts = []
    params: list[Any] = []
    if entities:
        ids = [e.strip() for e in entities.split(",") if e.strip()]
        if ids:
            placeholders = ",".join("?" for _ in ids)
            where_parts.append(f"RBUKRS IN ({placeholders})")
            params.extend(ids)
    where = ("WHERE " + " AND ".join(where_parts)) if where_parts else "WHERE 1=1"

    adj = post_charge.monthly_adjustments() if mode == "post_charge" else {}
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    pivot: dict[str, dict[str, Any]] = {m: {"month": m} for m in months}

    if adj:
        # Post-charge: same rows + the measures needed to recompute margins.
        sql = f"""
          SELECT RBUKRS, GJAHR, POPER, revenue, operating_profit, operating_margin
          FROM segment_pl
          {where} {pf_clause}
          ORDER BY RBUKRS, GJAHR, POPER
        """
        for r in q(sql, params + pf_params):
            idx = int(r["POPER"]) - 1
            if not 0 <= idx < 12:
                continue
            key = (str(r["RBUKRS"]), int(r["GJAHR"]), int(r["POPER"]))
            a = adj.get(key)
            if a is None:
                # untouched cell — identical rounding to the base path
                pivot[months[idx]][r["RBUKRS"]] = round(
                    float(r["operating_margin"]) * 100, 2)
                continue
            rev = Decimal(str(r["revenue"])) + a["revenue"]
            op = Decimal(str(r["operating_profit"])) + a["net"]
            if rev == 0:
                continue  # a margin is undefined on zero revenue — omit the cell
            pivot[months[idx]][r["RBUKRS"]] = round(float(op / rev) * 100, 2)
        return list(pivot.values())

    sql = f"""
      SELECT RBUKRS, GJAHR, POPER, operating_margin
      FROM segment_pl
      {where} {pf_clause}
      ORDER BY RBUKRS, GJAHR, POPER
    """
    rows = q(sql, params + pf_params)
    for r in rows:
        idx = int(r["POPER"]) - 1
        if 0 <= idx < 12:
            pivot[months[idx]][r["RBUKRS"]] = round(float(r["operating_margin"]) * 100, 2)
    return list(pivot.values())
