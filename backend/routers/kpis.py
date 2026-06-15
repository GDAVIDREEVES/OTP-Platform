"""KPI summary — drives Dashboard top cards.

Phase 5 W2: accepts ``?pl=base|post_charge`` (omitted = the governed
``pl.use_post_charge`` parameter). Base path untouched — byte-identical,
golden-gated in tests/test_post_charge.py. Post-charge path (only when a
waterfall run is APPLIED): each tested party's YTD volume / margin / band
status recomputes with the overlay deltas (Decimal) before the counters
aggregate, and the response carries ``plBasis``/``waterfallRunId`` markers.
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, HTTPException

import services.post_charge as post_charge
from db import q
from period_filter import PeriodFilter
from services.entities import list_entities
from services.status import compute_status

router = APIRouter()


@router.get("/api/kpis")
def kpis(
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
    # P&L basis: base | post_charge; omitted = the governed param. Plain None
    # default so the handler stays directly callable (registry pattern).
    pl: str | None = None,
):
    try:
        mode = post_charge.resolve_mode(pl)
        adj = post_charge.entity_adjustments(
            year=year,
            month_from=post_charge.parse_month(periodFrom),
            month_to=post_charge.parse_month(periodTo),
        ) if mode == "post_charge" else {}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    entities = list_entities(pf)

    if adj:
        # Post-charge basis: fold the applied waterfall overlay into each
        # tested party BEFORE the counters aggregate. Bands come raw from
        # entity_roles (the exact source list_entities uses) so the verdict
        # rule is identical to OTP-20's.
        bands = {
            str(r["RBUKRS"]): (float(r["OM_LOW_PCT"] or 0), float(r["OM_HIGH_PCT"] or 0))
            for r in q("SELECT RBUKRS, OM_LOW_PCT, OM_HIGH_PCT FROM entity_roles")
        }
        for e in entities:
            a = adj.get(e["id"])
            if a is None:
                continue
            rev = Decimal(str(e["ytdVolume"])) + a["revenue"]
            op = Decimal(str(e["ytdOpProfit"])) + a["net"]
            margin = float(op / rev) if rev != 0 else None
            low, high = bands.get(e["id"], (0.0, 0.0))
            status, _ = compute_status(margin, low, high)
            e["status"] = status
            e["ytdVolume"] = float(rev)

    total_volume = sum(e["ytdVolume"] for e in entities)
    in_range = sum(1 for e in entities if e["status"] == "in-range")
    watch = sum(1 for e in entities if e["status"] == "watch")
    out_of_range = sum(1 for e in entities if e["status"] == "out-of-range")
    no_data = sum(1 for e in entities if e["status"] == "no-data")
    open_adj = sum(1 for e in entities if e["status"] == "out-of-range")

    pf_clause, pf_params = pf.where()
    apa_chains = q(
        f"""
        SELECT COUNT(DISTINCT CHAIN_ID) AS n
        FROM supply_chain
        WHERE APA_FLAG = TRUE {pf_clause}
        """,
        pf_params,
    )[0]["n"]
    challenged_chains = q(
        f"""
        SELECT COUNT(DISTINCT CHAIN_ID) AS n
        FROM supply_chain
        WHERE CHALLENGED_FLAG = TRUE {pf_clause}
        """,
        pf_params,
    )[0]["n"]

    out = {
        "totalICVolume": total_volume,
        "entityCount": len(entities),
        "entitiesInRange": in_range,
        "entitiesWatch": watch,
        "entitiesOutOfRange": out_of_range,
        "entitiesNoData": no_data,
        "openAdjustments": open_adj,
        "flowsUnderAPA": int(apa_chains or 0),
        "flowsChallenged": int(challenged_chains or 0),
    }
    if adj:
        # Additive markers — present ONLY on the post-charge basis, so the
        # base response stays byte-identical.
        out["plBasis"] = "post_charge"
        out["waterfallRunId"] = post_charge.applied_run_id()
    return out
