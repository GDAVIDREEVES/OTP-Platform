"""VAT / indirect-tax impact analysis on intercompany flows (OTP-19).

Derives the VATable intercompany legs from ``supply_chain`` (royalty, service and
goods flows) and groups them by the *recipient* jurisdiction (``BUYER_LAND1`` —
the place of supply / reverse-charge for cross-border B2B). Each jurisdiction is
joined to the standard VAT/GST rate seed (``vat``, served via the reference
router) to compute the VATable base, VAT charged, the recoverable portion and the
net (non-recoverable) cost leakage.

No hardcoded financials: the VATable base comes straight from the warehouse; only
the rate matrix and recoverability flags are the (illustrative, publicly
checkable) seed.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from db import q
from period_filter import PeriodFilter
from state import seeds

router = APIRouter()

# IC flow material types that carry an indirect-tax (VAT/GST) consequence:
# royalties, intra-group services, and the goods legs.
_VAT_TYPES = ("ROYALTY", "SERVICE", "FG", "SEMI", "RAW")

_LEG_LABEL = {
    "ROYALTY": "Royalty",
    "SERVICE": "Service",
    "FG": "Goods",
    "SEMI": "Goods",
    "RAW": "Goods",
}


def _rate_for(cc: str) -> dict[str, Any]:
    """Resolve the standard VAT/GST rate + recoverability for a jurisdiction,
    falling back to the seed default (no indirect tax modelled)."""
    data = seeds.load("vat")
    by_cc = {j["cc"]: j for j in data.get("jurisdictions", [])}
    hit = by_cc.get(cc)
    if hit is not None:
        return hit
    d = data.get("default", {"rate": 0.0, "recoverable": True, "regime": "VAT"})
    return {
        "cc": cc,
        "country": cc,
        "regime": d.get("regime", "VAT"),
        "rate": d.get("rate", 0.0),
        "recoverable": d.get("recoverable", True),
        "basis": d.get("basis", ""),
    }


@router.get("/api/vat")
def vat(
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
) -> dict[str, Any]:
    """Per-jurisdiction VAT / indirect-tax impact on IC royalty, service and goods legs.

    Each row: recipient jurisdiction, VATable base (gross IC flow), standard
    rate, VAT charged (base × rate), recoverable input VAT, and the net
    (non-recoverable) cost. Totals roll the per-jurisdiction figures up to a
    single source of truth.
    """
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    ph = ",".join("?" for _ in _VAT_TYPES)
    sql = f"""
      SELECT BUYER_LAND1 AS jurisdiction_cc,
             SUM(CASE WHEN MATERIAL_TYPE = 'ROYALTY' THEN TOTAL_LEGAL_PRICE ELSE 0 END) AS royalty_base,
             SUM(CASE WHEN MATERIAL_TYPE = 'SERVICE' THEN TOTAL_LEGAL_PRICE ELSE 0 END) AS service_base,
             SUM(CASE WHEN MATERIAL_TYPE IN ('FG','SEMI','RAW') THEN TOTAL_LEGAL_PRICE ELSE 0 END) AS goods_base,
             SUM(TOTAL_LEGAL_PRICE) AS base
      FROM supply_chain
      WHERE MATERIAL_TYPE IN ({ph}) {pf_clause}
      GROUP BY BUYER_LAND1
      ORDER BY base DESC
    """
    rows = q(sql, list(_VAT_TYPES) + pf_params)

    out: list[dict[str, Any]] = []
    for i, r in enumerate(rows, start=1):
        cc = str(r["jurisdiction_cc"])
        info = _rate_for(cc)
        base = float(r["base"] or 0)
        rate = float(info["rate"])
        recoverable_flag = bool(info["recoverable"])
        vat_charged = round(base * rate / 100.0, 2)
        recoverable = round(vat_charged if recoverable_flag else 0.0, 2)
        net_cost = round(vat_charged - recoverable, 2)
        out.append({
            "id": f"VAT-{i:03d}",
            "jurisdiction": cc,
            "country": info.get("country", cc),
            "regime": info.get("regime", "VAT"),
            "royalty_base": round(float(r["royalty_base"] or 0), 2),
            "service_base": round(float(r["service_base"] or 0), 2),
            "goods_base": round(float(r["goods_base"] or 0), 2),
            "base": round(base, 2),
            "rate": rate,
            "recoverable_flag": recoverable_flag,
            "vat_charged": vat_charged,
            "recoverable": recoverable,
            "net_cost": net_cost,
            "basis": info.get("basis", ""),
        })

    totals = {
        "jurisdictions": len(out),
        "base": round(sum(r["base"] for r in out), 2),
        "vat_charged": round(sum(r["vat_charged"] for r in out), 2),
        "recoverable": round(sum(r["recoverable"] for r in out), 2),
        "net_cost": round(sum(r["net_cost"] for r in out), 2),
    }
    return {"fabricated": True, "rows": out, "totals": totals}
