"""Margin trend — Dashboard chart + EntityDetail trend."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Query

from db import q
from period_filter import PeriodFilter

router = APIRouter()


@router.get("/api/margins/trend")
def margin_trend(
    entities: Optional[str] = Query(None, description="Comma-separated RBUKRS list"),
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    """Returns wide-format rows usable directly by Recharts."""
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

    sql = f"""
      SELECT RBUKRS, GJAHR, POPER, operating_margin
      FROM segment_pl
      {where} {pf_clause}
      ORDER BY RBUKRS, GJAHR, POPER
    """
    rows = q(sql, params + pf_params)
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    pivot: dict[str, dict[str, Any]] = {m: {"month": m} for m in months}
    for r in rows:
        idx = int(r["POPER"]) - 1
        if 0 <= idx < 12:
            pivot[months[idx]][r["RBUKRS"]] = round(float(r["operating_margin"]) * 100, 2)
    return list(pivot.values())
