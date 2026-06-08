"""TDD for the treasury endpoint (routers/treasury.py).

The loan register + cash-pool positions are FABRICATED seeds; this endpoint
computes the interest. The critical guarantees are:

* per-loan annual interest == principal x all_in_rate;
* every loan's all_in_rate sits inside the BM-FIN band;
* cash-pool participant balances net to ~0;
* per-seat interest == balance x spread (deposit on a surplus / borrow on a
  deficit).

Run from `backend/`:  python -m pytest tests/test_treasury.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _model():
    r = client.get("/api/treasury")
    assert r.status_code == 200
    return r.json()


def test_fabricated_flag_and_lender():
    m = _model()
    assert m["fabricated"] is True
    assert m["lender"] == "3400"  # Ireland Financing Co.


def test_loan_register_present():
    m = _model()
    assert len(m["loans"]) >= 3
    assert {ln["borrower"] for ln in m["loans"]} >= {"1000", "3000", "3200"}


def test_loan_interest_is_principal_times_rate():
    m = _model()
    for ln in m["loans"]:
        expected = ln["principal"] * ln["all_in_rate"] / 100.0
        assert abs(ln["annual_interest"] - expected) < 0.01


def test_all_in_rate_decomposes_into_base_plus_spread():
    m = _model()
    for ln in m["loans"]:
        assert abs(ln["all_in_rate"] - (ln["base_rate"] + ln["credit_spread"])) < 1e-6


def test_all_rates_within_bm_fin_band():
    m = _model()
    lo, hi = m["benchmark"]["lower"], m["benchmark"]["upper"]
    assert (lo, hi) == (3.5, 5.5)
    for ln in m["loans"]:
        assert lo <= ln["all_in_rate"] <= hi
        assert ln["within_benchmark"] is True
    assert m["totals"]["loans_within_benchmark"] == len(m["loans"])


def test_pool_balances_net_to_zero():
    m = _model()
    participants = m["cash_pool"]["participants"]
    assert len(participants) >= 4
    net = sum(p["balance"] for p in participants)
    assert abs(net) < 1.0
    assert abs(m["cash_pool"]["net_position"]) < 1.0
    assert abs(m["totals"]["pool_net_position"]) < 1.0


def test_pool_interest_is_balance_times_spread():
    m = _model()
    cp = m["cash_pool"]
    for p in cp["participants"]:
        spread = cp["deposit_spread"] if p["balance"] >= 0 else cp["borrow_spread"]
        expected = p["balance"] * spread / 100.0
        assert abs(p["annual_interest"] - expected) < 0.01
        assert p["spread"] == spread
        assert p["position"] == ("deposit" if p["balance"] >= 0 else "borrow")


def test_totals_reconcile():
    m = _model()
    assert abs(m["totals"]["loan_principal"] - sum(ln["principal"] for ln in m["loans"])) < 0.01
    assert abs(m["totals"]["loan_interest"] - sum(ln["annual_interest"] for ln in m["loans"])) < 0.01
    assert abs(m["totals"]["pool_interest"] - sum(p["annual_interest"] for p in m["cash_pool"]["participants"])) < 0.01


def test_served_via_reference_router():
    """The fabricated register is also reachable as a read-only reference seed."""
    r = client.get("/api/reference/treasury")
    assert r.status_code == 200
    assert "loans" in r.json()
