"""Distinct fiscal years present in the data — drives the FY dropdown."""

from __future__ import annotations

from fastapi import APIRouter

from db import q

router = APIRouter()


@router.get("/api/years")
def list_years():
    rows = q(
        f"""
        SELECT DISTINCT GJAHR AS y FROM segment_pl
        UNION
        SELECT DISTINCT GJAHR FROM journal
        UNION
        SELECT DISTINCT GJAHR FROM supply_chain
        ORDER BY y DESC
        """
    )
    return [int(r["y"]) for r in rows if r["y"] is not None]
