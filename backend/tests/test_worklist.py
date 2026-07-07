"""TDD for the unified worklist / Inbox aggregator (routers/worklist.py).

Seeds a draft + a pending review + an open case in the isolated state DB, then
asserts the aggregator surfaces each kind with a deep-link route. The OTP-20
exception kind is data-dependent (it reads the warehouse), so it is exercised
but not required to be non-empty.

Run from `backend/`:  python -m pytest tests/test_worklist.py
"""

from __future__ import annotations

import state.cases as cases
import state.drafts as drafts
import state.review as review
from routers.worklist import build_worklist


def _seed(user: str = "u_maria") -> None:
    drafts.upsert(
        user_id=user, process_id="OTP-16", record_ref="OTP16-1000",
        step="propose", step_index=1, payload={"mode": "topside"},
    )
    review.create_item(process_id="OTP-3", record_ref="OTP3-royalty-API", maker="u_sam")
    cases.create_case(
        process_id="OTP-40", kind="audit_defense",
        title="German field audit", owner="Sam Rodriguez", actor="u_demo",
    )


def test_worklist_aggregates_all_kinds(state_db):
    _seed("u_maria")
    items = build_worklist("u_maria")
    kinds = {it["kind"] for it in items}
    assert {"draft", "review", "case"} <= kinds


def test_every_item_has_required_shape(state_db):
    _seed("u_maria")
    for it in build_worklist("u_maria"):
        assert set(it) == {
            "kind", "title", "ref", "process_id", "route",
            "due_at", "priority", "status",
        }
        assert it["kind"] in {"draft", "review", "exception", "case"}


def test_draft_routes_to_owning_process(state_db):
    _seed("u_maria")
    draft = next(it for it in build_worklist("u_maria") if it["kind"] == "draft")
    assert draft["ref"] == "OTP16-1000"
    assert draft["route"] == "/process/OTP-16/overview"


def test_review_to_approve_for_other_makers(state_db):
    # The pending review was made by u_sam, so for u_maria it is "to approve" —
    # and it routes to /review, the only screen with approve/reject buttons.
    _seed("u_maria")
    rev = next(it for it in build_worklist("u_maria") if it["kind"] == "review")
    assert rev["status"] == "to approve"
    assert rev["priority"] == "high"
    assert rev["route"] == "/review"


def test_review_awaiting_checker_for_own_submission(state_db):
    # Viewed as the maker (u_sam), the same item is "awaiting checker".
    _seed("u_maria")
    rev = next(it for it in build_worklist("u_sam") if it["kind"] == "review")
    assert rev["status"] == "awaiting checker"


def test_review_awaiting_checker_has_no_route(state_db):
    # There is nowhere useful to send the maker — they are waiting on someone
    # else, so the row carries no route at all.
    _seed("u_maria")
    rev = next(it for it in build_worklist("u_sam") if it["kind"] == "review")
    assert rev["route"] is None


def test_case_routes_to_worklist_and_skips_closed(state_db):
    _seed("u_maria")
    case = cases.create_case(
        process_id="OTP-50", kind="map", title="MAP to close",
        owner="Daniel Okafor", actor="u_demo",
    )
    cases.set_status(case["id"], "closed", "u_demo")
    items = build_worklist("u_maria")
    case_items = [it for it in items if it["kind"] == "case"]
    assert case_items
    assert all(it["status"] != "closed" for it in case_items)
    assert all(it["route"].endswith("/worklist") for it in case_items)
