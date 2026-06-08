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


def test_unknown_reference_404():
    assert client.get("/api/reference/nope").status_code == 404
