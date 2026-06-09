"""Unit tests for the shared calculation engine (backend/calc/).

Three kernels, three guarantees:
  * warehouse.aggregate matches a hand-written GROUP BY on segment_pl.
  * bands.evaluate_band matches services/status.py:compute_status exactly.
  * allocation.allocate yields shares that sum to 1 and allocations that sum
    to the total.

Run from `backend/`:  python -m pytest tests/test_calc.py
"""

from __future__ import annotations

import pytest

from calc import allocation, bands, warehouse
from db import q
from period_filter import PeriodFilter
from services.status import compute_status

YEAR = 2026


# --- warehouse.aggregate -----------------------------------------------------
def test_aggregate_matches_handwritten_group_by():
    """aggregate(...) reproduces a hand-rolled SUM-by-RBUKRS on segment_pl."""
    parts = ["1000", "3100", "3800"]
    ph = ",".join("?" for _ in parts)
    expected = q(
        f"SELECT RBUKRS, SUM(revenue) AS revenue, SUM(opex_rd) AS opex_rd "
        f"FROM segment_pl WHERE GJAHR = ? AND RBUKRS IN ({ph}) GROUP BY RBUKRS",
        [YEAR, *parts],
    )
    got = warehouse.aggregate(
        "segment_pl",
        ["RBUKRS"],
        ["revenue", "opex_rd"],
        year=YEAR,
        where=f"RBUKRS IN ({ph})",
        params=parts,
    )
    # Re-key by RBUKRS (GROUP BY order is not guaranteed) and compare.
    exp = {str(r["RBUKRS"]): r for r in expected}
    act = {str(r["RBUKRS"]): r for r in got}
    assert exp.keys() == act.keys()
    for rb in exp:
        assert float(exp[rb]["revenue"] or 0) == float(act[rb]["revenue"] or 0)
        assert float(exp[rb]["opex_rd"] or 0) == float(act[rb]["opex_rd"] or 0)


def test_aggregate_with_period_filter_matches():
    """The PeriodFilter path appends GJAHR and produces the same totals."""
    pf = PeriodFilter(year=YEAR)
    got = warehouse.aggregate("segment_pl", ["RBUKRS"], ["revenue"], pf=pf)
    expected = q(
        "SELECT RBUKRS, SUM(revenue) AS revenue FROM segment_pl "
        "WHERE 1=1 AND GJAHR = ? GROUP BY RBUKRS",
        [YEAR],
    )
    exp = {str(r["RBUKRS"]): float(r["revenue"] or 0) for r in expected}
    act = {str(r["RBUKRS"]): float(r["revenue"] or 0) for r in got}
    assert exp == act


def test_aggregate_expression_measure():
    """An (expr, alias) measure supports conditional sums and COUNT(*)."""
    got = warehouse.aggregate(
        "journal",
        ["RBUKRS"],
        [("SUM(CASE WHEN HSL < 0 THEN -HSL ELSE 0 END)", "deductions"), ("COUNT(*)", "n")],
        year=YEAR,
        where="RBUKRS = ?",
        params=["1000"],
    )
    expected = q(
        "SELECT RBUKRS, SUM(CASE WHEN HSL < 0 THEN -HSL ELSE 0 END) AS deductions, "
        "COUNT(*) AS n FROM journal WHERE GJAHR = ? AND RBUKRS = ? GROUP BY RBUKRS",
        [YEAR, "1000"],
    )
    assert len(got) == len(expected) == 1
    assert float(got[0]["deductions"]) == float(expected[0]["deductions"])
    assert int(got[0]["n"]) == int(expected[0]["n"])


# --- bands.evaluate_band -----------------------------------------------------
@pytest.mark.parametrize(
    "actual,low,high",
    [
        (None, 0.04, 0.06),       # no-data
        (0.05, 0.04, 0.06),       # in-range
        (0.07, 0.04, 0.06),       # watch
        (0.12, 0.04, 0.06),       # out-of-range
        (0.005, 0.0, 0.0),        # financing entity in-range
        (0.05, 0.0, 0.0),         # financing entity out-of-range
        (0.03, 0.04, 0.06),       # below band
    ],
)
def test_evaluate_band_matches_compute_status(actual, low, high):
    assert bands.evaluate_band(actual, low, high) == compute_status(actual, low, high)


def test_benchmark_band_reads_seed():
    band = bands.benchmark_band("BM-LRD")
    assert band is not None
    assert band["lower"] == 2.0 and band["upper"] == 4.0
    assert bands.benchmark_band("NOPE") is None


# --- allocation.allocate -----------------------------------------------------
def test_rab_share_sums_to_one_and_allocations_sum_to_total():
    rows = [
        {"projected_sales": 600.0},
        {"projected_sales": 300.0},
        {"projected_sales": 100.0},
    ]
    pool = 250.0
    res = allocation.allocate(rows, "rab_share", total=pool)
    assert abs(sum(r["share"] for r in res) - 1.0) < 1e-12
    assert abs(sum(r["allocated"] for r in res) - pool) < 1e-9
    assert abs(res[0]["share"] - 0.6) < 1e-12
    assert abs(res[0]["allocated"] - 0.6 * pool) < 1e-9


def test_value_driver_split_sums_to_one_and_total():
    rows = [{"key_value": 40.0}, {"key_value": 60.0}]
    combined = 1000.0
    res = allocation.allocate(rows, "value_driver", total=combined)
    assert abs(sum(r["share"] for r in res) - 1.0) < 1e-12
    assert abs(sum(r["allocated"] for r in res) - combined) < 1e-9


def test_allocate_zero_basis_is_graceful():
    """When the basis total is zero, every share/allocation is 0 (no div-by-0)."""
    rows = [{"projected_sales": 0.0}, {"projected_sales": 0.0}]
    res = allocation.allocate(rows, "rab_share", total=500.0)
    assert all(r["share"] == 0.0 and r["allocated"] == 0.0 for r in res)


def test_allocate_measure_override():
    rows = [{"x": 1.0}, {"x": 3.0}]
    res = allocation.allocate(rows, "value_driver", total=8.0, measure="x")
    assert abs(res[0]["share"] - 0.25) < 1e-12
    assert abs(res[1]["allocated"] - 6.0) < 1e-9


def test_allocate_unknown_basis_raises():
    with pytest.raises(ValueError):
        allocation.allocate([{"projected_sales": 1.0}], "bogus", total=1.0)
