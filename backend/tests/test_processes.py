"""Tests for the process catalog endpoint.

Run from `backend/`:  python -m pytest tests/test_processes.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_lists_all_fifty_processes():
    body = client.get("/api/processes").json()
    procs = body["processes"]
    assert len(procs) == 50
    # exact category counts from the spec
    counts: dict[str, int] = {}
    for p in procs:
        counts[p["category"]] = counts.get(p["category"], 0) + 1
    assert counts == {"A": 9, "B": 9, "C": 4, "D": 6, "E": 6, "F": 12, "G": 4}


def test_overlay_marks_top15_and_applicability():
    procs = {p["id"]: p for p in client.get("/api/processes").json()["processes"]}
    assert procs["OTP-9"]["top15"] is True
    assert procs["OTP-1"]["top15"] is False
    assert procs["OTP-7"]["pharmaApplicability"] == "M"
    assert procs["OTP-3"]["pharmaApplicability"] == "H"


def test_get_single_process_and_404():
    assert client.get("/api/processes/OTP-20").json()["name"] == "Operating margin monitoring"
    assert client.get("/api/processes/OTP-999").status_code == 404
