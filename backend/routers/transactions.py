"""Transaction flows + royalties — Policy and Royalties screens."""

from __future__ import annotations

from fastapi import APIRouter

from constants import MATERIAL_LABELS
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
