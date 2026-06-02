"""API tests for the Phase 2 state endpoints (audit, drafts, review, evidence).

Run from `backend/`:  python -m pytest tests/test_state_endpoints.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_draft_put_then_get_and_list(state_db):
    body = {
        "user_id": "u_maria", "process_id": "OTP-16", "record_ref": "RBUKRS:3000",
        "step": "quantify", "step_index": 2, "payload": {"gap": 1.5},
    }
    assert client.put("/api/drafts", json=body).status_code == 200
    got = client.get("/api/drafts/OTP-16/RBUKRS:3000", params={"user_id": "u_maria"})
    assert got.status_code == 200
    assert got.json()["step"] == "quantify"
    assert got.json()["payload"] == {"gap": 1.5}
    listed = client.get("/api/drafts", params={"user_id": "u_maria"}).json()
    assert len(listed) == 1


def test_draft_get_missing_404(state_db):
    r = client.get("/api/drafts/OTP-16/RBUKRS:9999", params={"user_id": "u_maria"})
    assert r.status_code == 404


def test_review_enqueue_approve_logs_audit(state_db):
    item = client.post(
        "/api/review-queue",
        json={"process_id": "OTP-16", "record_ref": "adj:ADJ-1", "maker": "u_maria"},
    ).json()
    assert item["status"] == "pending"
    assert len(client.get("/api/review-queue").json()) == 1

    decided = client.post(f"/api/review/{item['id']}/approve", json={"checker": "u_sam"})
    assert decided.status_code == 200
    assert decided.json()["status"] == "approved"

    events = client.get("/api/audit", params={"record_ref": "adj:ADJ-1"}).json()
    assert any(e["event_type"] == "approved" and e["actor"] == "u_sam" for e in events)
    assert client.get("/api/audit/verify").json()["ok"] is True


def test_review_self_approval_blocked_409(state_db):
    item = client.post(
        "/api/review-queue",
        json={"process_id": "OTP-16", "record_ref": "adj:ADJ-2", "maker": "u_maria"},
    ).json()
    r = client.post(f"/api/review/{item['id']}/approve", json={"checker": "u_maria"})
    assert r.status_code == 409


def test_reject_requires_comment_409(state_db):
    item = client.post(
        "/api/review-queue",
        json={"process_id": "OTP-16", "record_ref": "adj:ADJ-3", "maker": "u_maria"},
    ).json()
    r = client.post(f"/api/review/{item['id']}/reject", json={"checker": "u_sam"})
    assert r.status_code == 409


def test_evidence_packet(state_db):
    item = client.post(
        "/api/review-queue",
        json={"process_id": "OTP-16", "record_ref": "adj:ADJ-9", "maker": "u_maria"},
    ).json()
    client.post(f"/api/review/{item['id']}/approve", json={"checker": "u_sam"})
    packet = client.get("/api/evidence/adj:ADJ-9").json()
    assert packet["record_ref"] == "adj:ADJ-9"
    assert any(e["event_type"] == "approved" for e in packet["events"])
    assert packet["verify"]["ok"] is True
    assert isinstance(packet["diffs"], list) and isinstance(packet["postings"], list)


def test_evidence_packet_with_real_adjustment(state_db):
    from persistence import overrides as store

    adj = store.submit_adjustment({"entityId": "1000", "entityName": "US IP Principal Co.", "amount": -1000000.0, "currency": "USD"})
    client.post("/api/review-queue", json={"process_id": "OTP-16", "record_ref": f"adj:{adj['id']}", "maker": "u_maria"})
    packet = client.get(f"/api/evidence/adj:{adj['id']}").json()
    assert packet["subject"]  # resolved entity/adjustment label
    assert packet["postings"]  # entity 1000 has ACDOCA postings
    assert packet["diffs"]  # the created event carries field changes
