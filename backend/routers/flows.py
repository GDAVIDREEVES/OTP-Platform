"""Intercompany transaction flows for the dashboard map — actual IC value by
entity pair, aggregated from the ACDOCA journal (RASSC = affiliated counterparty)."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from db import q
from period_filter import PeriodFilter

router = APIRouter()
_DIM = Path(__file__).parent.parent / "dim" / "entity_dim.json"


@lru_cache(maxsize=1)
def _entity_ids() -> list[str]:
    return [e["rbukrs"] for e in json.loads(_DIM.read_text(encoding="utf-8"))["entities"]]


@router.get("/api/flows/intercompany")
def intercompany_flows(year: int | None = None, periodFrom: str | None = None, periodTo: str | None = None):
    """Undirected entity-pair IC value: [{from_rbukrs, to_rbukrs, amount}], desc by amount."""
    ids = _entity_ids()
    if not ids:
        return []
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    ph = ",".join("?" for _ in ids)
    try:
        rows = q(
            f"SELECT RBUKRS, RASSC, SUM(HSL) AS amount FROM journal "
            f"WHERE RASSC IS NOT NULL AND RASSC <> RBUKRS "
            f"AND RASSC IN ({ph}) AND RBUKRS IN ({ph}) {pf_clause} "
            f"GROUP BY RBUKRS, RASSC",
            list(ids) + list(ids) + pf_params,
        )
    except Exception:
        return []
    agg: dict[frozenset, float] = {}
    for r in rows:
        pair = frozenset((str(r["RBUKRS"]), str(r["RASSC"])))
        agg[pair] = agg.get(pair, 0.0) + abs(float(r["amount"] or 0))
    out: list[dict[str, Any]] = []
    for pair, amount in agg.items():
        a, b = sorted(list(pair))
        out.append({"from_rbukrs": a, "to_rbukrs": b, "amount": round(amount, 2)})
    out.sort(key=lambda f: f["amount"], reverse=True)
    return out
