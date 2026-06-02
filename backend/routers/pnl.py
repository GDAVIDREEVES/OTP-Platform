"""Segment P&L — SegmentedPnL + DetailedPnL pages."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Query

from db import q

router = APIRouter()


@router.get("/api/segments/pl")
def segment_pl(
    entity: Optional[str] = None,
    period: Optional[str] = Query(None, description="POPER like '012'"),
    year: Optional[int] = None,
):
    where_parts = []
    params: list[Any] = []
    if entity:
        where_parts.append("RBUKRS = ?"); params.append(entity)
    if period:
        where_parts.append("POPER = ?"); params.append(period)
    if year:
        where_parts.append("GJAHR = ?"); params.append(year)
    where = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    sql = f"""
      SELECT RBUKRS, ROLE_CODE, SEGMENT, GJAHR, POPER,
             revenue, other_income, cogs,
             opex_production, opex_rd, opex_sm, opex_ga, opex_dist,
             ic_charges, depreciation,
             operating_profit, operating_margin
      FROM segment_pl
      {where}
      ORDER BY RBUKRS, GJAHR, POPER
    """
    rows = q(sql, params)
    return [
        {
            **r,
            **{
                k: (float(v) if v is not None else None)
                for k, v in r.items()
                if k in ("revenue", "other_income", "cogs", "opex_production",
                         "opex_rd", "opex_sm", "opex_ga", "opex_dist",
                         "ic_charges", "depreciation",
                         "operating_profit", "operating_margin")
            },
        }
        for r in rows
    ]
