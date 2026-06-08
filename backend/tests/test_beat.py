"""TDD for the BEAT endpoint (routers/beat.py).

The US related-party deductible base is REAL — it is recomputed from ``journal``
on every request — so the critical tests reconcile the endpoint's aggregates
against the raw ``journal`` / ``segment_pl`` sources by construction, and assert
the §59A base-erosion split and threshold test are internally consistent.

Run from `backend/`:  python -m pytest tests/test_beat.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from db import q
from main import app
from routers.beat import (
    BEAT_RATE_PCT,
    BEAT_THRESHOLD_PCT,
    US_PAYER,
    _NON_BASE_ERODING,
)

client = TestClient(app)


def _model(year: int = 2026):
    r = client.get("/api/beat", params={"year": year})
    assert r.status_code == 200
    return r.json()


def test_config_echoed():
    m = _model()
    assert m["year"] == 2026
    assert m["us_payer"] == US_PAYER
    assert m["threshold_pct"] == BEAT_THRESHOLD_PCT
    assert m["beat_rate_pct"] == BEAT_RATE_PCT


def test_related_party_base_equals_journal():
    """The REAL guarantee: related-party deductions equal the raw journal sum of
    US-payer affiliate (RASSC) expense lines (HSL < 0)."""
    m = _model()
    rows = q(
        "SELECT SUM(HSL) AS h FROM journal "
        "WHERE RBUKRS = ? AND GJAHR = 2026 "
        "AND RASSC IS NOT NULL AND RASSC <> '' AND RASSC <> ? AND HSL < 0",
        [US_PAYER, US_PAYER],
    )
    expected = -float(rows[0]["h"])
    assert abs(m["related_party_deductions"] - expected) < 0.01


def test_total_deductions_equals_journal():
    m = _model()
    rows = q(
        "SELECT SUM(HSL) AS h FROM journal WHERE RBUKRS = ? AND GJAHR = 2026 AND HSL < 0",
        [US_PAYER],
    )
    assert abs(m["total_deductions"] - (-float(rows[0]["h"]))) < 0.01


def test_payment_types_partition_related_party():
    """Every related-party dollar is classified into exactly one payment type."""
    m = _model()
    total = sum(p["amount"] for p in m["payment_types"])
    assert abs(total - m["related_party_deductions"]) < 0.01
    assert {p["type"] for p in m["payment_types"]} == {
        "royalties",
        "services",
        "interest",
        "cogs",
        "other",
    }


def test_base_eroding_excludes_cogs():
    """Base-eroding payments = related-party deductions minus the COGS exception,
    and equal the sum of the base-eroding-typed amounts."""
    m = _model()
    assert abs(
        m["base_eroding_payments"]
        - (m["related_party_deductions"] - m["cogs_excluded"])
    ) < 0.01
    by_type = sum(
        p["amount"] for p in m["payment_types"] if p["type"] not in _NON_BASE_ERODING
    )
    assert abs(m["base_eroding_payments"] - by_type) < 0.01
    cogs = next(p for p in m["payment_types"] if p["type"] == "cogs")
    assert cogs["base_eroding"] is False


def test_base_erosion_pct_and_threshold():
    m = _model()
    expected = 100.0 * m["base_eroding_payments"] / m["total_deductions"]
    assert abs(m["base_erosion_pct"] - expected) < 1e-3
    assert m["threshold_met"] == (m["base_erosion_pct"] >= BEAT_THRESHOLD_PCT)


def test_mti_buildup():
    """MTI = regular taxable income + base-eroding add-backs; BEAT base tax applies
    the rate to MTI."""
    m = _model()
    assert abs(
        m["regular_taxable_income"] - (m["gross_receipts"] - m["total_deductions"])
    ) < 0.01
    assert abs(
        m["modified_taxable_income"]
        - (m["regular_taxable_income"] + m["base_eroding_payments"])
    ) < 0.01
    assert abs(
        m["beat_base_tax"] - m["modified_taxable_income"] * BEAT_RATE_PCT / 100.0
    ) < 0.01


def test_by_account_reconciles_to_payment_types():
    """The per-RACCT breakdown sums back to the per-type totals."""
    m = _model()
    by_type: dict[str, float] = {}
    for a in m["by_account"]:
        by_type[a["payment_type"]] = by_type.get(a["payment_type"], 0.0) + a["amount"]
    for p in m["payment_types"]:
        assert abs(p["amount"] - by_type.get(p["type"], 0.0)) < 0.01
        # base_eroding flag is consistent between the two views
        for a in m["by_account"]:
            if a["payment_type"] == p["type"]:
                assert a["base_eroding"] == p["base_eroding"]


def test_schedule_m_reconciles_with_journal_and_segment_pl():
    """OTP-38: per-CFC paid_to + foreign P&L reconcile with the raw sources."""
    m = _model()
    assert len(m["schedule_m"]) > 0
    for s in m["schedule_m"]:
        cfc = s["rbukrs"]
        paid = q(
            "SELECT SUM(CASE WHEN HSL < 0 THEN -HSL ELSE 0 END) AS p FROM journal "
            "WHERE RBUKRS = ? AND GJAHR = 2026 AND RASSC = ?",
            [US_PAYER, cfc],
        )
        assert abs(s["paid_to"] - float(paid[0]["p"])) < 0.01
        pl = q(
            "SELECT SUM(operating_profit) AS op FROM segment_pl "
            "WHERE RBUKRS = ? AND GJAHR = 2026",
            [cfc],
        )
        op = float(pl[0]["op"]) if pl[0]["op"] is not None else 0.0
        assert abs(s["foreign_operating_profit"] - op) < 0.01


def test_empty_year_graceful():
    m = _model(year=1900)
    assert m["related_party_deductions"] == 0.0
    assert m["base_eroding_payments"] == 0.0
    assert m["base_erosion_pct"] == 0.0
    assert m["threshold_met"] is False
    assert m["schedule_m"] == []
