"""Tests for the reference seed endpoint.

Run from `backend/`:  python -m pytest tests/test_reference.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_benchmarks_load():
    body = client.get("/api/reference/benchmarks").json()
    assert len(body["sets"]) >= 5
    assert all("median" in s for s in body["sets"])


def test_pillar_two_has_topup():
    rows = client.get("/api/reference/pillar_two").json()["rows"]
    assert any(r["top_up_tax"] > 0 for r in rows)  # low-tax jurisdictions


def test_dempe_keyed_to_entities():
    allocs = client.get("/api/reference/dempe").json()["allocations"]
    assert {a["rbukrs"] for a in allocs} <= {"1000", "3000", "3100", "3200", "3300", "3400", "3800", "4100"}


def test_stewardship_register_loads():
    doc = client.get("/api/reference/stewardship").json()
    assert len(doc["lines"]) >= 5
    assert {ln["rbukrs"] for ln in doc["lines"]} <= {"1000", "3100"}  # parent entities only
    assert any(ln["stewardship"] for ln in doc["lines"])  # at least one shareholder cost


def test_guarantee_register_loads():
    doc = client.get("/api/reference/guarantee").json()
    assert doc["fabricated"] is True
    assert len(doc["arrangements"]) >= 2
    assert doc["guarantor"] == "1000"  # US IP Principal guarantor
    for a in doc["arrangements"]:
        # fee captures part of (never exceeds) the yield benefit
        assert 0 < a["guarantee_fee_bps"] <= a["yield_benefit_bps"]
        assert 25 <= a["yield_benefit_bps"] <= 90


def test_captive_register_loads():
    doc = client.get("/api/reference/captive").json()
    assert doc["fabricated"] is True
    assert len(doc["policies"]) >= 2
    assert doc["insurer"] == "3400"  # Ireland Financing Co. as captive insurer
    gp = sum(p["gross_premium"] for p in doc["policies"])
    losses = sum(p["incurred_losses"] for p in doc["policies"])
    expenses = sum(p["expenses"] for p in doc["policies"])
    combined = (losses + expenses) / gp
    # priced to underwrite a profit: combined ratio inside the ceiling
    assert combined <= doc["combined_ratio_ceiling"]
    # statutory capital clears the solvency floor (capital / net premium)
    assert doc["capital"] / gp >= doc["capital_adequacy_floor"]
    for p in doc["policies"]:
        assert 0 < p["incurred_losses"] < p["gross_premium"]  # loss ratio < 100%


def test_fx_register_loads():
    doc = client.get("/api/reference/fx").json()
    assert doc["fabricated"] is True
    assert doc["base_currency"] == "USD"
    assert len(doc["positions"]) >= 3
    # IC FX positions are quoted vs USD for the non-USD IC-position currencies
    assert {p["currency"] for p in doc["positions"]} == {"EUR", "CHF", "GBP"}
    for p in doc["positions"]:
        assert 50 <= p["hedge_ratio_pct"] <= 85  # hedge ratio inside the policy band
        assert p["spot_rate"] > 0 and p["forward_rate"] > 0
        assert p["ic_exposure_local"] > 0
        assert p["entity"] in {"1000", "3000", "3100", "3200", "3300", "3400", "3800", "4100"}


def test_unknown_reference_404():
    assert client.get("/api/reference/nope").status_code == 404
