"""TDD for the SQLite-backed persistence store (persistence/overrides.py).

Behavior is preserved verbatim from the old JSON store (the routers must not
notice the swap); every mutation now ALSO writes an audit event.

Run from `backend/`:  python -m pytest tests/test_overrides_store.py
"""

from __future__ import annotations

import json

import pytest

import state.audit as audit
from persistence import overrides as store


def test_submit_adjustment_creates_pending_record(state_db):
    rec = store.submit_adjustment({"entityId": "3000", "amount": 1000.0, "currency": "EUR"})
    assert rec["id"].startswith("ADJ-")
    assert rec["status"] == "Pending Approval"
    assert "submittedAt" in rec
    assert rec["entityId"] == "3000"
    listed = store.list_adjustments()
    assert len(listed) == 1 and listed[0]["id"] == rec["id"]


def test_submit_adjustment_writes_audit_event(state_db):
    rec = store.submit_adjustment({"entityId": "3000", "amount": 1000.0})
    events = audit.list_events(record_ref=f"adj:{rec['id']}")
    assert any(e["event_type"] == "created" for e in events)


def test_update_adjustment_to_approved_logs_audit(state_db):
    rec = store.submit_adjustment({"entityId": "3000", "amount": 1000.0})
    updated = store.update_adjustment(rec["id"], {"status": "Approved", "approvedBy": "u_sam", "by": "u_sam"})
    assert updated["status"] == "Approved"
    assert updated["approvedBy"] == "u_sam"
    assert "updatedAt" in updated
    events = audit.list_events(record_ref=f"adj:{rec['id']}")
    assert any(e["event_type"] == "approved" and e["actor"] == "u_sam" for e in events)


def test_update_adjustment_invalid_status_raises(state_db):
    rec = store.submit_adjustment({"entityId": "3000", "amount": 1.0})
    with pytest.raises(ValueError):
        store.update_adjustment(rec["id"], {"status": "Bogus"})


def test_update_unknown_adjustment_returns_none(state_db):
    assert store.update_adjustment("ADJ-NOPE", {"status": "Approved"}) is None


def test_delete_only_when_pending(state_db):
    approved = store.submit_adjustment({"entityId": "3000", "amount": 1.0})
    store.update_adjustment(approved["id"], {"status": "Approved"})
    assert store.delete_adjustment(approved["id"]) is False

    pending = store.submit_adjustment({"entityId": "3100", "amount": 2.0})
    assert store.delete_adjustment(pending["id"]) is True
    assert all(a["id"] != pending["id"] for a in store.list_adjustments())


def test_reverse_adjustment_creates_counter_and_marks_original(state_db):
    rec = store.submit_adjustment({"entityId": "3000", "amount": 1000.0, "currency": "EUR"})
    counter = store.reverse_adjustment(rec["id"], by="u_sam")
    assert counter["amount"] == -1000.0
    assert counter["reversesId"] == rec["id"]
    original = next(a for a in store.list_adjustments() if a["id"] == rec["id"])
    assert original["status"] == "Reversed"
    assert original["reversedById"] == counter["id"]
    events = audit.list_events(record_ref=f"adj:{rec['id']}")
    assert any(e["event_type"] == "reversed" for e in events)


def test_double_reverse_returns_none(state_db):
    rec = store.submit_adjustment({"entityId": "3000", "amount": 1000.0})
    store.reverse_adjustment(rec["id"])
    assert store.reverse_adjustment(rec["id"]) is None


def test_policy_override_upsert_and_list(state_db):
    store.upsert_policy_override("CHAIN-014", {"tpMethod": "CUP", "reviewer": "u_sam"})
    ov = store.list_policy_overrides()
    assert "CHAIN-014" in ov
    assert ov["CHAIN-014"]["tpMethod"] == "CUP"
    assert ov["CHAIN-014"]["flowId"] == "CHAIN-014"
    store.upsert_policy_override("CHAIN-014", {"tpMethod": "TNMM"})
    assert store.list_policy_overrides()["CHAIN-014"]["tpMethod"] == "TNMM"


def test_settings_defaults_and_update(state_db):
    s = store.get_settings()
    assert s["companyName"] == "Aperture Tax"
    assert s["defaultCurrency"] == "USD"
    updated = store.update_settings({"companyName": "PharmaCo"})
    assert updated["companyName"] == "PharmaCo"
    assert updated["defaultCurrency"] == "USD"  # untouched default preserved
    assert store.get_settings()["companyName"] == "PharmaCo"


def test_import_legacy_json(state_db, tmp_path):
    legacy = {
        "adjustments": [
            {"id": "ADJ-OLD1", "status": "Approved", "amount": 5.0, "submittedAt": "2026-01-01T00:00:00Z"}
        ],
        "policy_overrides": {"CHAIN-001": {"tpMethod": "RPM", "flowId": "CHAIN-001", "updatedAt": "x"}},
        "settings": {"companyName": "Legacy Inc", "defaultCurrency": "GBP", "defaultReviewer": "x", "notifyOnDeviation": False},
    }
    p = tmp_path / "overrides.json"
    p.write_text(json.dumps(legacy))
    store.import_legacy_json(p)
    assert any(a["id"] == "ADJ-OLD1" for a in store.list_adjustments())
    assert "CHAIN-001" in store.list_policy_overrides()
    assert store.get_settings()["companyName"] == "Legacy Inc"
    assert audit.list_events(record_ref="adj:ADJ-OLD1")  # genesis event backfilled
