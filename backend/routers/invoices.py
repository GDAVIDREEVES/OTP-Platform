"""Invoices — Invoicing screen (synthesized from supply_chain_flows)."""

from __future__ import annotations

from fastapi import APIRouter

from constants import ENTITY_CCY, MATERIAL_LABELS
from db import q
from period_filter import PeriodFilter
from persistence import overrides as store

router = APIRouter()


@router.get("/api/invoices")
def list_invoices(
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
    material_type: str | None = None,
):
    """One invoice per (selling, buying, period, material_type) bucket.

    Status is bucketed by period: latest = Pending Approval, mid = Approved,
    earliest = Exported. Older = Draft. Real submitted adjustments come first.

    When ``material_type`` is supplied (e.g. ``SERVICE``), only invoices for that
    material type are returned and the submitted-adjustments rows are omitted —
    used by the service cost-allocation charge batch (OTP-10). Each bucket also
    carries ``costBase`` (Σ STANDARD_COST × TOTAL_VOLUME), the implied blended
    ``markup``, and the source ``lines`` count so KPIs come from the backend.
    """
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    mt_clause = ""
    params = list(pf_params)
    if material_type:
        mt_clause = " AND MATERIAL_TYPE = ?"
        params.append(material_type)
    sql = f"""
      SELECT SELLING_COMPANY AS payee,
             BUYING_COMPANY  AS payor,
             GJAHR, POPER,
             MATERIAL_TYPE,
             SUM(TOTAL_LEGAL_PRICE)               AS amount,
             SUM(STANDARD_COST * TOTAL_VOLUME)    AS cost_base,
             COUNT(*)                             AS lines
      FROM supply_chain
      WHERE 1=1 {pf_clause}{mt_clause}
      GROUP BY 1,2,3,4,5
      HAVING SUM(TOTAL_LEGAL_PRICE) > 0
      ORDER BY GJAHR DESC, POPER DESC, amount DESC
    """
    rows = q(sql, params)
    max_period = max((int(r["POPER"]) for r in rows), default=12)
    out = []
    for adj in [] if material_type else store.list_adjustments():
        out.append({
            "id": adj["id"],
            "date": (adj.get("submittedAt") or "")[:10],
            "payor": adj["entityId"],
            "payee": "",
            "type": f"Year-End TP Adjustment ({adj.get('mode','')})",
            "amount": float(adj["amount"]),
            "currency": adj.get("currency", "USD"),
            "status": adj.get("status", "Pending Approval"),
            "period": "012",
            "year": 0,
            "submitted": True,
        })
    for i, r in enumerate(rows[:60]):
        period_int = int(r["POPER"])
        if period_int == max_period:
            status = "Pending Approval"
        elif period_int >= max_period - 2:
            status = "Approved"
        elif period_int >= max_period - 5:
            status = "Exported"
        else:
            status = "Exported"
        currency = ENTITY_CCY.get(r["payor"], "USD")
        type_label = MATERIAL_LABELS.get(r["MATERIAL_TYPE"], r["MATERIAL_TYPE"])
        amount = float(r["amount"])
        cost_base = float(r["cost_base"] or 0.0)
        out.append({
            "id": f"INV-{r['GJAHR']}-{1000 + i:04d}",
            "date": f"{r['GJAHR']}-{period_int:02d}-20",
            "payor": r["payor"],
            "payee": r["payee"],
            "type": f"{type_label} — P{period_int:02d}",
            "amount": amount,
            "currency": currency,
            "status": status,
            "period": r["POPER"],
            "year": int(r["GJAHR"]),
            "submitted": False,
            "materialType": r["MATERIAL_TYPE"],
            "costBase": cost_base,
            "markup": (amount - cost_base) / cost_base if cost_base else 0.0,
            "lines": int(r["lines"]),
        })
    return out
