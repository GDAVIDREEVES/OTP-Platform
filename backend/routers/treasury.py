"""Treasury suite — IC loan interest accrual & cash-pool settlement (OTP-6,
OTP-13, OTP-14).

The loan register and cash-pool positions are FABRICATED (no loan/pool source
exists in the warehouse) and live in the ``treasury`` reference seed served via
the reference router. This endpoint COMPUTES the arm's-length figures from that
seed:

* per loan      — ``annual_interest = principal * all_in_rate``
* per pool seat — ``annual_interest = balance * spread`` (deposit spread on a
                  surplus / borrow spread on a deficit)

Each loan's ``all_in_rate`` is checked against the BM-FIN CUP band (from the
``benchmarks`` seed) so the rate-setting view (OTP-6) can flag anything outside
3.5-5.5%. Pool participant balances net to ~0 by construction. No warehouse
figures are touched — every number is either seeded (fabricated, flagged) or
derived from the seed here.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from state import seeds

router = APIRouter()


def _bm_fin() -> dict[str, float]:
    """The BM-FIN intercompany-financing CUP band from the benchmarks seed."""
    sets = seeds.load("benchmarks").get("sets", [])
    bm = next((s for s in sets if s.get("set_id") == "BM-FIN"), None)
    if bm is None:
        return {"lower": 3.5, "median": 4.5, "upper": 5.5}
    return {"lower": float(bm["lower"]), "median": float(bm["median"]), "upper": float(bm["upper"])}


@router.get("/api/treasury")
def treasury() -> dict[str, Any]:
    """IC loan register + cash-pool positions with computed annual interest.

    Returns the loan register (with ``annual_interest`` and a ``within_benchmark``
    flag vs BM-FIN), the cash pool (per-seat ``annual_interest`` from the
    deposit/borrow spread, plus the net position) and rolled-up totals.
    """
    data = seeds.load("treasury")
    band = _bm_fin()
    lo, hi = band["lower"], band["upper"]

    loans: list[dict[str, Any]] = []
    for ln in data.get("loans", []):
        principal = float(ln["principal"])
        all_in = float(ln["all_in_rate"])
        annual_interest = principal * all_in / 100.0
        loans.append(
            {
                "loan_id": ln["loan_id"],
                "borrower": ln["borrower"],
                "borrower_name": ln["borrower_name"],
                "principal": round(principal, 2),
                "currency": ln["currency"],
                "tenor_years": ln["tenor_years"],
                "credit_rating": ln["credit_rating"],
                "base_rate": float(ln["base_rate"]),
                "credit_spread": float(ln["credit_spread"]),
                "all_in_rate": all_in,
                "annual_interest": round(annual_interest, 2),
                "within_benchmark": lo <= all_in <= hi,
            }
        )

    pool_seed = data.get("cash_pool", {})
    deposit_spread = float(pool_seed.get("deposit_spread", 0.0))
    borrow_spread = float(pool_seed.get("borrow_spread", 0.0))
    participants: list[dict[str, Any]] = []
    for p in pool_seed.get("participants", []):
        balance = float(p["balance"])
        spread = deposit_spread if balance >= 0 else borrow_spread
        annual_interest = balance * spread / 100.0
        participants.append(
            {
                "rbukrs": p["rbukrs"],
                "name": p["name"],
                "balance": round(balance, 2),
                "position": "deposit" if balance >= 0 else "borrow",
                "spread": spread,
                "annual_interest": round(annual_interest, 2),
            }
        )

    net_position = sum(float(p["balance"]) for p in pool_seed.get("participants", []))

    cash_pool = {
        "pool_id": pool_seed.get("pool_id", ""),
        "header": pool_seed.get("header", ""),
        "header_name": pool_seed.get("header_name", ""),
        "currency": pool_seed.get("currency", ""),
        "deposit_spread": deposit_spread,
        "borrow_spread": borrow_spread,
        "net_position": round(net_position, 2),
        "participants": participants,
    }

    totals = {
        "loans": len(loans),
        "loan_principal": round(sum(ln["principal"] for ln in loans), 2),
        "loan_interest": round(sum(ln["annual_interest"] for ln in loans), 2),
        "loans_within_benchmark": sum(1 for ln in loans if ln["within_benchmark"]),
        "pool_participants": len(participants),
        "pool_net_position": round(net_position, 2),
        "pool_interest": round(sum(p["annual_interest"] for p in participants), 2),
    }

    return {
        "fabricated": True,
        "lender": data.get("lender", ""),
        "lender_name": data.get("lender_name", ""),
        "benchmark_id": data.get("benchmark_id", "BM-FIN"),
        "benchmark": band,
        "loans": loans,
        "cash_pool": cash_pool,
        "totals": totals,
    }
