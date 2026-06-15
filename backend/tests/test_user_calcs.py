"""TDD for the user-calculation lifecycle + registry integration (W3).

Covers state/user_calcs.py, /api/user-calcs, the review.decide() ucalc: hook
and the calc_registry expression runner. The keystones:

* **Lifecycle** — draft → tested (a successful test run of the CURRENT
  expression is the gate) → in_review (maker submits) → active (a DIFFERENT
  checker approves), every transition hash-chained at ucalc:{id}.
* **Maker-checker** — activation rides the existing review queue; the maker
  cannot approve their own calculation; rejection returns it to draft.
* **Preview persists nothing** — no calc_runs row, no audit event.
* **Registry integration** — an ACTIVE user calc lists in /api/calcs (kind
  "user-defined" beside the seed's "system"), runs via calc_registry.run with
  full trace/calc_runs support, and responds to a scenario override
  (param('csa.growth') overlay) with zero contamination of the base.

Run from `backend/`:  python -m pytest tests/test_user_calcs.py
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

import services.calc_registry as calc_registry
import state.audit as audit
import state.calc_runs as calc_runs
import state.parameters as parameters
import state.review as review
import state.user_calcs as user_calcs
from main import app

client = TestClient(app)

# The spec's W3 acceptance formula: revenue per entity grown by the governed
# CSA growth assumption.
EXPR = "measure('segment_pl.revenue', 'entity', 'GJAHR=2026') * (1 + param('csa.growth'))"


def _create(actor: str = "u_maria", expression: str = EXPR,
            output_grain: str = "entity") -> dict:
    return user_calcs.create_user_calc(
        name="Projected revenue", expression=expression,
        description="Entity revenue grown by csa.growth",
        output_grain=output_grain, actor=actor,
    )


def _pending_item(uid: str) -> dict:
    return next(i for i in review.list_queue() if i["record_ref"] == f"ucalc:{uid}")


def _activated(maker: str = "u_maria", checker: str = "u_sam") -> dict:
    u = _create(actor=maker)
    user_calcs.test_run(u["id"], actor=maker)
    user_calcs.submit_for_activation(u["id"], maker=maker)
    review.decide(_pending_item(u["id"])["id"], checker=checker, decision="approve")
    return user_calcs.get_user_calc(u["id"])


# --- Create / update ---------------------------------------------------------------


def test_create_draft_audited(state_db):
    parameters.seed_if_empty()
    u = _create()
    assert u["id"] == "UC-1"
    assert u["status"] == "draft"
    assert u["version"] == 1
    assert u["tested_expr_hash"] is None
    events = audit.list_events(record_ref="ucalc:UC-1")
    assert any(e["event_type"] == "created" and e["actor"] == "u_maria" for e in events)
    assert audit.verify_chain()["ok"]


def test_create_rejects_invalid_expression(state_db):
    parameters.seed_if_empty()
    with pytest.raises(ValueError, match="invalid expression.*unknown parameter 'nope'"):
        _create(expression="param('nope') * 2")
    with pytest.raises(ValueError, match="invalid output_grain"):
        _create(output_grain="galaxy")


def test_update_draft_keeps_version_and_invalidates_test(state_db):
    parameters.seed_if_empty()
    u = _create()
    user_calcs.test_run(u["id"], actor="u_maria")
    assert user_calcs.get_user_calc(u["id"])["status"] == "tested"

    # A metadata-only edit keeps the tested gate…
    after = user_calcs.update_user_calc(u["id"], actor="u_maria", name="Renamed")
    assert after["status"] == "tested"
    assert after["version"] == 1

    # …but a formula change returns it to draft (re-test required).
    after = user_calcs.update_user_calc(
        u["id"], actor="u_maria", expression=EXPR + " * 2"
    )
    assert after["status"] == "draft"
    assert after["tested_expr_hash"] is None
    with pytest.raises(ValueError, match="must pass a test run"):
        user_calcs.submit_for_activation(u["id"], maker="u_maria")


def test_editing_active_bumps_version_back_to_draft(state_db):
    parameters.seed_if_empty()
    u = _activated()
    assert u["status"] == "active"
    after = user_calcs.update_user_calc(
        u["id"], actor="u_maria", expression=EXPR + " * 2"
    )
    assert after["status"] == "draft"
    assert after["version"] == 2
    assert after["tested_expr_hash"] is None
    # The version bump is part of the append-only changelog.
    events = audit.list_events(record_ref=f"ucalc:{u['id']}")
    assert any(e["rationale"] == "v1 -> v2 (new draft)" for e in events)


# --- Test gate + maker-checker activation -------------------------------------------


def test_lifecycle_end_to_end(state_db):
    parameters.seed_if_empty()
    u = _create()

    # Submit without a test run → blocked.
    resp = client.post(f"/api/user-calcs/{u['id']}/submit-activation",
                       json={"maker": "u_maria"})
    assert resp.status_code == 409
    assert "test run" in resp.json()["detail"]

    # Test run: evaluates, returns result + trace, marks tested.
    resp = client.post(f"/api/user-calcs/{u['id']}/test", json={"actor": "u_maria"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["calc"]["status"] == "tested"
    assert body["result"]["grain"] == "entity"
    assert len(body["result"]["rows"]) > 0
    assert any(s["step"] == "param" for s in body["trace"])

    # Submit → in_review + one pending item at ucalc:{id}.
    resp = client.post(f"/api/user-calcs/{u['id']}/submit-activation",
                       json={"maker": "u_maria"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "in_review"
    item = _pending_item(u["id"])
    assert item["status"] == "pending"

    # Frozen while in review.
    resp = client.patch(f"/api/user-calcs/{u['id']}",
                        json={"actor": "u_maria", "name": "x"})
    assert resp.status_code == 409

    # Segregation of duties — the maker cannot approve their own calculation.
    resp = client.post(f"/api/review/{item['id']}/approve", json={"checker": "u_maria"})
    assert resp.status_code == 409
    assert user_calcs.get_user_calc(u["id"])["status"] == "in_review"

    # A different reviewer approves → active.
    resp = client.post(f"/api/review/{item['id']}/approve", json={"checker": "u_sam"})
    assert resp.status_code == 200
    after = user_calcs.get_user_calc(u["id"])
    assert after["status"] == "active"
    assert after["activated_by"] == "u_sam"
    events = audit.list_events(record_ref=f"ucalc:{u['id']}")
    types = [e["event_type"] for e in events]
    for expected in ("created", "tested", "submitted", "approved", "posted", "handoff"):
        assert expected in types, f"missing {expected} in {types}"
    assert audit.verify_chain()["ok"]


def test_reject_returns_to_draft(state_db):
    parameters.seed_if_empty()
    u = _create()
    user_calcs.test_run(u["id"], actor="u_maria")
    user_calcs.submit_for_activation(u["id"], maker="u_maria")
    item = _pending_item(u["id"])

    resp = client.post(f"/api/review/{item['id']}/reject", json={
        "checker": "u_sam", "comments": "growth basis unclear",
    })
    assert resp.status_code == 200
    after = user_calcs.get_user_calc(u["id"])
    assert after["status"] == "draft"
    events = audit.list_events(record_ref=f"ucalc:{u['id']}")
    assert any(e["event_type"] == "rejected" and e["actor"] == "u_sam" for e in events)
    assert audit.verify_chain()["ok"]

    # Rework: re-test then resubmit the same calculation.
    user_calcs.test_run(u["id"], actor="u_maria")
    assert user_calcs.submit_for_activation(u["id"], maker="u_maria")["status"] == "in_review"


def test_test_run_enforces_declared_grain(state_db):
    parameters.seed_if_empty()
    u = _create(expression="param('csa.growth') * 2", output_grain="entity")
    with pytest.raises(ValueError, match="evaluates at 'group' grain"):
        user_calcs.test_run(u["id"], actor="u_maria")
    assert user_calcs.get_user_calc(u["id"])["status"] == "draft"


# --- validate / preview endpoints ----------------------------------------------------


def test_validate_endpoint(state_db):
    parameters.seed_if_empty()
    ok = client.post("/api/user-calcs/validate", json={"expression": EXPR}).json()
    assert ok["ok"] is True
    assert {t["kind"] for t in ok["terms"]} == {"measure", "param"}

    bad = client.post("/api/user-calcs/validate",
                      json={"expression": "param('nope') +"}).json()
    assert bad["ok"] is False
    assert bad["errors"][0]["pos"] is not None


def test_preview_evaluates_without_persisting(state_db):
    parameters.seed_if_empty()
    audit_before = len(audit.list_events())
    resp = client.post("/api/user-calcs/preview", json={"expression": "2 + 3 * 4"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["result"] == {"grain": "group", "value": 14.0, "value_exact": "14"}
    assert body["grain"] == "group"
    # Nothing persisted: no run row, no audit event.
    assert calc_runs.list_runs() == []
    assert len(audit.list_events()) == audit_before

    resp = client.post("/api/user-calcs/preview", json={"expression": "1 / 0"})
    assert resp.status_code == 400
    assert resp.json()["detail"]["message"] == "division by zero"


def test_terms_endpoint_serves_the_picker_allowlist(state_db):
    """W4: the Builder's term pickers read the SAME allowlist validate/preview
    enforce (calc.expr.MEASURE_TABLES + GRAINS + the non-composable set), so
    the UI can never offer a term the engine would reject."""
    body = client.get("/api/user-calcs/terms").json()
    assert body["grains"] == ["group", "entity", "entity_function"]
    seg = next(m for m in body["measures"] if m["table"] == "segment_pl")
    assert seg["catalog_id"] == "warehouse:segment_pl"
    assert "revenue" in seg["measures"] and "operating_profit" in seg["measures"]
    assert seg["grains"]["entity"] == ["RBUKRS"]
    assert seg["grains"]["group"] == []
    assert seg["filters"]["GJAHR"] == "int"
    assert "service_allocation" in body["non_composable"]
    # Route order: the literal path must not be captured as a ucalc id.
    assert client.get("/api/user-calcs/terms").status_code == 200


# --- Registry integration -------------------------------------------------------------


def test_active_user_calc_lists_in_api_calcs(state_db):
    parameters.seed_if_empty()
    u = _activated()
    body = client.get("/api/calcs").json()
    by_id = {d["id"]: d for d in body}
    assert by_id[u["id"]]["kind"] == "user-defined"
    assert by_id[u["id"]]["formula"] == EXPR
    assert by_id[u["id"]]["scenario_capable"] is True
    assert by_id[u["id"]]["inputs"] == {
        "catalog": ["warehouse:segment_pl"], "parameters": ["csa.growth"],
    }
    # System entries keep their seed shape, now chipped "system".
    assert by_id["csa"]["kind"] == "system"
    assert len(body) == 16  # 15 system + 1 user-defined

    # Drafts do NOT list.
    draft = _create(actor="u_petra")
    assert draft["id"] not in {d["id"] for d in client.get("/api/calcs").json()}

    # The detail route resolves inputs for user calcs too.
    detail = client.get(f"/api/calcs/{u['id']}").json()
    assert detail["kind"] == "user-defined"
    assert detail["resolved_inputs"]["parameters"][0]["key"] == "csa.growth"


def test_registry_runs_user_calc_with_trace_and_audit(state_db):
    parameters.seed_if_empty()
    u = _activated()
    run = calc_registry.run(u["id"], actor="u_demo")
    assert run["status"] == "succeeded"
    assert run["output"]["grain"] == "entity"
    assert {p["key"] for p in run["params_read"]} == {"csa.growth"}
    assert {s["step"] for s in run["trace"]} >= {"param", "measure", "aggregate"}
    # Persisted run row + hash-chained "run" event on the ucalc timeline.
    assert calc_runs.list_runs(calc_id=u["id"])[0]["id"] == run["id"]
    assert run["summary"]["rows"] == len(run["output"]["rows"])
    events = audit.list_events(record_ref=f"ucalc:{u['id']}")
    assert any(e["event_type"] == "run" for e in events)
    assert audit.verify_chain()["ok"]

    # Exactness: every row is revenue × 1.08 as an exact decimal string.
    revenue = {
        (r["RBUKRS"],): Decimal(r["value_exact"])
        for r in calc_registry.run("UC-1", actor="u_demo",
                                   scenario_overrides={"csa.growth": 0})["output"]["rows"]
    }
    for row in run["output"]["rows"]:
        assert Decimal(row["value_exact"]) == revenue[(row["RBUKRS"],)] * Decimal("1.08")


def test_user_calc_responds_to_scenario_override(state_db):
    parameters.seed_if_empty()
    u = _activated()
    base = calc_registry.run(u["id"], actor="u_demo")
    scen = calc_registry.run(
        u["id"], actor="u_demo", scenario_overrides={"csa.growth": 0.10}
    )
    base_after = calc_registry.run(u["id"], actor="u_demo")

    assert scen["scenario_sensitive"] is True
    assert scen["output_digest"] != base["output_digest"]
    # Zero contamination: the base is byte-identical before and after.
    assert base_after["output_digest"] == base["output_digest"]
    assert parameters.get_param("csa.growth") == 0.08

    # The override moved every row from ×1.08 to ×1.10, exactly.
    base_rows = {r["RBUKRS"]: Decimal(r["value_exact"]) for r in base["output"]["rows"]}
    for row in scen["output"]["rows"]:
        expected = base_rows[row["RBUKRS"]] / Decimal("1.08") * Decimal("1.10")
        assert Decimal(row["value_exact"]) == expected
    by_key = {p["key"]: p for p in scen["params_read"]}
    assert by_key["csa.growth"]["overridden"] is True


def test_registry_rejects_inactive_and_args(state_db):
    parameters.seed_if_empty()
    draft = _create()
    with pytest.raises(ValueError, match="only active calculations run"):
        calc_registry.run(draft["id"], actor="u_demo")
    with pytest.raises(ValueError, match="unknown calculation"):
        calc_registry.run("UC-999", actor="u_demo")

    u = _activated(maker="u_petra", checker="u_sam")
    with pytest.raises(ValueError, match="takes no args"):
        calc_registry.run(u["id"], actor="u_demo", args={"year": 2025})


def test_run_user_calc_via_api(state_db):
    parameters.seed_if_empty()
    u = _activated()
    resp = client.post(f"/api/calcs/{u['id']}/run", json={"actor": "u_demo"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["output"]["grain"] == "entity"
    assert "shaped_trace" not in body  # raw trace only for user calcs
    assert client.get(f"/api/calcs/{u['id']}/runs").json()[0]["calc_id"] == u["id"]

    assert client.post("/api/calcs/UC-999/run",
                       json={"actor": "u_demo"}).status_code == 404
    draft = _create(actor="u_petra")
    assert client.post(f"/api/calcs/{draft['id']}/run",
                       json={"actor": "u_demo"}).status_code == 400


def test_failed_test_run_keeps_draft_and_persists_nothing(state_db):
    parameters.seed_if_empty()
    u = _create(expression="1 / (param('csa.growth') - param('csa.growth'))",
                output_grain="group")
    with pytest.raises(ValueError, match="division by zero"):
        user_calcs.test_run(u["id"], actor="u_maria")
    assert user_calcs.get_user_calc(u["id"])["status"] == "draft"
    assert calc_runs.list_runs(calc_id=u["id"]) == []


def test_failed_registry_run_persists_failed_row(state_db):
    parameters.seed_if_empty()
    # Activate a calc that divides by a governed parameter, then make it blow
    # up at RUN time with a zero override — the failure must land as a
    # 'failed' calc_runs row carrying the trace, exactly like a system calc.
    u = _create(expression="100 / param('csa.growth')", output_grain="group")
    user_calcs.test_run(u["id"], actor="u_maria")
    user_calcs.submit_for_activation(u["id"], maker="u_maria")
    review.decide(_pending_item(u["id"])["id"], checker="u_sam", decision="approve")

    with pytest.raises(ValueError, match="division by zero"):
        calc_registry.run(u["id"], actor="u_demo",
                          scenario_overrides={"csa.growth": 0})
    failed = calc_runs.list_runs(calc_id=u["id"], status="failed")
    assert len(failed) == 1
    assert "division by zero" in failed[0]["error"]
    assert failed[0]["params_read"][0]["overridden"] is True


def test_scenario_compare_endpoint_works_for_user_calc(state_db):
    parameters.seed_if_empty()
    u = _activated()
    import state.scenarios as scenarios

    sc = scenarios.create_scenario(
        name="Growth 10%", overrides={"csa.growth": 0.10}, actor="u_maria"
    )
    body = client.post(f"/api/scenarios/{sc['id']}/compare", json={
        "calc_id": u["id"], "actor": "u_demo",
    }).json()
    assert body["scenario_sensitive"] is True
    # The float convenience values diff numerically row by row.
    deltas = [r["value"] for r in body["delta"]["rows"]]
    assert all(d > 0 for d in deltas)
