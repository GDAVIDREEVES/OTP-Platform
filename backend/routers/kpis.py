"""KPI summary — drives Dashboard top cards."""

from __future__ import annotations

from fastapi import APIRouter

from config import SUPPLY_CHAIN
from db import q
from period_filter import PeriodFilter
from services.entities import list_entities

router = APIRouter()


@router.get("/api/kpis")
def kpis(
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    entities = list_entities(pf)
    total_volume = sum(e["ytdVolume"] for e in entities)
    in_range = sum(1 for e in entities if e["status"] == "in-range")
    watch = sum(1 for e in entities if e["status"] == "watch")
    out_of_range = sum(1 for e in entities if e["status"] == "out-of-range")
    open_adj = sum(1 for e in entities if e["status"] == "out-of-range")

    pf_clause, pf_params = pf.where()
    apa_chains = q(
        f"""
        SELECT COUNT(DISTINCT CHAIN_ID) AS n
        FROM read_parquet('{SUPPLY_CHAIN}')
        WHERE APA_FLAG = TRUE {pf_clause}
        """,
        pf_params,
    )[0]["n"]
    challenged_chains = q(
        f"""
        SELECT COUNT(DISTINCT CHAIN_ID) AS n
        FROM read_parquet('{SUPPLY_CHAIN}')
        WHERE CHALLENGED_FLAG = TRUE {pf_clause}
        """,
        pf_params,
    )[0]["n"]

    return {
        "totalICVolume": total_volume,
        "entityCount": len(entities),
        "entitiesInRange": in_range,
        "entitiesWatch": watch,
        "entitiesOutOfRange": out_of_range,
        "openAdjustments": open_adj,
        "flowsUnderAPA": int(apa_chains or 0),
        "flowsChallenged": int(challenged_chains or 0),
    }
