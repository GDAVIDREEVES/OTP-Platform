"""ERP ↔ TP reconciliation (OTP-43) + billing control source (OTP-42).

One read-only endpoint that joins the planned intercompany price book
(``supply_chain``: planned TOTAL_LEGAL_PRICE per AWREF, with TP method and the
entity pair) to what actually posted in ACDOCA (``journal``: HSL by AWREF). The
join key is ``AWREF`` — the SAP "reference document" stamped on both the planned
flow and its postings — exactly the field a controller uses to tie a TP charge
back to its GL.

Every figure derives from the warehouse via the same ``db.q`` + ``PeriodFilter``
patterns used by ``routers/flows.py`` / ``transactions.py``; nothing is
hardcoded. The frontend OTP-43 (recon) and OTP-42 (billing controls) read from
this single source so their numbers cannot drift apart.

Posted amount per AWREF = ``MAX(ABS(HSL))`` across the document's postings — the
largest single P&L line, i.e. the booked value of the IC charge. This matches
the planned legal price exactly for every posted flow in the demo data, so a
non-zero delta is a genuine value break, not a sign/aggregation artefact.

Status (priority order):
  * ``challenged``  — the flow carries CHALLENGED_FLAG (authority/internal query)
  * ``unposted``    — no ACDOCA posting exists for the AWREF yet
  * ``value-break`` — posted, but |posted − planned| exceeds tolerance
  * ``reconciled``  — posted, matches planned, not challenged
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter

import state.parameters as parameters
from db import q
from period_filter import PeriodFilter
from services.labels import pretty_method

router = APIRouter()

_DIM = Path(__file__).parent.parent / "dim" / "entity_dim.json"

# A flow whose posted value differs from the planned legal price by more than
# this (absolute, in document currency) is a value break worth a controller's
# attention. Below it, rounding/FX noise is treated as reconciled. This is the
# governed `reconciliation.value_break_tolerance` parameter; the constant below
# is the fallback literal read at handler top so responses stay byte-identical.
VALUE_BREAK_TOLERANCE = 1.0


@lru_cache(maxsize=1)
def _names() -> dict[str, str]:
    entities = json.loads(_DIM.read_text(encoding="utf-8"))["entities"]
    return {e["rbukrs"]: e["display_name"] for e in entities}


def _classify(posted: float | None, delta: float, challenged: bool, tolerance: float) -> str:
    if challenged:
        return "challenged"
    if posted is None:
        return "unposted"
    if abs(delta) > tolerance:
        return "value-break"
    return "reconciled"


@router.get("/api/reconciliation")
def reconciliation(
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
) -> dict[str, Any]:
    """Per-flow ERP↔TP reconciliation keyed by AWREF.

    Returns ``{summary, rows}`` where each row is one planned IC flow with its
    posted ACDOCA value, the delta, and a reconciliation status. ``summary``
    holds the four KPI counts (reconciled / unposted / value-breaks /
    challenged) plus the planned/posted/delta totals.
    """
    tolerance = parameters.get_param(
        "reconciliation.value_break_tolerance", VALUE_BREAK_TOLERANCE
    )
    names = _names()
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()

    # Planned book: one row per AWREF from supply_chain (the price set per flow),
    # left-joined to the posted value derived from the ACDOCA journal. The
    # journal aggregate is computed per AWREF first, then joined, so an unposted
    # flow surfaces as NULL posted (not a dropped row).
    sql = f"""
      WITH posted AS (
        SELECT AWREF, MAX(ABS(HSL)) AS posted, COUNT(*) AS postings
        FROM journal
        WHERE AWREF IS NOT NULL
        GROUP BY AWREF
      )
      SELECT
        sc.AWREF                 AS awref,
        sc.SELLING_COMPANY       AS seller,
        sc.BUYING_COMPANY        AS buyer,
        sc.TP_METHOD             AS tp_method,
        sc.MATERIAL_TYPE         AS material_type,
        sc.GJAHR                 AS gjahr,
        sc.POPER                 AS poper,
        sc.TOTAL_LEGAL_PRICE     AS planned,
        BOOL_OR(sc.CHALLENGED_FLAG) AS challenged,
        BOOL_OR(sc.APA_FLAG)        AS apa,
        ANY_VALUE(p.posted)      AS posted,
        ANY_VALUE(p.postings)    AS postings
      FROM supply_chain sc
      LEFT JOIN posted p ON p.AWREF = sc.AWREF
      WHERE sc.AWREF IS NOT NULL {pf_clause}
      GROUP BY sc.AWREF, sc.SELLING_COMPANY, sc.BUYING_COMPANY, sc.TP_METHOD,
               sc.MATERIAL_TYPE, sc.GJAHR, sc.POPER, sc.TOTAL_LEGAL_PRICE
      ORDER BY sc.TOTAL_LEGAL_PRICE DESC
    """
    raw = q(sql, pf_params)

    rows: list[dict[str, Any]] = []
    summary = {
        "reconciled": 0,
        "unposted": 0,
        "value-breaks": 0,
        "challenged": 0,
        "total": 0,
        "planned_total": 0.0,
        "posted_total": 0.0,
        "delta_total": 0.0,
    }

    for r in raw:
        planned = float(r["planned"] or 0)
        posted = float(r["posted"]) if r["posted"] is not None else None
        delta = (posted - planned) if posted is not None else 0.0
        challenged = bool(r["challenged"])
        status = _classify(posted, delta, challenged, tolerance)

        summary["total"] += 1
        summary["planned_total"] += planned
        if posted is not None:
            summary["posted_total"] += posted
            summary["delta_total"] += delta
        if status == "reconciled":
            summary["reconciled"] += 1
        elif status == "unposted":
            summary["unposted"] += 1
        elif status == "value-break":
            summary["value-breaks"] += 1
        elif status == "challenged":
            summary["challenged"] += 1

        seller, buyer = str(r["seller"]), str(r["buyer"])
        rows.append({
            "awref": r["awref"],
            "seller": seller,
            "buyer": buyer,
            "sellerName": names.get(seller, seller),
            "buyerName": names.get(buyer, buyer),
            "tpMethod": pretty_method(r["tp_method"]),
            "materialType": r["material_type"],
            "gjahr": r["gjahr"],
            "poper": r["poper"],
            "planned": round(planned, 2),
            "posted": round(posted, 2) if posted is not None else None,
            "delta": round(delta, 2),
            "postings": int(r["postings"] or 0),
            "challenged": challenged,
            "apa": bool(r["apa"]),
            "status": status,
        })

    summary["planned_total"] = round(summary["planned_total"], 2)
    summary["posted_total"] = round(summary["posted_total"], 2)
    summary["delta_total"] = round(summary["delta_total"], 2)

    return {"summary": summary, "rows": rows}
