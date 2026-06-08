"""TDD for the CSA endpoint (routers/csa.py).

Every figure is reconciled by construction against /api/segments/pl, so the
critical test is that per-participant revenue and opex_rd are byte-equal to the
segment_pl aggregate for the same RBUKRS.

Run from `backend/`:  python -m pytest tests/test_csa.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from routers.csa import GROWTH, PARTICIPANTS, PCT_MULT

client = TestClient(app)


def _model(year: int = 2026):
    r = client.get("/api/csa", params={"year": year})
    assert r.status_code == 200
    return r.json()


def _segment_aggregate(year: int = 2026) -> dict[str, dict[str, float]]:
    """Sum revenue + opex_rd per RBUKRS straight from /api/segments/pl."""
    agg: dict[str, dict[str, float]] = {}
    for rbukrs in PARTICIPANTS:
        r = client.get("/api/segments/pl", params={"entity": rbukrs, "year": year})
        assert r.status_code == 200
        revenue = sum(float(row["revenue"] or 0) for row in r.json())
        opex_rd = sum(float(row["opex_rd"] or 0) for row in r.json())
        agg[rbukrs] = {"revenue": revenue, "opex_rd": opex_rd}
    return agg


def test_three_participants():
    m = _model()
    assert len(m["participants"]) == 3
    assert {p["rbukrs"] for p in m["participants"]} == set(PARTICIPANTS)


def test_rab_shares_sum_to_one():
    m = _model()
    assert abs(sum(p["rab_share"] for p in m["participants"]) - 1.0) < 1e-6


def test_pool_equals_sum_opex_rd():
    m = _model()
    assert abs(m["pool"] - sum(p["opex_rd"] for p in m["participants"])) < 0.01


def test_true_ups_sum_to_zero():
    m = _model()
    assert abs(sum(p["true_up"] for p in m["participants"])) < 1.0


def test_target_and_true_up_formulas():
    m = _model()
    pool = m["pool"]
    for p in m["participants"]:
        target = p["rab_share"] * pool
        assert abs(p["target_contribution"] - target) < 0.01
        assert abs(p["true_up"] - (target - p["opex_rd"])) < 0.01


def test_pct_buyin_and_platform_value():
    m = _model()
    assert abs(m["platform_value"] - m["pct_mult"] * m["pool"]) < 0.01
    for p in m["participants"]:
        assert abs(p["pct_buyin"] - p["rab_share"] * m["platform_value"]) < 0.01


def test_config_echoed():
    m = _model()
    assert m["growth"] == GROWTH
    assert m["pct_mult"] == PCT_MULT
    assert m["year"] == 2026


def test_reconciles_with_segment_pl():
    """The cross-process guarantee: /api/csa revenue + opex_rd per participant
    equal the segment_pl aggregate for the same RBUKRS."""
    m = _model()
    seg = _segment_aggregate()
    for p in m["participants"]:
        s = seg[p["rbukrs"]]
        assert abs(p["revenue"] - s["revenue"]) < 0.01
        assert abs(p["opex_rd"] - s["opex_rd"]) < 0.01


def test_empty_year_graceful():
    m = _model(year=1900)
    assert m["pool"] == 0.0
    assert m["platform_value"] == 0.0
    assert m["totals"]["true_up"] == 0.0
    assert len(m["participants"]) == 3
    for p in m["participants"]:
        assert p["rab_share"] == 0.0
        assert p["true_up"] == 0.0
