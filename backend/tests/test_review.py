"""TDD for the maker-checker review queue (state/review.py).

Run from `backend/`:  python -m pytest tests/test_review.py
"""

from __future__ import annotations

import pytest

import persistence.overrides as overrides
import state.audit as audit
import state.lineage as lineage
import state.review as review


def test_create_item_enqueues_pending(state_db):
    item = review.create_item(process_id="OTP-16", record_ref="adj:ADJ-1", maker="u_maria")
    assert item["status"] == "pending"
    assert item["maker"] == "u_maria"
    assert len(review.list_queue()) == 1


def test_decide_approve_by_other_user_logs_audit(state_db):
    item = review.create_item(process_id="OTP-16", record_ref="adj:ADJ-1", maker="u_maria")
    decided = review.decide(item["id"], checker="u_sam", decision="approve")
    assert decided["status"] == "approved"
    assert decided["checker"] == "u_sam"
    assert decided["decided_at"]
    events = audit.list_events(record_ref="adj:ADJ-1")
    assert any(e["event_type"] == "approved" and e["actor"] == "u_sam" for e in events)


def test_decide_rejects_self_approval(state_db):
    item = review.create_item(process_id="OTP-16", record_ref="adj:ADJ-1", maker="u_maria")
    with pytest.raises(ValueError):
        review.decide(item["id"], checker="u_maria", decision="approve")


def test_decide_rejects_assistant_as_checker(state_db):
    item = review.create_item(process_id="OTP-16", record_ref="adj:ADJ-1", maker="u_maria")
    with pytest.raises(ValueError):
        review.decide(item["id"], checker=audit.ASSISTANT_ACTOR, decision="approve")


def test_reject_requires_comment(state_db):
    item = review.create_item(process_id="OTP-16", record_ref="adj:ADJ-1", maker="u_maria")
    with pytest.raises(ValueError):
        review.decide(item["id"], checker="u_sam", decision="reject")
    decided = review.decide(item["id"], checker="u_sam", decision="reject", comments="out of range")
    assert decided["status"] == "rejected"


def test_create_item_logs_submitted_event(state_db):
    review.create_item(process_id="OTP-16", record_ref="adj:ADJ-5", maker="u_maria")
    events = audit.list_events(record_ref="adj:ADJ-5")
    assert any(e["event_type"] == "submitted" and e["actor"] == "u_maria" for e in events)


def test_approving_adjustment_loops_back_to_monitoring(state_db):
    # Loop 1.1 — approving an adj:* review item hands the record back to OTP-20
    # (re-validate monitoring) as one more handoff event on the same record_ref.
    adj = overrides.submit_adjustment(
        {"entityId": "E1", "entityName": "Acme DE", "amount": 250000.0,
         "currency": "USD", "mode": "median", "targetMargin": 5.0, "actualMargin": 2.0,
         "submittedBy": "u_maria"}
    )
    ref = f"adj:{adj['id']}"
    item = review.create_item(process_id="OTP-16", record_ref=ref, maker="u_maria")
    review.decide(item["id"], checker="u_sam", decision="approve")

    handoffs = lineage.list_handoffs(ref)
    hop = next(h for h in handoffs if h["event_type"] == "handoff")
    assert hop["actor"] == "u_sam"
    assert hop["after"]["from"] == "OTP-16"
    assert hop["after"]["to"] == "OTP-20"

    # The adjustment itself is promoted to Approved, and the hash chain still verifies.
    promoted = next(a for a in overrides.list_adjustments() if a["id"] == adj["id"])
    assert promoted["status"] == "Approved"
    assert promoted["approvedBy"] == "u_sam"
    assert audit.verify_chain()["ok"]


def test_rejecting_does_not_loop_forward_to_monitoring(state_db):
    # Loop 1.2 — a rejection returns the work to its *originating* process, never
    # forward to OTP-20 (that hand-back is reserved for approvals).
    adj = overrides.submit_adjustment(
        {"entityId": "E2", "entityName": "Acme FR", "amount": -100000.0,
         "currency": "USD", "mode": "median", "targetMargin": 5.0, "actualMargin": 9.0,
         "submittedBy": "u_maria"}
    )
    ref = f"adj:{adj['id']}"
    item = review.create_item(process_id="OTP-16", record_ref=ref, maker="u_maria")
    review.decide(item["id"], checker="u_sam", decision="reject", comments="benchmark stale")
    assert not any((h.get("after") or {}).get("to") == "OTP-20" for h in lineage.list_handoffs(ref))


def test_rejecting_returns_to_originating_process(state_db):
    # Loop 1.2 — rejecting a review item writes one handoff that loops the record
    # back to the process that submitted it (from == to), carrying the comment, so
    # the maker is guided to where the fix belongs. It rides the same audit chain.
    item = review.create_item(process_id="OTP-3", record_ref="OTP3-royalty-API", maker="u_maria")
    review.decide(item["id"], checker="u_sam", decision="reject", comments="band looks stale")

    handoffs = lineage.list_handoffs("OTP3-royalty-API")
    hop = next(h for h in handoffs if h["event_type"] == "handoff")
    assert hop["actor"] == "u_sam"
    assert hop["after"]["from"] == "OTP-3"
    assert hop["after"]["to"] == "OTP-3"
    assert "band looks stale" in hop["rationale"]
    assert audit.verify_chain()["ok"]
