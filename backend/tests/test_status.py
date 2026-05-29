"""Unit tests for compute_status — the TP-band status classifier.

Run from `backend/`:  python -m pytest tests/test_status.py
"""

from __future__ import annotations

from services.status import compute_status


def test_no_data_when_margin_is_none():
    # An entity with no P&L data for the period is unknown, not healthy.
    assert compute_status(None, 0.04, 0.06) == ("no-data", None)


def test_no_data_for_financing_entity_with_no_margin():
    # None short-circuits before the financing-entity (0–0) branch.
    assert compute_status(None, 0.0, 0.0) == ("no-data", None)


def test_in_range_inside_band():
    assert compute_status(0.05, 0.04, 0.06) == ("in-range", 0.0)


def test_watch_just_outside_band():
    # band 4–6% (width 2pp); 1.5*width = 3pp tolerance. 7% is 1pp over.
    assert compute_status(0.07, 0.04, 0.06) == ("watch", 1.0)


def test_out_of_range_far_outside_band():
    # 12% is 6pp over the 6% ceiling — beyond the 3pp watch tolerance.
    assert compute_status(0.12, 0.04, 0.06) == ("out-of-range", 6.0)


def test_financing_entity_in_range_within_tolerance():
    assert compute_status(0.005, 0.0, 0.0) == ("in-range", 0.0)


def test_financing_entity_out_of_range():
    status, _ = compute_status(0.05, 0.0, 0.0)
    assert status == "out-of-range"
