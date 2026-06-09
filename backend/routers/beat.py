"""BEAT base-erosion prep (OTP-36) and Form 5471/8858/8975 inputs (OTP-38).

Read-only. The US payer's related-party deductible base is REAL: it is the sum
of ``journal`` HSL on the US company code (RBUKRS 1000) for lines posted against
an affiliate trading partner (RASSC), aggregated by G/L account (RACCT). That
base cannot drift from the warehouse — it is recomputed from ``journal`` on every
request, the same source behind ``/api/journal-entries`` and the reconciliation.

The one FABRICATED element is the ``RACCT -> payment-type`` classification
(``_RACCT_TYPE`` below): generic SAP cost-of-sales account codes are mapped, by
their account nature, to ``cogs`` / ``services`` / ``royalties`` / ``interest`` /
``other``. This drives the §59A base-erosion split — COGS is excluded from
base-eroding payments, so the mapping is what determines the base-erosion %. See
the plan doc (docs/superpowers/plans/) DATA DECISION for the full rationale.

OTP-38 adds the per-CFC Schedule M rollup (the US payer's RASSC postings broken
out by affiliate counterparty, with each counterparty's segment_pl foreign P&L)
for the Form 5471/8858 inputs; Form 8975 (CbCR) is served from the ``cbcr`` seed
on the frontend, exactly as OTP-34 does.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter

import state.parameters as parameters
from db import q

router = APIRouter()

# --- Config (governed parameter store; see state/parameters.py) ---------------
# Each is read at handler top via parameters.get_param(...), with the module
# constant below as the fallback literal — so an unseeded store reproduces the
# original responses byte-for-byte.
US_PAYER = "1000"  # US IP Principal Co. — the §59A applicable-taxpayer candidate
BEAT_THRESHOLD_PCT = 3.0  # §59A(e)(1)(C) base-erosion percentage threshold
BEAT_RATE_PCT = 10.0  # §59A(b) BEAT rate on modified taxable income (post-2018)

# --- FABRICATED: RACCT -> payment-type classification ------------------------
# Generic SAP chart-of-accounts codes mapped by account nature. COGS-nature
# accounts (cost of sales / direct materials) are the §59A COGS exception and are
# therefore NOT base-eroding; royalties / services / interest ARE base-eroding.
# Any unmapped RACCT falls back to 'other' (treated as base-eroding — the
# conservative default). This mapping is the assumed/fabricated input; the
# underlying RASSC payment base is real (from the journal).
_RACCT_TYPE: dict[str, str] = {
    "0510000": "cogs",       # cost of goods sold — direct materials
    "0820000": "cogs",       # production cost of sales
    "0810000": "services",   # intra-group services expense
    "0855000": "royalties",  # royalty / licence expense
    "0925000": "interest",   # intercompany interest expense
}
# Payment types excluded from base-eroding payments under §59A(d)(1) (COGS).
_NON_BASE_ERODING = {"cogs"}
_PAYMENT_TYPES = ("royalties", "services", "interest", "cogs", "other")

_DIM = Path(__file__).parent.parent / "dim" / "entity_dim.json"


def _classify(racct: str, racct_type: dict[str, str]) -> str:
    return racct_type.get(racct, "other")


@lru_cache(maxsize=1)
def _names() -> dict[str, str]:
    entities = json.loads(_DIM.read_text(encoding="utf-8"))["entities"]
    return {e["rbukrs"]: e["display_name"] for e in entities}


def _us_related_party_deductions(year: int, us_payer: str) -> list[dict[str, Any]]:
    """US payer deductible related-party lines, by RACCT (HSL < 0 = expense).

    REAL: aggregated straight from ``journal`` for RBUKRS = US payer where the
    affiliate trading partner RASSC is set (and is not the US payer itself)."""
    return q(
        "SELECT RACCT, SUM(HSL) AS hsl, COUNT(*) AS n "
        "FROM journal "
        "WHERE RBUKRS = ? AND GJAHR = ? "
        "AND RASSC IS NOT NULL AND RASSC <> '' AND RASSC <> ? "
        "AND HSL < 0 "
        "GROUP BY RACCT",
        [us_payer, year, us_payer],
    )


def _us_total_deductions(year: int, us_payer: str) -> float:
    """All US payer deductions for the year (every expense line, HSL < 0). The
    §59A base-erosion-percentage denominator."""
    rows = q(
        "SELECT SUM(HSL) AS hsl FROM journal WHERE RBUKRS = ? AND GJAHR = ? AND HSL < 0",
        [us_payer, year],
    )
    h = rows[0]["hsl"] if rows else None
    return -float(h) if h is not None else 0.0


def _us_gross_receipts(year: int, us_payer: str) -> float:
    """US payer gross receipts proxy (segment_pl revenue) — the $500M
    gross-receipts test input."""
    rows = q(
        "SELECT SUM(revenue) AS r FROM segment_pl WHERE RBUKRS = ? AND GJAHR = ?",
        [us_payer, year],
    )
    r = rows[0]["r"] if rows else None
    return float(r) if r is not None else 0.0


@router.get("/api/beat")
def beat(year: int = 2026) -> dict[str, Any]:
    """BEAT base-erosion computation (OTP-36) + per-CFC Schedule M rollup (OTP-38).

    The base-eroding payments are the US payer's related-party deductions
    (real, from ``journal`` RASSC lines) classified by ``_RACCT_TYPE``, excluding
    the COGS exception. Base-erosion % = base-eroding / total US deductions, tested
    against the 3% threshold; modified taxable income (MTI) adds the base-eroding
    payments back to the regular taxable income base. Returns a graceful zero
    model when the year has no US data."""
    us_payer = parameters.get_param("beat.us_payer", US_PAYER)
    threshold_pct = parameters.get_param("beat.threshold_pct", BEAT_THRESHOLD_PCT)
    rate_pct = parameters.get_param("beat.rate_pct", BEAT_RATE_PCT)
    racct_type = parameters.get_param("beat.racct_type", _RACCT_TYPE)
    non_base_eroding = set(parameters.get_param("beat.non_base_eroding", list(_NON_BASE_ERODING)))
    payment_type_order = tuple(parameters.get_param("beat.payment_types", list(_PAYMENT_TYPES)))
    names = _names()

    # --- OTP-36: classify the real related-party deductible base by type -------
    by_type: dict[str, float] = {t: 0.0 for t in payment_type_order}
    by_account: list[dict[str, Any]] = []
    for r in _us_related_party_deductions(year, us_payer):
        racct = str(r["RACCT"])
        amount = -float(r["hsl"])  # deduction magnitude (positive)
        ptype = _classify(racct, racct_type)
        by_type[ptype] += amount
        by_account.append(
            {
                "racct": racct,
                "payment_type": ptype,
                "base_eroding": ptype not in non_base_eroding,
                "amount": round(amount, 2),
                "postings": int(r["n"]),
            }
        )
    by_account.sort(key=lambda a: a["amount"], reverse=True)

    related_party_deductions = sum(by_type.values())
    base_eroding_payments = sum(
        v for t, v in by_type.items() if t not in non_base_eroding
    )
    cogs_excluded = by_type["cogs"]
    total_deductions = _us_total_deductions(year, us_payer)
    gross_receipts = _us_gross_receipts(year, us_payer)

    base_erosion_pct = (
        100.0 * base_eroding_payments / total_deductions if total_deductions else 0.0
    )
    threshold_met = base_erosion_pct >= threshold_pct

    # Modified taxable income = regular taxable income + base-eroding tax benefits.
    # Regular taxable income proxy = gross receipts − total deductions.
    regular_taxable_income = gross_receipts - total_deductions
    modified_taxable_income = regular_taxable_income + base_eroding_payments
    beat_base_tax = round(modified_taxable_income * rate_pct / 100.0, 2)

    payment_types = [
        {
            "type": t,
            "label": t.capitalize() if t != "cogs" else "COGS",
            "amount": round(by_type[t], 2),
            "base_eroding": t not in non_base_eroding,
        }
        for t in payment_type_order
    ]

    # --- OTP-38: per-CFC Schedule M rollup (US RASSC postings by counterparty) --
    schedule_m = _schedule_m(year, names, us_payer)

    return {
        "year": year,
        "us_payer": us_payer,
        "us_payer_name": names.get(us_payer, us_payer),
        "threshold_pct": threshold_pct,
        "beat_rate_pct": rate_pct,
        "gross_receipts": round(gross_receipts, 2),
        "total_deductions": round(total_deductions, 2),
        "related_party_deductions": round(related_party_deductions, 2),
        "cogs_excluded": round(cogs_excluded, 2),
        "base_eroding_payments": round(base_eroding_payments, 2),
        "base_erosion_pct": round(base_erosion_pct, 4),
        "threshold_met": threshold_met,
        "regular_taxable_income": round(regular_taxable_income, 2),
        "modified_taxable_income": round(modified_taxable_income, 2),
        "beat_base_tax": beat_base_tax,
        "payment_types": payment_types,
        "by_account": by_account,
        "schedule_m": schedule_m,
    }


def _schedule_m(year: int, names: dict[str, str], us_payer: str) -> list[dict[str, Any]]:
    """Per-CFC Form 5471 Schedule M rollup of the US payer's RASSC postings.

    For each affiliate counterparty (RASSC) of the US payer, split the journal
    HSL into amounts paid TO the CFC (US deductions, HSL < 0) and received FROM
    the CFC (US income, HSL > 0), and attach the counterparty's own segment_pl
    foreign P&L (revenue + operating_profit). All REAL — straight from
    ``journal`` and ``segment_pl``."""
    rows = q(
        "SELECT RASSC, "
        "SUM(CASE WHEN HSL < 0 THEN -HSL ELSE 0 END) AS paid_to, "
        "SUM(CASE WHEN HSL > 0 THEN HSL ELSE 0 END) AS received_from, "
        "COUNT(*) AS n "
        "FROM journal "
        "WHERE RBUKRS = ? AND GJAHR = ? "
        "AND RASSC IS NOT NULL AND RASSC <> '' AND RASSC <> ? "
        "GROUP BY RASSC ORDER BY RASSC",
        [us_payer, year, us_payer],
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        cfc = str(r["RASSC"])
        pl = q(
            "SELECT SUM(revenue) AS revenue, SUM(operating_profit) AS op "
            "FROM segment_pl WHERE RBUKRS = ? AND GJAHR = ?",
            [cfc, year],
        )
        rev = pl[0]["revenue"] if pl and pl[0]["revenue"] is not None else 0.0
        op = pl[0]["op"] if pl and pl[0]["op"] is not None else 0.0
        out.append(
            {
                "rbukrs": cfc,
                "name": names.get(cfc, cfc),
                "paid_to": round(float(r["paid_to"]), 2),
                "received_from": round(float(r["received_from"]), 2),
                "postings": int(r["n"]),
                "foreign_revenue": round(float(rev), 2),
                "foreign_operating_profit": round(float(op), 2),
            }
        )
    out.sort(key=lambda c: c["paid_to"], reverse=True)
    return out
