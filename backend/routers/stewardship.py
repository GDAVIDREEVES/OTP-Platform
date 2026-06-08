"""Stewardship cost identification & exclusion (OTP-15).

A shareholder/stewardship review of the parent (1000/3100) cost base. The
**cost base is REAL** — the parents' G&A (``opex_ga``) aggregated from the same
``segment_pl`` source behind ``/api/segments/pl`` and ``/api/csa``, so it cannot
drift from the rest of the demo. The **candidate cost lines are FABRICATED**
governance records (board, investor relations, group audit, parent legal, M&A —
see ``seeds/finance/stewardship.v1.json``); there is no such register in the
warehouse.

The endpoint screens each candidate line: lines flagged ``stewardship`` are
shareholder costs that should be **excluded** from the chargeable cost base
(OECD TPG 7.9-7.10). It returns the excluded total and the adjusted cost base
(``base - excluded``). Returns a graceful zero/empty model for a year with no
``segment_pl`` data.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from db import q
from state import seeds

router = APIRouter()

# The parent entities whose G&A forms the reviewed cost base.
PARENTS = ["1000", "3100"]
# segment_pl column treated as the parent cost base (general & administrative).
BASE_COL = "opex_ga"

_DIM = Path(__file__).parent.parent / "dim" / "entity_dim.json"


@lru_cache(maxsize=1)
def _names() -> dict[str, str]:
    entities = json.loads(_DIM.read_text(encoding="utf-8"))["entities"]
    return {e["rbukrs"]: e["display_name"] for e in entities}


def _cost_base(year: int) -> dict[str, float]:
    """Parent G&A cost base per RBUKRS, aggregated from segment_pl (REAL)."""
    ph = ",".join("?" for _ in PARENTS)
    rows = q(
        f"SELECT RBUKRS, SUM({BASE_COL}) AS base "
        f"FROM segment_pl WHERE GJAHR = ? AND RBUKRS IN ({ph}) "
        f"GROUP BY RBUKRS",
        [year, *PARENTS],
    )
    by_id = {str(r["RBUKRS"]): r for r in rows}
    return {
        p: (float(by_id[p]["base"]) if p in by_id and by_id[p]["base"] is not None else 0.0)
        for p in PARENTS
    }


@router.get("/api/stewardship")
def stewardship(year: int = 2026) -> dict[str, Any]:
    """Stewardship/shareholder cost review for ``year``.

    Cost base = Σ parent ``opex_ga`` from ``segment_pl`` (REAL). Candidate cost
    lines come from the fabricated register; those flagged ``stewardship`` are
    excluded from the chargeable base. Returns the excluded total and the
    adjusted cost base (``cost_base - excluded``).
    """
    names = _names()
    base_by_id = _cost_base(year)
    cost_base = sum(base_by_id.values())

    doc = seeds.load("stewardship")
    lines = [
        {
            "id": ln["id"],
            "rbukrs": ln["rbukrs"],
            "name": names.get(ln["rbukrs"], ln["rbukrs"]),
            "category": ln["category"],
            "description": ln["description"],
            "amount": float(ln["amount"]),
            "currency": ln.get("currency", "USD"),
            "stewardship": bool(ln.get("stewardship", False)),
            "rationale": ln.get("rationale", ""),
        }
        for ln in doc.get("lines", [])
    ]

    excluded = sum(ln["amount"] for ln in lines if ln["stewardship"])
    candidate_total = sum(ln["amount"] for ln in lines)
    adjusted_cost_base = cost_base - excluded

    return {
        "year": year,
        "base_col": BASE_COL,
        "parents": [
            {"rbukrs": p, "name": names.get(p, p), "cost_base": round(base_by_id[p], 2)}
            for p in PARENTS
        ],
        "cost_base": round(cost_base, 2),
        "candidate_total": round(candidate_total, 2),
        "excluded": round(excluded, 2),
        "adjusted_cost_base": round(adjusted_cost_base, 2),
        "lines": lines,
    }
