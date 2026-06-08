"""TDD for the Latest-Estimate forecast endpoint (routers/forecast.py, OTP-24).

The LE is derived from real ``segment_pl`` actuals via run-rate — there is no
seeded budget — so the critical guarantees are:
  * the full-year LE = actuals_to_date + run-rate remainder (formula holds),
  * with a full 12-month year the remainder is zero and LE reconciles
    byte-for-byte with the /api/segments/pl aggregate, and
  * the projected status matches the shared band rule used by OTP-20.

Run from `backend/`:  python -m pytest tests/test_forecast.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from routers.forecast import FULL_YEAR_MONTHS
from services.status import compute_status

client = TestClient(app)


def _model(year: int = 2026):
    r = client.get("/api/forecast", params={"year": year})
    assert r.status_code == 200
    return r.json()


def _segment_aggregate(year: int = 2026) -> dict[str, dict[str, float]]:
    """Sum revenue + operating_profit per RBUKRS straight from /api/segments/pl."""
    r = client.get("/api/segments/pl", params={"year": year})
    assert r.status_code == 200
    agg: dict[str, dict[str, float]] = {}
    for row in r.json():
        a = agg.setdefault(row["RBUKRS"], {"revenue": 0.0, "operating_profit": 0.0})
        a["revenue"] += float(row["revenue"] or 0)
        a["operating_profit"] += float(row["operating_profit"] or 0)
    return agg


def test_shape_and_basis():
    m = _model()
    assert m["year"] == 2026
    assert m["fullYearMonths"] == FULL_YEAR_MONTHS == 12
    assert m["basis"] == "run-rate"
    assert isinstance(m["parties"], list) and m["parties"]


def test_covers_all_tested_parties():
    """One row per entity_roles tested party (8 in the dataset)."""
    m = _model()
    assert len(m["parties"]) == 8
    for p in m["parties"]:
        assert {"rbukrs", "name", "actuals", "forecastRemainder",
                "latestEstimate", "fullYearMargin", "status",
                "targetMarginLabel"} <= set(p)


def test_le_equals_actuals_plus_remainder():
    """Latest Estimate is exactly actuals-to-date + the run-rate remainder."""
    m = _model()
    for p in m["parties"]:
        for k in ("revenue", "operating_profit"):
            le = p["latestEstimate"][k]
            expected = p["actuals"][k] + p["forecastRemainder"][k]
            assert abs(le - expected) < 0.01


def test_run_rate_remainder_formula():
    """Remainder = (actuals / months_posted) * months_remaining; and
    months_posted + months_remaining == 12 whenever any month is posted."""
    m = _model()
    for p in m["parties"]:
        posted = p["monthsPosted"]
        remaining = p["monthsRemaining"]
        if posted == 0:
            assert p["forecastRemainder"]["revenue"] == 0.0
            assert p["forecastRemainder"]["operating_profit"] == 0.0
            continue
        assert posted + remaining == FULL_YEAR_MONTHS
        for k in ("revenue", "operating_profit"):
            expected = p["actuals"][k] / posted * remaining
            assert abs(p["forecastRemainder"][k] - expected) < 0.5


def test_reconciles_with_segment_pl_on_full_year():
    """With all 12 months posted the remainder is zero, so the full-year LE
    must equal the segment_pl aggregate per entity (derived, not seeded)."""
    m = _model()
    seg = _segment_aggregate()
    for p in m["parties"]:
        assert p["monthsPosted"] == 12 and p["monthsRemaining"] == 0
        s = seg.get(p["rbukrs"])
        assert s is not None
        assert abs(p["latestEstimate"]["revenue"] - s["revenue"]) < 0.01
        assert abs(p["latestEstimate"]["operating_profit"] - s["operating_profit"]) < 0.01


def test_full_year_margin_is_le_profit_over_le_revenue():
    m = _model()
    for p in m["parties"]:
        le = p["latestEstimate"]
        if le["revenue"]:
            expected = le["operating_profit"] / le["revenue"] * 100
            assert abs(p["fullYearMargin"] - expected) < 0.01
        else:
            assert p["fullYearMargin"] is None


def test_projected_status_matches_band_rule():
    """The early-warning verdict equals services.status.compute_status applied
    to the full-year LE margin against the entity's band — same as OTP-20."""
    m = _model()
    for p in m["parties"]:
        low = p["targetMarginLow"] / 100
        high = p["targetMarginHigh"] / 100
        margin = p["fullYearMargin"] / 100 if p["fullYearMargin"] is not None else None
        status, _ = compute_status(margin, low, high)
        assert p["status"] == status


def test_empty_year_graceful():
    m = _model(year=1900)
    assert len(m["parties"]) == 8
    for p in m["parties"]:
        assert p["monthsPosted"] == 0
        assert p["latestEstimate"] == {"revenue": 0.0, "operating_profit": 0.0}
        assert p["fullYearMargin"] is None
        assert p["status"] == "no-data"
