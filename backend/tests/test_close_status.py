"""TDD for the Close Command Center status aggregator (routers/close.py).

Like the worklist, /api/close/status is a READ-ONLY aggregator: it owns no
store and composes existing signals (master-data staging, drafts, the review
queue, allocation runs, waterfall overlay runs + the governed
``pl.use_post_charge`` parameter, KPI counters, adjustments, cases) into one
ordered 8-step close sequence. These tests seed each signal through the real
stores and assert the step statuses — plus the read-only invariant: building
the status never writes an audit event.

Run from `backend/`:  python -m pytest tests/test_close_status.py
"""

from __future__ import annotations

import persistence.overrides as overrides
import services.post_charge as post_charge
import services.waterfall_runner as waterfall_runner
import state.allocation_store as allocation_store
import state.audit as audit
import state.cases as cases
import state.drafts as drafts
import state.master_data as master_data
import state.parameters as parameters
import state.review as review
from routers.close import build_close_status

STEP_KEYS = {"id", "label", "status", "owner", "route", "counts", "detail"}
STATUSES = {"complete", "active", "attention", "pending"}
STEP_IDS = [
    "master_data", "price_setting", "charges", "waterfall",
    "monitor", "adjust", "review", "document",
]
OWNERS = {
    "master_data": "operator", "price_setting": "operator",
    "charges": "operator", "waterfall": "operator",
    "monitor": "shared", "adjust": "operator",
    "review": "reviewer", "document": "director",
}


def _step(body: dict, step_id: str) -> dict:
    return next(s for s in body["steps"] if s["id"] == step_id)


# ------------------------------------------------------------------- shape --


def test_shape_and_enum(state_db):
    body = build_close_status("u_maria")
    assert body["year"] == 2026
    assert set(body["basis"]) == {"mode", "param_on", "applied_run_id"}
    assert body["basis"]["mode"] in ("base", "post_charge")
    steps = body["steps"]
    assert [s["id"] for s in steps] == STEP_IDS
    for s in steps:
        assert set(s) == STEP_KEYS
        assert s["status"] in STATUSES
        assert s["owner"] == OWNERS[s["id"]]
        assert isinstance(s["counts"], dict)
        assert isinstance(s["detail"], str) and s["detail"]
        assert s["route"] and s["route"].startswith("/")
    assert 0 <= body["current_index"] < len(steps)


def test_readonly_invariant(state_db):
    """Building the close status writes NOTHING — audit stream untouched."""
    master_data.seed_if_empty()
    cases.create_case(
        process_id="OTP-40", kind="audit_defense",
        title="German field audit", owner="Sam Rodriguez", actor="u_demo",
    )
    review.create_item(process_id="OTP-3", record_ref="OTP3-x", maker="u_sam")
    before = len(audit.list_events())
    build_close_status("u_maria")
    build_close_status("u_sam")
    assert len(audit.list_events()) == before


# --------------------------------------------------------- waterfall (step 4) --


def test_waterfall_step_default_pre_charge(state_db):
    body = build_close_status("u_maria")
    assert body["basis"] == {
        "mode": "base", "param_on": False, "applied_run_id": None,
    }
    assert _step(body, "waterfall")["status"] == "pending"


def test_waterfall_applied_but_param_off_is_attention(state_db):
    parameters.seed_if_empty()
    run = waterfall_runner.run_waterfall(actor="cc-maker", year=2026)
    assert run["status"] == "applied"
    body = build_close_status("u_maria")
    assert _step(body, "waterfall")["status"] == "attention"
    assert body["basis"]["mode"] == "base"
    assert body["basis"]["applied_run_id"] == run["id"]


def test_waterfall_param_on_without_run_is_attention(state_db):
    parameters.seed_if_empty()
    parameters.set_param(post_charge.PARAM_KEY, True, "cc-maker",
                         rationale="CC1 gate: basis on with nothing applied")
    body = build_close_status("u_maria")
    assert _step(body, "waterfall")["status"] == "attention"
    assert body["basis"]["applied_run_id"] is None


def test_waterfall_complete_when_applied_and_param_on(state_db):
    parameters.seed_if_empty()
    run = waterfall_runner.run_waterfall(actor="cc-maker", year=2026)
    assert run["status"] == "applied"
    parameters.set_param(post_charge.PARAM_KEY, True, "cc-maker",
                         rationale="CC1 gate: enable post-charge basis")
    body = build_close_status("u_maria")
    assert _step(body, "waterfall")["status"] == "complete"
    assert body["basis"]["mode"] == "post_charge"
    assert body["basis"]["param_on"] is True
    assert body["basis"]["applied_run_id"] == run["id"]


# ------------------------------------------------------------ review (step 7) --


def test_review_step_relational(state_db):
    """Same queue, two viewers: the checker must act, the maker only waits."""
    review.create_item(process_id="OTP-16", record_ref="adj:ADJ-1", maker="u_sam")
    step = _step(build_close_status("u_maria"), "review")
    assert step["status"] == "attention"
    assert step["counts"]["to_approve"] == 1
    assert step["route"] == "/review"
    step = _step(build_close_status("u_sam"), "review")
    assert step["status"] == "active"
    assert step["counts"]["awaiting"] == 1


