"""TDD for the stewardship endpoint (routers/stewardship.py).

The cost base is REAL — reconciled by construction against /api/segments/pl:
the parents' opex_ga must be byte-equal to the segment_pl aggregate for the same
RBUKRS. The candidate cost lines are FABRICATED; the rollup (excluded total +
adjusted cost base) is what we test here.

Run from `backend/`:  python -m pytest tests/test_stewardship.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from routers.stewardship import BASE_COL, PARENTS

client = TestClient(app)


def _model(year: int = 2026):
    r = client.get("/api/stewardship", params={"year": year})
    assert r.status_code == 200
    return r.json()


def _segment_base(year: int = 2026) -> dict[str, float]:
    """Sum opex_ga per parent straight from /api/segments/pl."""
    agg: dict[str, float] = {}
    for rbukrs in PARENTS:
        r = client.get("/api/segments/pl", params={"entity": rbukrs, "year": year})
        assert r.status_code == 200
        agg[rbukrs] = sum(float(row[BASE_COL] or 0) for row in r.json())
    return agg


def test_parents_and_lines_present():
    m = _model()
    assert {p["rbukrs"] for p in m["parents"]} == set(PARENTS)
    assert len(m["lines"]) >= 5
    # Every line is keyed to a reviewed parent entity.
    assert all(ln["rbukrs"] in PARENTS for ln in m["lines"])


def test_cost_base_reconciles_with_segment_pl():
    """The cross-process guarantee: per-parent cost_base equals the segment_pl
    opex_ga aggregate for the same RBUKRS, and the total is their sum."""
    m = _model()
    seg = _segment_base()
    for p in m["parents"]:
        assert abs(p["cost_base"] - seg[p["rbukrs"]]) < 0.01
    assert abs(m["cost_base"] - sum(seg.values())) < 0.01


def test_excluded_is_sum_of_flagged_lines():
    m = _model()
    expect = sum(ln["amount"] for ln in m["lines"] if ln["stewardship"])
    assert abs(m["excluded"] - expect) < 0.01
    # At least one line is flagged for exclusion (the demo has shareholder costs).
    assert m["excluded"] > 0


def test_candidate_total_is_sum_of_all_lines():
    m = _model()
    expect = sum(ln["amount"] for ln in m["lines"])
    assert abs(m["candidate_total"] - expect) < 0.01


def test_adjusted_cost_base_identity():
    """adjusted_cost_base = cost_base - excluded, exactly."""
    m = _model()
    assert abs(m["adjusted_cost_base"] - (m["cost_base"] - m["excluded"])) < 0.01
    # The exclusion is a real reduction (excluded lies inside the base for 2026).
    assert m["adjusted_cost_base"] < m["cost_base"]


def test_empty_year_zero_base():
    """A year with no segment_pl data has a zero real cost base; the fabricated
    register still rolls up, so the identity must still hold."""
    m = _model(year=1900)
    assert m["cost_base"] == 0.0
    assert all(p["cost_base"] == 0.0 for p in m["parents"])
    assert abs(m["adjusted_cost_base"] - (m["cost_base"] - m["excluded"])) < 0.01
