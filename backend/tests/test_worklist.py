"""TDD for the unified worklist aggregator (routers/worklist.py — "My work" on /home).

Seeds a draft + a pending review + an open case in the isolated state DB, then
asserts the aggregator surfaces each kind with a deep-link route. The OTP-20
exception kind reads the warehouse (read-only parquet, deterministic for the
demo), so its tests assert the status→priority mapping and the margin context
over whatever the warehouse yields.

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


def test_draft_deep_links_to_its_entity(state_db):
    # An adjustment draft's ref encodes the entity (OTP16-{id}); the route must
    # land on that entity's wizard, not the bare process overview.
    _seed("u_maria")
    draft = next(it for it in build_worklist("u_maria") if it["kind"] == "draft")
    assert draft["ref"] == "OTP16-1000"
    assert draft["route"] == "/process/OTP-16/overview?entity=1000"


def test_draft_without_entity_ref_routes_to_overview(state_db):
    # Non-OTP16 refs encode no entity — the route stays the plain overview.
    drafts.upsert(
        user_id="u_maria", process_id="OTP-3", record_ref="OTP3-royalty-API",
        step="propose", step_index=1, payload={},
    )
    draft = next(
        it for it in build_worklist("u_maria")
        if it["kind"] == "draft" and it["ref"] == "OTP3-royalty-API"
    )
    assert draft["route"] == "/process/OTP-3/overview"


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


def test_exceptions_include_watch_as_medium_priority(state_db):
    # The exception feed is the early-warning surface: out-of-range entities
    # are act-now (high), watch entities ride along at medium. Both deep-link
    # to the entity's adjustment wizard and carry margin-vs-target context.
    from period_filter import PeriodFilter
    from services.entities import list_entities

    entities = {e["id"]: e for e in list_entities(PeriodFilter())}
    expected = {eid: e for eid, e in entities.items()
                if e["status"] in ("out-of-range", "watch")}

    exceptions = [it for it in build_worklist("u_maria") if it["kind"] == "exception"]
    by_ref = {it["ref"]: it for it in exceptions}

    assert set(by_ref) == {f"OTP16-{eid}" for eid in expected}
    for eid, e in expected.items():
        it = by_ref[f"OTP16-{eid}"]
        assert it["status"] == e["status"]
        assert it["priority"] == ("high" if e["status"] == "out-of-range" else "medium")
        assert it["route"] == f"/process/OTP-16/overview?entity={eid}"
        if e["actualMargin"] is not None:
            assert f"vs {e['targetMarginLabel']}" in it["title"]


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
