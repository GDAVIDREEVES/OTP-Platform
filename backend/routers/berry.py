"""Berry ratio — drives ProductPricing chart."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Query

from db import q
from period_filter import PeriodFilter

router = APIRouter()


@router.get("/api/berry")
def berry_trend(
    entity: Optional[str] = Query(None, description="RBUKRS to filter (default: aggregate of LRDs)"),
    target: float = Query(1.20, description="Target Berry ratio for the band line"),
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    """
    Monthly Berry ratio = Gross Profit / Operating Expenses (S,G&A only).

    For an LRD context the denominator-of-sales naturally includes IC charges,
    so we compute:
        gp   = revenue - cogs - opex_production - ic_charges
        opex = opex_rd + opex_sm + opex_ga + opex_dist     (S,G,&A only)
        berry = gp / opex
    """
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    where = ""
    params: list[Any] = []
    if entity:
        where = "WHERE RBUKRS = ?"
        params.append(entity)
    else:
        # Default: aggregate the three LRDs in the dataset
        where = "WHERE RBUKRS IN ('3200', '3300', '3800')"

    sql = f"""
      SELECT GJAHR,
             POPER,
             SUM(revenue)         AS revenue,
             SUM(cogs)            AS cogs,
             SUM(ic_charges)      AS ic_charges,
             SUM(COALESCE(opex_production,0)) AS opex_production,
             SUM(COALESCE(opex_rd,0)
               + COALESCE(opex_sm,0)
               + COALESCE(opex_ga,0)
               + COALESCE(opex_dist,0)) AS opex_sga
      FROM segment_pl
      {where} {pf_clause}
      GROUP BY 1, 2
      ORDER BY 1, 2
    """
    rows = q(sql, params + pf_params)
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    out = []
    for r in rows:
        revenue = float(r["revenue"] or 0)
        cogs = float(r["cogs"] or 0)
        ic = float(r["ic_charges"] or 0)
        prod = float(r["opex_production"] or 0)
        opex = float(r["opex_sga"] or 0)
        gp = revenue - cogs - prod - ic
        berry = (gp / opex) if opex > 0 else None
        idx = int(r["POPER"]) - 1 if r["POPER"] else 0
        out.append({
            "year": int(r["GJAHR"]),
            "period": r["POPER"],
            "month": months[idx] if 0 <= idx < 12 else r["POPER"],
            "revenue": round(revenue, 2),
            "gp": round(gp, 2),
            "opex": round(opex, 2),
            "berry": round(berry, 3) if berry is not None else None,
            "target": target,
        })
    return out
