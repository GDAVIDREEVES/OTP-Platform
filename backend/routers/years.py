"""Distinct fiscal years present in the data — drives the FY dropdown."""

from __future__ import annotations

from fastapi import APIRouter

from config import JOURNAL, SEGMENT_PL, SUPPLY_CHAIN
from db import q

router = APIRouter()


@router.get("/api/years")
def list_years():
    rows = q(
        f"""
        SELECT DISTINCT GJAHR AS y FROM read_parquet('{SEGMENT_PL}')
        UNION
        SELECT DISTINCT GJAHR FROM read_parquet('{JOURNAL}')
        UNION
        SELECT DISTINCT GJAHR FROM read_parquet('{SUPPLY_CHAIN}')
        ORDER BY y DESC
        """
    )
    return [int(r["y"]) for r in rows if r["y"] is not None]
