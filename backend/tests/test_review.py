"""TDD for the maker-checker review queue (state/review.py).

Run from `backend/`:  python -m pytest tests/test_review.py
"""

from __future__ import annotations

import pytest

import state.audit as audit
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
