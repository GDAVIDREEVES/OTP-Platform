"""Withholding tax on intercompany payments (OTP-46).

Derives the withholdable IC payment legs from ``supply_chain`` (ROYALTY +
intra-group SERVICE flows) — the buyer (``BUYING_COMPANY`` in
``BUYER_LAND1``) is the *source-country* payer, the seller
(``SELLING_COMPANY`` in ``SELLER_LAND1``) is the payee/recipient. Each corridor
is joined to the bilateral treaty-rate seed (``wht_treaty``, served via the
reference router) to compute the reduced treaty WHT due and the saving versus the
source country's statutory fallback.

No hardcoded financials: the gross withholdable base ($2.3M royalty + $14.3M
service) comes straight from the warehouse; only the treaty/statutory rate matrix
is the (illustrative, OECD-model-aligned) seed.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from db import q
from period_filter import PeriodFilter
from state import seeds

router = APIRouter()

# Material types that carry a withholding-tax obligation at source.
_WHT_TYPES = ("ROYALTY", "SERVICE")


def _rate_index() -> tuple[dict[tuple[str, str], dict[str, Any]], dict[str, dict[str, Any]], dict[str, float]]:
    """Build lookups from the treaty seed:

    - exact corridor (source, residence) -> {statutory, treaty, basis}
    - source-wildcard (source) -> {statutory, treaty, basis} (residence == '*')
    - the catch-all default {statutory, treaty}
    """
    data = seeds.load("wht_treaty")
    exact: dict[tuple[str, str], dict[str, Any]] = {}
    wildcard: dict[str, dict[str, Any]] = {}
    for c in data.get("corridors", []):
        src, res = c["source"], c["residence"]
        if res == "*":
            wildcard[src] = c
        else:
            exact[(src, res)] = c
    return exact, wildcard, data.get("default", {"statutory": 20.0, "treaty": 10.0})


def _rates_for(source: str, residence: str) -> dict[str, Any]:
    """Resolve the treaty/statutory rate for a corridor: exact corridor first,
    then a source-country wildcard, then the seed default."""
    exact, wildcard, default = _rate_index()
    hit = exact.get((source, residence)) or wildcard.get(source)
    if hit is not None:
        return hit
    return {"statutory": default["statutory"], "treaty": default["treaty"], "basis": "statutory fallback (no treaty)"}


def _label(material_type: str) -> str:
    return "Royalty" if material_type == "ROYALTY" else "Service"


@router.get("/api/wht")
def wht(
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
) -> dict[str, Any]:
    """Per-corridor withholding tax on IC royalty + service payments.

    Each row: payer/payee country, payment type, gross payment, treaty_rate,
    statutory_rate, wht_due (gross × treaty), treaty_saving ((statutory −
    treaty) × gross). Totals roll the per-corridor figures up to a single
    source of truth.
    """
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    ph = ",".join("?" for _ in _WHT_TYPES)
    sql = f"""
      SELECT MATERIAL_TYPE,
             BUYER_LAND1            AS source_cc,
             SELLER_LAND1           AS residence_cc,
             ANY_VALUE(BUYING_COMPANY)  AS payer,
             ANY_VALUE(SELLING_COMPANY) AS payee,
             SUM(TOTAL_LEGAL_PRICE)     AS gross
      FROM supply_chain
      WHERE MATERIAL_TYPE IN ({ph}) {pf_clause}
      GROUP BY MATERIAL_TYPE, BUYER_LAND1, SELLER_LAND1
      ORDER BY gross DESC
    """
    rows = q(sql, list(_WHT_TYPES) + pf_params)

    out: list[dict[str, Any]] = []
    for i, r in enumerate(rows, start=1):
        source = str(r["source_cc"])
        residence = str(r["residence_cc"])
        gross = float(r["gross"] or 0)
        rates = _rates_for(source, residence)
        treaty_rate = float(rates["treaty"])
        statutory_rate = float(rates["statutory"])
        wht_due = round(gross * treaty_rate / 100.0, 2)
        treaty_saving = round(gross * (statutory_rate - treaty_rate) / 100.0, 2)
        out.append({
            "id": f"WHT-{i:03d}",
            "payment_type": _label(r["MATERIAL_TYPE"]),
            "material_type": r["MATERIAL_TYPE"],
            "payer": r["payer"],
            "payee": r["payee"],
            "payer_country": source,
            "payee_country": residence,
            "corridor": f"{source}→{residence}",
            "gross": round(gross, 2),
            "treaty_rate": treaty_rate,
            "statutory_rate": statutory_rate,
            "wht_due": wht_due,
            "treaty_saving": treaty_saving,
            "basis": rates.get("basis", ""),
        })

    totals = {
        "corridors": len(out),
        "gross": round(sum(r["gross"] for r in out), 2),
        "wht_due": round(sum(r["wht_due"] for r in out), 2),
        "treaty_saving": round(sum(r["treaty_saving"] for r in out), 2),
        "statutory_due": round(sum(r["wht_due"] + r["treaty_saving"] for r in out), 2),
    }
    return {"rows": out, "totals": totals}
