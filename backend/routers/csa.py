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

# --- Profit-split (OTP-44 design / OTP-12 calc & invoicing) -------------------
# The three non-routine parties that share residual profit under the PSM:
# 1000 US IP, 3100 CH IP, 3000 DE Manufacturer. Both the participant set and the
# allocation key are configurable (see DATA DECISION in the plan doc).
PS_PARTICIPANTS = ["1000", "3100", "3000"]  # US IP / CH IP / DE Manufacturer
PS_DEFAULT_KEY = "opex_rd"  # R&D value-driver; alt 'sga' = opex_sm + opex_ga
PS_KEYS = ("opex_rd", "sga")

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


@router.get("/api/profit-split")
def profit_split(year: int = 2026, key: str = PS_DEFAULT_KEY) -> dict[str, Any]:
    """Residual profit-split across the non-routine parties for ``year``.

    Combined profit = Σ ``segment_pl`` operating_profit of ``PS_PARTICIPANTS``.
    The residual is allocated by a selectable value-driver ``key``:

    * ``opex_rd`` (default) — R&D spend.
    * ``sga``               — selling + admin (opex_sm + opex_ga).

    ``share_i = key_i / Σ key`` and ``allocated_i = share_i * combined_profit``.
    Per participant we return its own operating_profit, the key value, the
    residual share, the allocated profit and the ``true_up`` (allocated − own).
    Every figure aggregates the same ``segment_pl`` source as ``/api/csa`` and
    ``/api/segments/pl`` — reconciliation by construction. Returns a graceful
    zero model when the year/key has no spend.
    """
    if key not in PS_KEYS:
        key = PS_DEFAULT_KEY
    names = _names()
    ph = ",".join("?" for _ in PS_PARTICIPANTS)
    rows = q(
        f"SELECT RBUKRS, "
        f"SUM(operating_profit) AS operating_profit, "
        f"SUM(opex_rd) AS opex_rd, SUM(opex_sm) AS opex_sm, SUM(opex_ga) AS opex_ga "
        f"FROM segment_pl WHERE GJAHR = ? AND RBUKRS IN ({ph}) "
        f"GROUP BY RBUKRS",
        [year, *PS_PARTICIPANTS],
    )
    by_id = {str(r["RBUKRS"]): r for r in rows}

    def _f(r: Any, col: str) -> float:
        return float(r[col]) if r and r[col] is not None else 0.0

    parts = []
    for rbukrs in PS_PARTICIPANTS:
        r = by_id.get(rbukrs)
        operating_profit = _f(r, "operating_profit")
        opex_rd = _f(r, "opex_rd")
        sga = _f(r, "opex_sm") + _f(r, "opex_ga")
        parts.append(
            {
                "rbukrs": rbukrs,
                "name": names.get(rbukrs, rbukrs),
                "operating_profit": operating_profit,
                "opex_rd": opex_rd,
                "sga": sga,
                "key_value": opex_rd if key == "opex_rd" else sga,
            }
        )

    combined_profit = sum(p["operating_profit"] for p in parts)
    key_total = sum(p["key_value"] for p in parts)

    participants = []
    for p in parts:
        share = (p["key_value"] / key_total) if key_total else 0.0  # full precision
        allocated = share * combined_profit
        participants.append(
            {
                "rbukrs": p["rbukrs"],
                "name": p["name"],
                "operating_profit": round(p["operating_profit"], 2),
                "opex_rd": round(p["opex_rd"], 2),
                "sga": round(p["sga"], 2),
                "key_value": round(p["key_value"], 2),
                "residual_share": share,
                "allocated_profit": round(allocated, 2),
                "true_up": round(allocated - p["operating_profit"], 2),
            }
        )

    return {
        "year": year,
        "key": key,
        "default_key": PS_DEFAULT_KEY,
        "keys": list(PS_KEYS),
        "combined_profit": round(combined_profit, 2),
        "key_total": round(key_total, 2),
        "totals": {
            "operating_profit": round(combined_profit, 2),
            "allocated_profit": round(sum(pp["allocated_profit"] for pp in participants), 2),
            "true_up": round(sum(pp["true_up"] for pp in participants), 2),
        },
        "participants": participants,
    }
