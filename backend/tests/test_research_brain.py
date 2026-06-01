"""Tests for the Research Brain prepare endpoint (the visible, audited hand-off).

Phase 2 ships a scripted prepare; Phase 3 wires real Claude + researchbrain.

Run from `backend/`:  python -m pytest tests/test_research_brain.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_prepare_logs_assisted_event(state_db):
    r = client.post(
        "/api/research-brain/prepare",
        json={"process_id": "OTP-16", "record_ref": "OTP16-3000", "gap_pp": -5.2, "postings": 3147},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["summary"]
    assert body["actor"] == "research-brain"

    events = client.get("/api/audit", params={"process_id": "OTP-16"}).json()
    prepared = [e for e in events if e["event_type"] == "prepared"]
    assert prepared, "expected a prepared event"
    assert prepared[0]["actor_kind"] == "assistant"
    assert prepared[0]["actor"] == "research-brain"
