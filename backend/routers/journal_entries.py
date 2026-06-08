"""ACDOCA journal entries — drill-down for Adjustment / EntityDetail."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Query

from db import q

router = APIRouter()


@router.get("/api/journal-entries")
def journal_entries(
    entity: Optional[str] = None,
    period: Optional[str] = None,
    year: Optional[int] = None,
    awref: Optional[str] = None,
    limit: int = Query(200, ge=1, le=2000),
):
    where_parts = []
    params: list[Any] = []
    if entity:
        where_parts.append("RBUKRS = ?"); params.append(entity)
    if period:
        where_parts.append("POPER = ?"); params.append(period)
    if year:
        where_parts.append("GJAHR = ?"); params.append(year)
    if awref:
        where_parts.append("AWREF = ?"); params.append(awref)
    where = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    sql = f"""
      SELECT RBUKRS, GJAHR, POPER, BUDAT, BLART, BELNR, DOCLN,
             RACCT, RASSC, MATNR, WERKS, AWREF,
             HSL, RHCUR,
             SGTXT
      FROM journal
      {where}
      ORDER BY BUDAT DESC, BELNR DESC, DOCLN
      LIMIT {limit}
    """
    rows = q(sql, params)
    out = []
    for r in rows:
        r["BUDAT"] = r["BUDAT"].isoformat() if r["BUDAT"] else None
        if r["HSL"] is not None:
            r["HSL"] = float(r["HSL"])
        out.append(r)
    return out