# ------------------------------------------------------------ adjust (step 6) --


def test_adjustments_step_pending_approval(state_db):
    overrides.submit_adjustment({
        "entityId": "3100", "entityName": "Swiss Principal AG",
        "amount": 1_000_000.0, "currency": "USD", "mode": "median",
        "submittedBy": "u_maria",
    })
    step = _step(build_close_status("u_maria"), "adjust")
    assert step["status"] == "active"
    assert step["counts"]["pending"] == 1


def test_adjustments_step_tracks_monitor_when_no_pending(state_db):
    """No pending adjustments: the step inherits urgency from step 5's
    out-of-range count — attention when parties are out, complete otherwise."""
    body = build_close_status("u_maria")
    out = _step(body, "monitor")["counts"]["out"]
    step = _step(body, "adjust")
    assert step["counts"]["pending"] == 0
    assert step["status"] == ("attention" if out > 0 else "complete")


# ------------------------------------------------- master data + price setting --


def test_master_data_open_items(state_db):
    master_data.seed_if_empty()
    open_items = [
        i for i in master_data.list_staging()
        if i["status"] in ("unmapped", "proposed", "in_review")
    ]
    assert open_items  # the inbound seed stages unmapped SAP-delta items
    step = _step(build_close_status("u_maria"), "master_data")
    assert step["counts"]["open"] == len(open_items)
    assert step["status"] == "active"


def test_price_setting_scopes_to_otp1_8(state_db):
    drafts.upsert(user_id="u_maria", process_id="OTP-3", record_ref="OTP3-roy",
                  step="propose", step_index=1, payload={})
    drafts.upsert(user_id="u_maria", process_id="OTP-16", record_ref="OTP16-adj",
                  step="propose", step_index=1, payload={})  # NOT price setting
    review.create_item(process_id="OTP-4", record_ref="OTP4-x", maker="u_sam")
    review.create_item(process_id="OTP-40", record_ref="case:C-1", maker="u_sam")
    step = _step(build_close_status("u_maria"), "price_setting")
    assert step["status"] == "active"
    assert step["counts"] == {"pending_reviews": 1, "drafts": 1}


# ----------------------------------------------------------- charges (step 3) --


def test_charges_step_from_allocation_runs(state_db):
    assert _step(build_close_status("u_maria"), "charges")["status"] == "pending"
    allocation_store.insert_run(
        run_id="RUN-0001-actual-2026-04", period="2026-04",
        run_type="actual", input_snapshot_hash="cc1-test",
    )
    assert _step(build_close_status("u_maria"), "charges")["status"] == "active"
    allocation_store.set_run_status("RUN-0001-actual-2026-04", "succeeded")
    step = _step(build_close_status("u_maria"), "charges")
    assert step["status"] == "complete"
    assert step["counts"]["succeeded"] == 1


def test_charges_ignores_other_years_and_budget_runs(state_db):
    allocation_store.insert_run(
        run_id="RUN-0001-actual-2025-04", period="2025-04",
        run_type="actual", input_snapshot_hash="cc1-test",
    )
    allocation_store.set_run_status("RUN-0001-actual-2025-04", "succeeded")
    allocation_store.insert_run(
        run_id="RUN-0002-budget-2026-04", period="2026-04",
        run_type="budget", input_snapshot_hash="cc1-test",
    )
    allocation_store.set_run_status("RUN-0002-budget-2026-04", "succeeded")
    assert _step(build_close_status("u_maria"), "charges")["status"] == "pending"


# ---------------------------------------------------------- document (step 8) --


def test_cases_open(state_db):
    c = cases.create_case(
        process_id="OTP-40", kind="audit_defense",
        title="German field audit", owner="Sam Rodriguez", actor="u_demo",
    )
    step = _step(build_close_status("u_maria"), "document")
    assert step["status"] == "active"
    assert step["counts"]["open_cases"] == 1
    cases.set_status(c["id"], "closed", "u_demo")
    step = _step(build_close_status("u_maria"), "document")
    assert step["status"] == "complete"
    assert step["counts"]["open_cases"] == 0


# ---------------------------------------------------------------- endpoint --


def test_endpoint_registered_and_matches_builder(state_db):
    from fastapi.testclient import TestClient

    from main import app

    resp = TestClient(app).get("/api/close/status", params={"user": "u_maria"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["year"] == 2026
    assert [s["id"] for s in body["steps"]] == STEP_IDS


# ------------------------------------------------------------- current_index --


def test_current_index_first_incomplete(state_db):
    master_data.seed_if_empty()  # open staging items -> step 0 is active
    body = build_close_status("u_maria")
    statuses = [s["status"] for s in body["steps"]]
    non_complete = [i for i, st in enumerate(statuses) if st != "complete"]
    expected = non_complete[0] if non_complete else len(statuses) - 1
    assert statuses[0] != "complete"
    assert body["current_index"] == expected == 0
