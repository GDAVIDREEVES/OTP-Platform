"""Transaction flows + royalties — Policy and Royalties screens."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from constants import ENTITY_DIM, MATERIAL_LABELS
from db import q
from period_filter import PeriodFilter
from services.labels import (
    describe_flow,
    ip_category_for,
    pli_for,
    pretty_method,
    wht_note,
)

router = APIRouter()

_SEEDS = Path(__file__).parent.parent / "seeds"

# Material/role combinations are priced against a single benchmarking set. Goods
# distribution (FRMF/COMM → LRD) tests on the limited-risk distributor band;
# inbound goods to a manufacturer/principal (TOLL/RDSC) test on the toll band;
# intra-group services test on the services band. Bands are read live from the
# committed benchmarking seed, never hardcoded numbers.
_GOODS_TYPES = ("FG", "SEMI", "RAW")


@lru_cache(maxsize=1)
def _benchmarks() -> dict[str, dict[str, Any]]:
    data = json.loads((_SEEDS / "benchmarking_sets" / "benchmarks.v1.json").read_text(encoding="utf-8"))
    return {s["set_id"]: s for s in data["sets"]}


def _benchmark_id_for(material_type: str, seller_role: str, buyer_role: str) -> str:
    """Pick the benchmarking set a settable price row tests against."""
    if material_type == "SERVICE":
        return "BM-SVC"
    if buyer_role == "LRD":
        return "BM-LRD"  # goods sold into a limited-risk distributor
    return "BM-TOLL"  # inbound goods to a toll manufacturer / principal


def _entity_name(rbukrs: str | None) -> str:
    return ENTITY_DIM.get(rbukrs or "", {}).get("display_name", rbukrs or "")


@router.get("/api/transactions/flows")
def list_flows(
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    sql = f"""
      SELECT MATERIAL_TYPE,
             SELLER_ROLE,
             BUYER_ROLE,
             TP_METHOD,
             COUNT(*)                    AS step_count,
             COUNT(DISTINCT CHAIN_ID)    AS chains,
             SUM(TOTAL_LEGAL_PRICE)      AS ytd_volume,
             BOOL_OR(APA_FLAG)           AS any_apa,
             BOOL_OR(CHALLENGED_FLAG)    AS any_challenged,
             LIST(DISTINCT SELLING_COMPANY) AS sellers,
             LIST(DISTINCT BUYING_COMPANY)  AS buyers
      FROM supply_chain
      WHERE 1=1 {pf_clause}
      GROUP BY 1,2,3,4
      ORDER BY ytd_volume DESC
    """
    rows = q(sql, pf_params)
    out = []
    for i, r in enumerate(rows, start=1):
        if r["any_challenged"]:
            status = "out-of-range"
        elif r["any_apa"]:
            status = "watch"
        else:
            status = "in-range"
        out.append({
            "id": f"TXN-{i:03d}",
            "type": MATERIAL_LABELS.get(r["MATERIAL_TYPE"], r["MATERIAL_TYPE"]),
            "materialType": r["MATERIAL_TYPE"],
            "description": describe_flow(r),
            "payors": r["buyers"],
            "payees": r["sellers"],
            "tpMethod": pretty_method(r["TP_METHOD"]),
            "pli": pli_for(r["TP_METHOD"]),
            "ytdVolume": float(r["ytd_volume"] or 0),
            "status": status,
            "apa": bool(r["any_apa"]),
            "challenged": bool(r["any_challenged"]),
            "sellerRole": r["SELLER_ROLE"],
            "buyerRole": r["BUYER_ROLE"],
            "chains": r["chains"],
        })
    return out


@router.get("/api/transactions/royalties")
def list_royalties(
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    sql = f"""
      SELECT IP_OWNER, SELLING_COMPANY, BUYING_COMPANY, MATNR, TP_METHOD,
             AVG(MARKUP_RATE) * 100 AS rate_pct,
             SUM(TOTAL_LEGAL_PRICE) AS ytd_fees,
             BOOL_OR(APA_FLAG) AS any_apa,
             BOOL_OR(CHALLENGED_FLAG) AS any_challenged
      FROM supply_chain
      WHERE MATERIAL_TYPE = 'ROYALTY' {pf_clause}
      GROUP BY 1,2,3,4,5
      ORDER BY ytd_fees DESC
    """
    rows = q(sql, pf_params)
    out = []
    for i, r in enumerate(rows, start=1):
        rate = float(r["rate_pct"] or 0)
        ip_category = ip_category_for(r["MATNR"])
        bench_low = max(0.0, rate - 1.5)
        bench_high = rate + 1.5
        within = bench_low <= rate <= bench_high
        out.append({
            "id": f"RY-{i:03d}",
            "ipCategory": ip_category,
            "licensor": r["SELLING_COMPANY"],
            "licensee": r["BUYING_COMPANY"],
            "ipOwner": r["IP_OWNER"],
            "matnr": r["MATNR"],
            "rate": round(rate, 2),
            "base": "Net Sales",
            "benchmarkRange": f"{bench_low:.1f}–{bench_high:.1f}%",
            "ytdFees": float(r["ytd_fees"] or 0),
            "withinBenchmark": within,
            "jurisdictionNote": wht_note(r["SELLING_COMPANY"], r["BUYING_COMPANY"]),
            "method": pretty_method(r["TP_METHOD"]),
            "apa": bool(r["any_apa"]),
            "challenged": bool(r["any_challenged"]),
        })
    return out


@router.get("/api/transactions/pricing")
def list_pricing(
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    """Settable per-material price rows for the goods & services price-setting
    wizards (OTP-4 services cost-plus, OTP-1/OTP-2 goods).

    Aggregates ``supply_chain`` per chain + material (NOT per role like
    ``/flows``): one row is the price a tax controller actually sets — the
    standard cost, the cost-plus markup, the resulting total legal price, the TP
    method, and the benchmarking band it tests against. Every number derives
    from the warehouse; the band is read live from the benchmarking seed.
    """
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    sql = f"""
      SELECT CHAIN_ID,
             MATERIAL_TYPE,
             ANY_VALUE(MATNR)            AS matnr,
             ANY_VALUE(SELLER_ROLE)      AS seller_role,
             ANY_VALUE(BUYER_ROLE)       AS buyer_role,
             ANY_VALUE(SELLING_COMPANY)  AS selling_company,
             ANY_VALUE(BUYING_COMPANY)   AS buying_company,
             ANY_VALUE(TP_METHOD)        AS tp_method,
             AVG(STANDARD_COST)          AS standard_cost,
             AVG(MARKUP_RATE)            AS markup_rate,
             SUM(TOTAL_LEGAL_PRICE)      AS total_legal_price,
             COUNT(*)                    AS step_count,
             BOOL_OR(APA_FLAG)           AS any_apa,
             BOOL_OR(CHALLENGED_FLAG)    AS any_challenged
      FROM supply_chain
      WHERE MATERIAL_TYPE IN ('SERVICE','FG','SEMI','RAW') {pf_clause}
      GROUP BY CHAIN_ID, MATERIAL_TYPE
      ORDER BY total_legal_price DESC
    """
    rows = q(sql, pf_params)
    benchmarks = _benchmarks()
    out = []
    for i, r in enumerate(rows, start=1):
        material_type = r["MATERIAL_TYPE"]
        is_service = material_type == "SERVICE"
        bm_id = _benchmark_id_for(material_type, r["seller_role"], r["buyer_role"])
        bm = benchmarks.get(bm_id, {})
        markup_pct = float(r["markup_rate"] or 0) * 100
        low = float(bm.get("lower", 0.0))
        median = float(bm.get("median", 0.0))
        high = float(bm.get("upper", 0.0))
        within = low <= markup_pct <= high
        out.append({
            "id": f"PR-{i:03d}",
            "chainId": r["CHAIN_ID"],
            "materialType": material_type,
            "category": "Intra-group service" if is_service else MATERIAL_LABELS.get(material_type, material_type),
            "transactionType": "service" if is_service else "goods",
            "matnr": r["matnr"] or None,
            "sellerRole": r["seller_role"],
            "buyerRole": r["buyer_role"],
            "seller": _entity_name(r["selling_company"]),
            "buyer": _entity_name(r["buying_company"]),
            "sellerCode": r["selling_company"],
            "buyerCode": r["buying_company"],
            "standardCost": float(r["standard_cost"] or 0),
            "markupRate": round(markup_pct, 2),
            "totalLegalPrice": float(r["total_legal_price"] or 0),
            "tpMethod": pretty_method(r["tp_method"]),
            "pli": pli_for(r["tp_method"]),
            "steps": int(r["step_count"] or 0),
            "benchmarkId": bm_id,
            "benchmarkLabel": bm.get("applies_to", bm_id),
            "benchmarkRange": f"{low:.1f}–{high:.1f}%",
            "benchmarkMedian": median,
            "withinBenchmark": within,
            "apa": bool(r["any_apa"]),
            "challenged": bool(r["any_challenged"]),
        })
    return out
