"""Withholding tax on IC payments (OTP-46).

GET /api/wht derives the withholdable royalty + service legs from supply_chain
and joins the bilateral treaty-rate seed (served via /api/reference/wht_treaty).

Run from `backend/`:  python -m pytest tests/test_wht.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_wht_treaty_seed_serves_via_reference():
    body = client.get("/api/reference/wht_treaty").json()
    assert "corridors" in body and "default" in body
    # OECD-model-aligned reduced rates: EU / US-treaty source countries at 0%.
    by_src = {c["source"]: c for c in body["corridors"]}
    assert by_src["DE"]["treaty"] == 0.0
    assert by_src["IN"]["treaty"] == 10.0  # statutory fallback corridor (no 0%)
    assert by_src["FR"]["statutory"] > by_src["FR"]["treaty"]


def test_wht_rows_derive_real_base_and_compute_saving():
    body = client.get("/api/wht").json()
    rows = body["rows"]
    assert rows, "expected withholdable IC payment legs from supply_chain"
    # only royalty + service legs carry WHT
    assert {r["payment_type"] for r in rows} <= {"Royalty", "Service"}

    for r in rows:
        # wht_due = gross × treaty_rate; saving = (statutory − treaty) × gross
        assert r["wht_due"] == round(r["gross"] * r["treaty_rate"] / 100.0, 2)
        expected_saving = round(r["gross"] * (r["statutory_rate"] - r["treaty_rate"]) / 100.0, 2)
        assert r["treaty_saving"] == expected_saving
        assert r["statutory_rate"] >= r["treaty_rate"]
        assert r["payer_country"] and r["payee_country"]

    # The real withholdable base: ~$2.3M royalty + ~$14.3M service ≈ $16.6M gross.
    gross = sum(r["gross"] for r in rows)
    assert 16_000_000 < gross < 17_500_000
    royalty_gross = sum(r["gross"] for r in rows if r["payment_type"] == "Royalty")
    assert 2_000_000 < royalty_gross < 2_600_000


def test_wht_totals_reconcile_rows():
    body = client.get("/api/wht").json()
    t = body["totals"]
    rows = body["rows"]
    assert t["corridors"] == len(rows)
    assert t["gross"] == round(sum(r["gross"] for r in rows), 2)
    assert t["wht_due"] == round(sum(r["wht_due"] for r in rows), 2)
    assert t["treaty_saving"] == round(sum(r["treaty_saving"] for r in rows), 2)
    # statutory_due = treaty WHT due + treaty saving (what would be due absent relief)
    assert t["statutory_due"] == round(t["wht_due"] + t["treaty_saving"], 2)
    # treaty relief produces a positive group saving on these corridors
    assert t["treaty_saving"] > 0
