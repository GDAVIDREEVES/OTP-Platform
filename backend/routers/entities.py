"""Entity routes — drive Dashboard, Policy, SegmentedPnL, PriceSetting, WorldMap."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from constants import MATERIAL_LABELS
from db import q
from period_filter import PeriodFilter
from services.entities import list_entities as _list_entities
from services.labels import pretty_method

router = APIRouter()


@router.get("/api/entities")
def list_entities(
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    return _list_entities(pf)


@router.get("/api/entities/{entity_id}")
def get_entity(
    entity_id: str,
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    rows = _list_entities(pf, entity_id=entity_id)
    if not rows:
        raise HTTPException(status_code=404, detail=f"Entity {entity_id} not found")
    return rows[0]


@router.get("/api/entities/{entity_id}/flows")
def entity_flows(
    entity_id: str,
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    """Supply-chain flows the entity participates in, grouped by material type and direction."""
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    sql = f"""
      WITH base AS (
        SELECT
          CASE WHEN SELLING_COMPANY = ? THEN 'sell'
               WHEN BUYING_COMPANY  = ? THEN 'buy' END AS direction,
          MATERIAL_TYPE,
          TP_METHOD,
          CASE WHEN SELLING_COMPANY = ? THEN BUYING_COMPANY
               ELSE SELLING_COMPANY END AS counterparty,
          TOTAL_LEGAL_PRICE,
          APA_FLAG,
          CHALLENGED_FLAG,
          CHAIN_ID
        FROM supply_chain
        WHERE (SELLING_COMPANY = ? OR BUYING_COMPANY = ?) {pf_clause}
      )
      SELECT
        direction,
        MATERIAL_TYPE,
        TP_METHOD,
        SUM(TOTAL_LEGAL_PRICE) AS ytd_volume,
        COUNT(*) AS step_count,
        COUNT(DISTINCT CHAIN_ID) AS chains,
        BOOL_OR(APA_FLAG) AS any_apa,
        BOOL_OR(CHALLENGED_FLAG) AS any_challenged,
        LIST(DISTINCT counterparty) AS counterparties
      FROM base
      GROUP BY 1, 2, 3
      ORDER BY direction, ytd_volume DESC
    """
    rows: list[dict[str, Any]] = q(
        sql, [entity_id, entity_id, entity_id, entity_id, entity_id, *pf_params]
    )
    return [
        {
            "direction": r["direction"],
            "materialType": r["MATERIAL_TYPE"],
            "materialLabel": MATERIAL_LABELS.get(r["MATERIAL_TYPE"], r["MATERIAL_TYPE"]),
            "tpMethod": pretty_method(r["TP_METHOD"]),
            "ytdVolume": float(r["ytd_volume"] or 0),
            "stepCount": r["step_count"],
            "chains": r["chains"],
            "apa": bool(r["any_apa"]),
            "challenged": bool(r["any_challenged"]),
            "counterparties": r["counterparties"],
        }
        for r in rows
    ]
