"""TDD for workflow drafts (state/drafts.py) — autosave + leave-and-return.

Run from `backend/`:  python -m pytest tests/test_drafts.py
"""

from __future__ import annotations

import state.drafts as drafts


def test_upsert_creates_and_get_returns(state_db):
    d = drafts.upsert(
        user_id="u_maria", process_id="OTP-16", record_ref="RBUKRS:3000",
        step="quantify", step_index=2, payload={"gap": 1.5},
    )
    got = drafts.get(user_id="u_maria", process_id="OTP-16", record_ref="RBUKRS:3000")
    assert got is not None
    assert got["id"] == d["id"]
    assert got["step"] == "quantify"
    assert got["step_index"] == 2
    assert got["payload"] == {"gap": 1.5}


def test_upsert_is_idempotent_per_user_process_record(state_db):
    drafts.upsert(user_id="u_maria", process_id="OTP-16", record_ref="RBUKRS:3000",
                  step="pull", step_index=0, payload={})
    drafts.upsert(user_id="u_maria", process_id="OTP-16", record_ref="RBUKRS:3000",
                  step="review", step_index=4, payload={"x": 1})
    items = drafts.list_for_user("u_maria")
    assert len(items) == 1
    assert items[0]["step"] == "review"
    assert items[0]["step_index"] == 4


def test_list_for_user_scopes_to_user(state_db):
    drafts.upsert(user_id="u_maria", process_id="OTP-16", record_ref="RBUKRS:3000",
                  step="pull", step_index=0, payload={})
    drafts.upsert(user_id="u_sam", process_id="OTP-9", record_ref="chain:CHAIN-014",
                  step="stage", step_index=1, payload={})
    mine = drafts.list_for_user("u_maria")
    assert len(mine) == 1
    assert mine[0]["process_id"] == "OTP-16"


def test_delete_removes_draft(state_db):
    d = drafts.upsert(user_id="u_maria", process_id="OTP-16", record_ref="RBUKRS:3000",
                      step="pull", step_index=0, payload={})
    assert drafts.delete(d["id"]) is True
    assert drafts.get(user_id="u_maria", process_id="OTP-16", record_ref="RBUKRS:3000") is None
