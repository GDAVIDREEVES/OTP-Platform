"""VAT / indirect-tax impact analysis on IC flows (OTP-19).

GET /api/vat derives the VATable royalty + service + goods legs from supply_chain
and joins the standard VAT/GST rate seed (served via /api/reference/vat).

Run from `backend/`:  python -m pytest tests/test_vat.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_vat_seed_serves_via_reference():
    body = client.get("/api/reference/vat").json()
    assert body.get("fabricated") is True
    assert "jurisdictions" in body and "default" in body
    by_cc = {j["cc"]: j for j in body["jurisdictions"]}
    # Publicly checkable standard rates (verify-current).
    assert by_cc["DE"]["rate"] == 19.0
    assert by_cc["FR"]["rate"] == 20.0
    assert by_cc["GB"]["rate"] == 20.0
    assert by_cc["NL"]["rate"] == 21.0
    assert by_cc["IE"]["rate"] == 23.0
    assert by_cc["CH"]["rate"] == 8.1
    assert by_cc["IN"]["rate"] == 18.0 and by_cc["IN"]["regime"] == "GST"
    assert by_cc["US"]["rate"] == 0.0  # no federal VAT


def test_vat_rows_derive_real_base_and_compute_net_cost():
    body = client.get("/api/vat").json()
    assert body.get("fabricated") is True
    rows = body["rows"]
    assert rows, "expected VATable IC legs from supply_chain"

    for r in rows:
        # base = royalty + service + goods legs
        assert r["base"] == round(r["royalty_base"] + r["service_base"] + r["goods_base"], 2)
        # vat_charged = base × rate
        assert r["vat_charged"] == round(r["base"] * r["rate"] / 100.0, 2)
        # recoverable is the full charge when the flag is set, else 0
        expected_recoverable = r["vat_charged"] if r["recoverable_flag"] else 0.0
        assert r["recoverable"] == round(expected_recoverable, 2)
        # net cost is the non-recoverable balance
        assert r["net_cost"] == round(r["vat_charged"] - r["recoverable"], 2)
        assert r["net_cost"] >= 0
        assert r["jurisdiction"]

    # The real VATable base on these legs ≈ $133M.
    base = sum(r["base"] for r in rows)
    assert 120_000_000 < base < 145_000_000


def test_vat_totals_reconcile_rows():
    body = client.get("/api/vat").json()
    t = body["totals"]
    rows = body["rows"]
    assert t["jurisdictions"] == len(rows)
    assert t["base"] == round(sum(r["base"] for r in rows), 2)
    assert t["vat_charged"] == round(sum(r["vat_charged"] for r in rows), 2)
    assert t["recoverable"] == round(sum(r["recoverable"] for r in rows), 2)
    assert t["net_cost"] == round(sum(r["net_cost"] for r in rows), 2)
    # net cost = VAT charged − recoverable input VAT, by construction
    assert t["net_cost"] == round(t["vat_charged"] - t["recoverable"], 2)
    # non-recoverable jurisdictions (CH / IN modelled) produce a real leakage
    assert t["net_cost"] > 0
