"""TDD for the profit-split endpoint (routers/csa.py :: /api/profit-split).

The residual profit-split allocates the combined operating profit of the
non-routine parties by a selectable value-driver key. Like /api/csa, every
figure aggregates the same segment_pl source, so per-participant operating_profit
is reconciled by construction against /api/segments/pl.

Run from `backend/`:  python -m pytest tests/test_profit_split.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from routers.csa import PS_DEFAULT_KEY, PS_KEYS, PS_PARTICIPANTS

client = TestClient(app)


def _model(year: int = 2026, key: str | None = None):
    params: dict[str, object] = {"year": year}
    if key is not None:
        params["key"] = key
    r = client.get("/api/profit-split", params=params)
    assert r.status_code == 200
    return r.json()


def _segment_operating_profit(year: int = 2026) -> dict[str, float]:
    """Sum operating_profit per RBUKRS straight from /api/segments/pl."""
    agg: dict[str, float] = {}
    for rbukrs in PS_PARTICIPANTS:
        r = client.get("/api/segments/pl", params={"entity": rbukrs, "year": year})
        assert r.status_code == 200
        agg[rbukrs] = sum(float(row["operating_profit"] or 0) for row in r.json())
    return agg


def test_three_participants():
    m = _model()
    assert len(m["participants"]) == 3
    assert {p["rbukrs"] for p in m["participants"]} == set(PS_PARTICIPANTS)


def test_default_key_is_opex_rd():
    m = _model()
    assert m["key"] == PS_DEFAULT_KEY == "opex_rd"
    assert m["default_key"] == "opex_rd"
    assert m["keys"] == list(PS_KEYS)


def test_shares_sum_to_one():
    for key in PS_KEYS:
        m = _model(key=key)
        assert abs(sum(p["residual_share"] for p in m["participants"]) - 1.0) < 1e-6


def test_allocation_sums_to_combined_profit():
    """Σ allocated_profit == combined_profit (the allocation is exhaustive)."""
    for key in PS_KEYS:
        m = _model(key=key)
        allocated = sum(p["allocated_profit"] for p in m["participants"])
        assert abs(allocated - m["combined_profit"]) < 1.0


def test_true_ups_sum_to_zero():
    """Σ true_up == 0: nobody's allocation is created or destroyed in aggregate."""
    for key in PS_KEYS:
        m = _model(key=key)
        assert abs(sum(p["true_up"] for p in m["participants"])) < 1.0


def test_share_and_allocation_formulas():
    m = _model()
    key_total = m["key_total"]
    combined = m["combined_profit"]
    for p in m["participants"]:
        share = p["key_value"] / key_total
        assert abs(p["residual_share"] - share) < 1e-9
        assert abs(p["allocated_profit"] - share * combined) < 0.01
        assert abs(p["true_up"] - (p["allocated_profit"] - p["operating_profit"])) < 0.01


def test_key_toggle_changes_allocation():
    """The two keys allocate differently — the toggle is meaningful."""
    rd = {p["rbukrs"]: p["allocated_profit"] for p in _model(key="opex_rd")["participants"]}
    sga = {p["rbukrs"]: p["allocated_profit"] for p in _model(key="sga")["participants"]}
    assert any(abs(rd[k] - sga[k]) > 1.0 for k in rd)


def test_bad_key_falls_back_to_default():
    m = _model(key="bogus")
    assert m["key"] == PS_DEFAULT_KEY


def test_combined_profit_reconciles_with_segment_pl():
    """Cross-process guarantee: per-participant operating_profit equals the
    segment_pl aggregate for the same RBUKRS, and the combined total matches."""
    m = _model()
    seg = _segment_operating_profit()
    for p in m["participants"]:
        assert abs(p["operating_profit"] - seg[p["rbukrs"]]) < 0.01
    assert abs(m["combined_profit"] - sum(seg.values())) < 0.01


def test_empty_year_graceful():
    m = _model(year=1900)
    assert m["combined_profit"] == 0.0
    assert m["key_total"] == 0.0
    assert m["totals"]["true_up"] == 0.0
    assert len(m["participants"]) == 3
    for p in m["participants"]:
        assert p["residual_share"] == 0.0
        assert p["allocated_profit"] == 0.0
        assert p["true_up"] == 0.0
