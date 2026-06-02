"""TDD for the append-only, hash-chained audit stream (state/audit.py).

Run from `backend/`:  python -m pytest tests/test_audit_chain.py
"""

from __future__ import annotations

import json

import pytest

import state.audit as audit
from state.engine import get_conn

GENESIS = "0" * 64


def test_first_event_links_to_genesis(state_db):
    ev = audit.record(
        actor="u_maria", actor_kind="human", record_ref="adj:ADJ-1",
        event_type="created", process_id="OTP-16", after={"amount": 100},
    )
    assert ev["prev_hash"] == GENESIS
    assert len(ev["hash"]) == 64
    assert ev["id"] >= 1


def test_second_event_chains_to_first(state_db):
    e1 = audit.record(actor="u_maria", actor_kind="human", record_ref="adj:ADJ-1", event_type="created")
    e2 = audit.record(actor="u_sam", actor_kind="human", record_ref="adj:ADJ-1", event_type="approved")
    assert e2["prev_hash"] == e1["hash"]
    assert e2["hash"] != e1["hash"]


def test_list_events_filters_by_record_ref(state_db):
    audit.record(actor="u_maria", actor_kind="human", record_ref="adj:ADJ-1", event_type="created")
    audit.record(actor="u_maria", actor_kind="human", record_ref="adj:ADJ-2", event_type="created")
    evs = audit.list_events(record_ref="adj:ADJ-1")
    assert len(evs) == 1
    assert evs[0]["record_ref"] == "adj:ADJ-1"


def test_verify_chain_ok_for_untampered_stream(state_db):
    for i in range(3):
        audit.record(actor="u_maria", actor_kind="human", record_ref=f"adj:ADJ-{i}", event_type="created")
    assert audit.verify_chain() == {"ok": True, "broken_at": None}


def test_verify_chain_detects_tampering(state_db):
    audit.record(
        actor="u_maria", actor_kind="human", record_ref="adj:ADJ-1",
        event_type="created", after={"amount": 100},
    )
    e2 = audit.record(
        actor="u_sam", actor_kind="human", record_ref="adj:ADJ-1",
        event_type="posted", after={"amount": 100},
    )
    # Tamper: rewrite a stored field without recomputing its hash.
    conn = get_conn()
    conn.execute(
        "UPDATE audit_events SET after_json = ? WHERE id = ?",
        (json.dumps({"amount": 999999}), e2["id"]),
    )
    conn.commit()
    result = audit.verify_chain()
    assert result["ok"] is False
    assert result["broken_at"] == e2["id"]


def test_assistant_actor_kind_is_allowed(state_db):
    ev = audit.record(
        actor="research-brain", actor_kind="assistant", record_ref="adj:ADJ-1",
        event_type="prepared", rationale="pulled 3,147 SAP/ACDOCA lines",
    )
    assert ev["actor_kind"] == "assistant"
    assert ev["rationale"] == "pulled 3,147 SAP/ACDOCA lines"


def test_invalid_actor_kind_rejected(state_db):
    with pytest.raises(ValueError):
        audit.record(actor="x", actor_kind="robot", record_ref="adj:ADJ-1", event_type="created")
