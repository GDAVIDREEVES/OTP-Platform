"""Cost Sharing Arrangement (CSA) — RAB share + PCT (OTP-5) and in-period
true-up (OTP-11).

Read-only. The whole CSA model is computed at runtime from the same
``segment_pl`` source that ``routers/pnl.py`` ``/api/segments/pl`` reads, so the
figures cannot drift from OTP-20/21/dashboard — reconciliation by construction.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from db import q

router = APIRouter()

# --- Config constants (locked in the design spec) ----------------------------
PARTICIPANTS = ["1000", "3100", "3800"]  # 1000 US, 3100 CH, 3800 NL
GROWTH = 0.08  # RAB benefit projection: projected_sales = revenue * (1 + g)
PCT_MULT = 3  # platform_value = PCT_MULT * pool

_DIM = Path(__file__).parent.parent / "dim" / "entity_dim.json"


@lru_cache(maxsize=1)
def _names() -> dict[str, str]:
    entities = json.loads(_DIM.read_text(encoding="utf-8"))["entities"]
    return {e["rbukrs"]: e["display_name"] for e in entities}


@router.get("/api/csa")
def csa(year: int = 2026) -> dict[str, Any]:
    """CSA RAB shares, PCT buy-ins, and true-ups for the participants in ``year``.

    Aggregates ``segment_pl`` (revenue, opex_rd) by RBUKRS — the exact source
    behind ``/api/segments/pl`` — so every figure reconciles with the rest of
    the demo. Returns zeros/empty gracefully if the year has no data.
    """
    names = _names()
    ph = ",".join("?" for _ in PARTICIPANTS)
    rows = q(
        f"SELECT RBUKRS, SUM(revenue) AS revenue, SUM(opex_rd) AS opex_rd "
        f"FROM segment_pl WHERE GJAHR = ? AND RBUKRS IN ({ph}) "
        f"GROUP BY RBUKRS",
        [year, *PARTICIPANTS],
    )
    by_id = {str(r["RBUKRS"]): r for r in rows}

    parts = []
    for rbukrs in PARTICIPANTS:
        r = by_id.get(rbukrs)
        revenue = float(r["revenue"]) if r and r["revenue"] is not None else 0.0
        opex_rd = float(r["opex_rd"]) if r and r["opex_rd"] is not None else 0.0
        parts.append(
            {
                "rbukrs": rbukrs,
                "name": names.get(rbukrs, rbukrs),
                "revenue": revenue,
                "opex_rd": opex_rd,
                "projected_sales": revenue * (1 + GROWTH),
            }
        )

    total_projected = sum(p["projected_sales"] for p in parts)
    pool = sum(p["opex_rd"] for p in parts)
    platform_value = PCT_MULT * pool

    if total_projected == 0:
        # No data for the year — return a graceful empty/zero model.
        return {
            "year": year,
            "pool": 0.0,
            "platform_value": 0.0,
            "growth": GROWTH,
            "pct_mult": PCT_MULT,
            "totals": {"revenue": 0.0, "opex_rd": 0.0, "true_up": 0.0},
            "participants": [
                {
                    "rbukrs": p["rbukrs"],
                    "name": p["name"],
                    "revenue": round(p["revenue"], 2),
                    "projected_sales": round(p["projected_sales"], 2),
                    "rab_share": 0.0,
                    "opex_rd": round(p["opex_rd"], 2),
                    "target_contribution": 0.0,
                    "true_up": 0.0,
                    "pct_buyin": 0.0,
                }
                for p in parts
            ],
        }

    participants = []
    for p in parts:
        rab_share = p["projected_sales"] / total_projected  # full precision
        target = rab_share * pool
        true_up = target - p["opex_rd"]
        pct_buyin = rab_share * platform_value
        participants.append(
            {
                "rbukrs": p["rbukrs"],
                "name": p["name"],
                "revenue": round(p["revenue"], 2),
                "projected_sales": round(p["projected_sales"], 2),
                "rab_share": rab_share,
                "opex_rd": round(p["opex_rd"], 2),
                "target_contribution": round(target, 2),
                "true_up": round(true_up, 2),
                "pct_buyin": round(pct_buyin, 2),
            }
        )

    return {
        "year": year,
        "pool": round(pool, 2),
        "platform_value": round(platform_value, 2),
        "growth": GROWTH,
        "pct_mult": PCT_MULT,
        "totals": {
            "revenue": round(sum(p["revenue"] for p in parts), 2),
            "opex_rd": round(pool, 2),
            "true_up": round(sum(pp["true_up"] for pp in participants), 2),
        },
        "participants": participants,
    }
