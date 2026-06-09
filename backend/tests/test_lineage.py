"""TDD for the cross-process lineage primitive (state/lineage.py).

A handoff is just one more audit event on the same record_ref, so it must (a)
appear in the timeline feed in chronological order with the right from/to in
`after`, and (b) leave the hash chain intact.

Run from `backend/`:  python -m pytest tests/test_lineage.py
"""

from __future__ import annotations

import state.audit as audit
import state.lineage as lineage


def test_record_handoff_writes_handoff_event(state_db):
    ev = lineage.record_handoff(
        record_ref="adj:ADJ-1",
        from_process="OTP-20",
        to_process="OTP-16",
        actor="u_maria",
        summary="out-of-range exception handed to adjustment",
    )
    assert ev["event_type"] == "handoff"
    assert ev["process_id"] == "OTP-16"
    assert ev["actor"] == "u_maria"
    assert ev["actor_kind"] == "human"
    assert ev["after"] == {"from": "OTP-20", "to": "OTP-16"}
    assert ev["rationale"] == "out-of-range exception handed to adjustment"


def test_list_handoffs_chronological_with_from_to(state_db):
    lineage.record_handoff(
        record_ref="adj:ADJ-1", from_process="OTP-20", to_process="OTP-16",
        actor="u_maria", summary="flagged then adjusted",
    )
    lineage.record_handoff(
        record_ref="adj:ADJ-1", from_process="OTP-16", to_process="OTP-20",
        actor="u_sam", summary="adjustment approved, looped back to re-validate",
    )

    feed = lineage.list_handoffs("adj:ADJ-1")
    assert len(feed) == 2
    # chronological order (oldest first)
    assert feed[0]["after"] == {"from": "OTP-20", "to": "OTP-16"}
    assert feed[1]["after"] == {"from": "OTP-16", "to": "OTP-20"}
    assert feed[0]["id"] < feed[1]["id"]


def test_handoffs_interleave_with_lifecycle_events(state_db):
    # A lifecycle event and a handoff on the same ref both belong to the timeline.
    audit.record(
        actor="u_maria", actor_kind="human",
        process_id="OTP-16", record_ref="adj:ADJ-9", event_type="submitted",
    )
    lineage.record_handoff(
        record_ref="adj:ADJ-9", from_process="OTP-16", to_process="OTP-20",
        actor="u_sam", summary="approved adjustment now in range",
    )
    feed = lineage.list_handoffs("adj:ADJ-9")
    kinds = [e["event_type"] for e in feed]
    assert kinds == ["submitted", "handoff"]


def test_handoffs_scoped_to_record_ref(state_db):
    lineage.record_handoff(
        record_ref="adj:ADJ-1", from_process="OTP-20", to_process="OTP-16",
        actor="u_maria", summary="a",
    )
    lineage.record_handoff(
        record_ref="adj:ADJ-2", from_process="OTP-20", to_process="OTP-16",
        actor="u_maria", summary="b",
    )
    assert len(lineage.list_handoffs("adj:ADJ-1")) == 1
    assert len(lineage.list_handoffs("adj:ADJ-2")) == 1


def test_handoffs_do_not_break_audit_chain(state_db):
    lineage.record_handoff(
        record_ref="adj:ADJ-1", from_process="OTP-20", to_process="OTP-16",
        actor="u_maria", summary="first",
    )
    lineage.record_handoff(
        record_ref="adj:ADJ-1", from_process="OTP-16", to_process="OTP-20",
        actor="u_sam", summary="second",
    )
    assert audit.verify_chain() == {"ok": True, "broken_at": None}
