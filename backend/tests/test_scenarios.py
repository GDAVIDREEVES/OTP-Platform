"""TDD for what-if scenarios (state/scenarios.py + the parameter overlay, CS-c).

The keystones:

* **Overlay isolation** — ``parameters.overrides()`` affects ``get_param``
  reads only inside the with-block (nested blocks shadow then restore; an
  exception cannot leak the overlay).
* **Zero contamination** — a scenario run never touches the governed store:
  a base run after a scenario run is byte-identical to one before it,
  /api/parameters is unchanged, and no ``param:`` audit events are written.
* **Math golden** — csa under growth=0.10 reproduces projected_sales /
  rab_share recomputed by hand from the base revenues.
* **Degradation** — comparing a calc that reads no overridden parameter
  (treasury) yields an all-zero delta and scenario_sensitive=False.
* **Promotion** — rides the existing maker-checker queue: maker≠checker is
  enforced, approval applies each override via set_param (audited at
  param:{key}), rejection returns the scenario to draft, and the hash chain
  stays intact throughout.

Run from `backend/`:  python -m pytest tests/test_scenarios.py
"""

from __future__ import annotations

import json

import pytest
from fastapi.encoders import jsonable_encoder
from fastapi.testclient import TestClient

import services.calc_registry as calc_registry
import state.audit as audit
import state.parameters as parameters
import state.review as review
import state.scenarios as scenarios
from main import app

client = TestClient(app)


def _canonical(obj) -> str:
    return json.dumps(jsonable_encoder(obj), sort_keys=True)


def _numeric_leaves(delta) -> list[float]:
    """Flatten a compare delta to its numeric leaves."""
    if isinstance(delta, (int, float)) and not isinstance(delta, bool):
        return [delta]
    if isinstance(delta, dict):
        return [x for v in delta.values() for x in _numeric_leaves(v)]
    if isinstance(delta, list):
        return [x for v in delta if v is not None for x in _numeric_leaves(v)]
    return []


# --- Overlay isolation ----------------------------------------------------------

def test_overlay_inside_and_after_with_block(state_db):
    parameters.seed_if_empty()
    assert parameters.get_param("csa.growth") == 0.08
    with parameters.overrides({"csa.growth": 0.10}):
        assert parameters.get_param("csa.growth") == 0.10
        # Keys not in the overlay fall through to the governed store.
        assert parameters.get_param("csa.pct_mult") == 3
    assert parameters.get_param("csa.growth") == 0.08


def test_overlay_nested_shadows_then_restores(state_db):
    parameters.seed_if_empty()
    with parameters.overrides({"csa.growth": 0.10}):
        with parameters.overrides({"csa.growth": 0.25}):
            assert parameters.get_param("csa.growth") == 0.25
        assert parameters.get_param("csa.growth") == 0.10
    assert parameters.get_param("csa.growth") == 0.08


def test_overlay_reset_on_exception(state_db):
    parameters.seed_if_empty()
    with pytest.raises(RuntimeError):
        with parameters.overrides({"csa.growth": 0.99}):
            raise RuntimeError("handler blew up")
    assert parameters.get_param("csa.growth") == 0.08
    assert parameters._OVERRIDES.get() is None


def test_overlay_never_touches_governed_reads(state_db):
    parameters.seed_if_empty()
    with parameters.overrides({"csa.growth": 0.10}):
        # The governed truth (row reads, list) ignores the overlay entirely.
        assert parameters.get_param_row("csa.growth")["value"] == 0.08
        listed = {p["key"]: p["value"] for p in parameters.list_params()}
        assert listed["csa.growth"] == 0.08


# --- Scenario CRUD ---------------------------------------------------------------

def test_create_scenario_audits_at_scenario_ref(state_db):
    parameters.seed_if_empty()
    sc = scenarios.create_scenario(
        name="Growth 10%", description="What if RAB growth is 10%?",
        overrides={"csa.growth": 0.10}, actor="u_maria",
    )
    assert sc["id"] == "SC-1"
    assert sc["status"] == "draft"
    assert sc["overrides"] == {"csa.growth": 0.10}
    events = audit.list_events(record_ref="scenario:SC-1")
    assert any(e["event_type"] == "created" and e["actor"] == "u_maria" for e in events)
    assert audit.verify_chain()["ok"]


def test_create_scenario_rejects_unknown_parameter(state_db):
    parameters.seed_if_empty()
    with pytest.raises(ValueError, match="unknown parameter"):
        scenarios.create_scenario(name="Bad", overrides={"nope.key": 1}, actor="u_maria")


def test_update_only_while_draft(state_db):
    parameters.seed_if_empty()
    sc = scenarios.create_scenario(
        name="Growth 10%", overrides={"csa.growth": 0.10}, actor="u_maria"
    )
    updated = scenarios.update_scenario(
        sc["id"], actor="u_maria", overrides={"csa.growth": 0.12}
    )
    assert updated["overrides"] == {"csa.growth": 0.12}

    scenarios.submit_for_review(sc["id"], maker="u_maria")
    with pytest.raises(ValueError, match="only drafts are editable"):
        scenarios.update_scenario(sc["id"], actor="u_maria", name="renamed")


def test_discard_is_terminal(state_db):
    parameters.seed_if_empty()
    sc = scenarios.create_scenario(
        name="Throwaway", overrides={"csa.growth": 0.10}, actor="u_maria"
    )
    discarded = scenarios.discard(sc["id"], actor="u_maria")
    assert discarded["status"] == "discarded"
    with pytest.raises(ValueError, match="already discarded"):
        scenarios.discard(sc["id"], actor="u_maria")
    with pytest.raises(ValueError, match="only drafts"):
        scenarios.submit_for_review(sc["id"], maker="u_maria")


def test_scenarios_api_crud(state_db):
    parameters.seed_if_empty()
    resp = client.post("/api/scenarios", json={
        "name": "Growth 10%", "description": "RAB growth what-if",
        "overrides": {"csa.growth": 0.10}, "actor": "u_maria",
    })
    assert resp.status_code == 200
    sid = resp.json()["id"]

    assert client.get("/api/scenarios").json()[0]["id"] == sid
    assert client.get(f"/api/scenarios/{sid}").json()["status"] == "draft"
    assert client.get("/api/scenarios/SC-999").status_code == 404

    patched = client.patch(f"/api/scenarios/{sid}", json={
        "overrides": {"csa.growth": 0.11}, "actor": "u_maria",
    })
    assert patched.status_code == 200
    assert patched.json()["overrides"] == {"csa.growth": 0.11}

    resp = client.post(f"/api/scenarios/{sid}/discard", json={"actor": "u_maria"})
    assert resp.json()["status"] == "discarded"
    # Editing a discarded scenario is a 409, not a 404.
    assert client.patch(f"/api/scenarios/{sid}", json={"actor": "u_maria"}).status_code == 409


# --- ZERO CONTAMINATION: a scenario run never touches the governed store ---------

def test_scenario_run_zero_contamination(state_db):
    parameters.seed_if_empty()
    sc = scenarios.create_scenario(
        name="Growth 10%", overrides={"csa.growth": 0.10}, actor="u_maria"
    )

    base_before = calc_registry.run("csa", actor="u_demo")
    scen = calc_registry.run(
        "csa", actor="u_demo",
        scenario_id=sc["id"], scenario_overrides=sc["overrides"],
    )
    base_after = calc_registry.run("csa", actor="u_demo")

    # The scenario run really diverged…
    assert scen["output_digest"] != base_before["output_digest"]
    assert scen["scenario_sensitive"] is True
    # …but the base is byte-identical before and after it.
    assert _canonical(base_after["output"]) == _canonical(base_before["output"])
    assert base_after["output_digest"] == base_before["output_digest"]
    assert base_after["scenario_sensitive"] is False

    # The governed store is untouched: same values via the API…
    listed = {p["key"]: p["value"] for p in client.get("/api/parameters").json()}
    assert listed["csa.growth"] == 0.08
    # …and the scenario run wrote NO param: audit events (only calc:/scenario:).
    assert audit.list_events(record_ref="param:csa.growth") == []
    assert audit.verify_chain()["ok"]


def test_scenario_run_traces_overridden_param(state_db):
    parameters.seed_if_empty()
    run = calc_registry.run("csa", actor="u_demo", scenario_overrides={"csa.growth": 0.10})
    by_key = {p["key"]: p for p in run["params_read"]}
    assert by_key["csa.growth"] == {"step": "param", "key": "csa.growth",
                                    "value": 0.10, "overridden": True}
    assert by_key["csa.pct_mult"]["overridden"] is False


# --- Math golden: csa under growth=0.10, recomputed by hand ----------------------

def test_csa_scenario_math_golden(state_db):
    parameters.seed_if_empty()
    base = calc_registry.run("csa", actor="u_demo")["output"]
    scen = calc_registry.run(
        "csa", actor="u_demo", scenario_overrides={"csa.growth": 0.10}
    )["output"]

    assert scen["growth"] == 0.10
    revenues = {p["rbukrs"]: p["revenue"] for p in base["participants"]}
    total_projected = sum(r * 1.10 for r in revenues.values())

    p1000 = next(p for p in scen["participants"] if p["rbukrs"] == "1000")
    # projected_sales_i = revenue_i × (1 + 0.10), rounded to 2dp in the output.
    assert p1000["projected_sales"] == round(revenues["1000"] * 1.10, 2)
    # rab_share_i = projected_sales_i / Σ projected_sales (full precision).
    assert p1000["rab_share"] == pytest.approx(revenues["1000"] * 1.10 / total_projected)
    # Uniform growth cancels out of the share, so the pool allocation is
    # growth-invariant — the override moved projected_sales, not the split.
    base_1000 = next(p for p in base["participants"] if p["rbukrs"] == "1000")
    assert p1000["rab_share"] == pytest.approx(base_1000["rab_share"])
    assert p1000["projected_sales"] != base_1000["projected_sales"]


def test_csa_pct_mult_scenario_scales_platform_value(state_db):
    parameters.seed_if_empty()
    base = calc_registry.run("csa", actor="u_demo")["output"]
    scen = calc_registry.run(
        "csa", actor="u_demo", scenario_overrides={"csa.pct_mult": 4}
    )["output"]
    # platform_value = pct_mult × pool; the pool itself is parameter-free.
    assert scen["pool"] == base["pool"]
    assert scen["platform_value"] == pytest.approx(base["pool"] * 4)


# --- Degradation: overrides that no parameter read intersects --------------------

def test_treasury_compare_degrades_gracefully(state_db):
    parameters.seed_if_empty()
    sc = scenarios.create_scenario(
        name="Growth 10%", overrides={"csa.growth": 0.10}, actor="u_maria"
    )
    resp = client.post(f"/api/scenarios/{sc['id']}/compare", json={
        "calc_id": "treasury", "actor": "u_demo",
    })
    assert resp.status_code == 200
    body = resp.json()
    # treasury reads no governed parameters: not scenario-sensitive, and every
    # numeric path is unmoved (the delta exists, but is all zeros).
    assert body["scenario_sensitive"] is False
    leaves = _numeric_leaves(body["delta"])
    assert leaves and all(x == 0 for x in leaves)
    assert body["base_run_id"] != body["scenario_run_id"]


def test_csa_compare_returns_signed_deltas(state_db):
    parameters.seed_if_empty()
    sc = scenarios.create_scenario(
        name="PCT ×4", overrides={"csa.pct_mult": 4}, actor="u_maria"
    )
    body = client.post(f"/api/scenarios/{sc['id']}/compare", json={
        "calc_id": "csa", "actor": "u_demo",
    }).json()
    assert body["scenario_sensitive"] is True
    base, delta = body["base"], body["delta"]
    assert delta["platform_value"] == pytest.approx(base["pool"])  # 4× − 3× = 1× pool
    assert delta["pool"] == 0
    # Both runs landed in the run console, tagged appropriately.
    scen_run = client.get(f"/api/runs/{body['scenario_run_id']}").json()
    assert scen_run["scenario_id"] == sc["id"]
    assert scen_run["overrides"] == {"csa.pct_mult": 4}
    assert scen_run["scenario_sensitive"] is True


# --- Promotion end-to-end (maker-checker) ----------------------------------------

def _submitted_item(sid: str) -> dict:
    return next(
        i for i in review.list_queue() if i["record_ref"] == f"scenario:{sid}"
    )


def test_promote_end_to_end(state_db):
    parameters.seed_if_empty()
    sc = scenarios.create_scenario(
        name="Refresh growth + PCT", overrides={"csa.growth": 0.10, "csa.pct_mult": 4},
        actor="u_maria",
    )
    submitted = client.post(f"/api/scenarios/{sc['id']}/promote", json={"maker": "u_maria"})
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "in_review"
    item = _submitted_item(sc["id"])
    assert item["status"] == "pending"

    # Segregation of duties — the maker cannot approve their own scenario.
    resp = client.post(f"/api/review/{item['id']}/approve", json={"checker": "u_maria"})
    assert resp.status_code == 409
    assert parameters.get_param("csa.growth") == 0.08  # nothing applied

    # A different reviewer approves: every override lands via set_param.
    resp = client.post(f"/api/review/{item['id']}/approve", json={"checker": "u_sam"})
    assert resp.status_code == 200
    assert parameters.get_param("csa.growth") == 0.10
    assert parameters.get_param("csa.pct_mult") == 4
    assert scenarios.get_scenario(sc["id"])["status"] == "promoted"

    # Each parameter write is individually audited at param:{key}…
    for key in ("csa.growth", "csa.pct_mult"):
        edits = [e for e in audit.list_events(record_ref=f"param:{key}")
                 if e["event_type"] == "edited"]
        assert len(edits) == 1
        assert edits[0]["actor"] == "u_sam"
        assert f"Promoted from scenario {sc['id']}" in edits[0]["rationale"]
    # …and the scenario's own timeline carries the promotion + ONE handoff.
    events = audit.list_events(record_ref=f"scenario:{sc['id']}")
    handoffs = [e for e in events if e["event_type"] == "handoff"]
    assert len(handoffs) == 1
    assert "2 parameter(s) applied" in handoffs[0]["rationale"]
    assert any(e["event_type"] == "posted" for e in events)
    assert audit.verify_chain()["ok"]

    # The governed change is now live on the calc itself.
    assert client.get("/api/csa", params={"year": 2026}).json()["pct_mult"] == 4


def test_reject_returns_scenario_to_draft(state_db):
    parameters.seed_if_empty()
    sc = scenarios.create_scenario(
        name="Growth 10%", overrides={"csa.growth": 0.10}, actor="u_maria"
    )
    scenarios.submit_for_review(sc["id"], maker="u_maria")
    item = _submitted_item(sc["id"])

    resp = client.post(f"/api/review/{item['id']}/reject", json={
        "checker": "u_sam", "comments": "growth assumption looks high",
    })
    assert resp.status_code == 200
    after = scenarios.get_scenario(sc["id"])
    assert after["status"] == "draft"  # back to the maker for rework
    assert parameters.get_param("csa.growth") == 0.08  # nothing applied
    events = audit.list_events(record_ref=f"scenario:{sc['id']}")
    assert any(e["event_type"] == "rejected" and e["actor"] == "u_sam" for e in events)
    assert audit.verify_chain()["ok"]

    # The maker can rework and resubmit the same scenario.
    scenarios.update_scenario(sc["id"], actor="u_maria", overrides={"csa.growth": 0.09})
    resubmitted = scenarios.submit_for_review(sc["id"], maker="u_maria")
    assert resubmitted["status"] == "in_review"


def test_promote_requires_overrides(state_db):
    parameters.seed_if_empty()
    sc = scenarios.create_scenario(name="Empty", overrides={}, actor="u_maria")
    resp = client.post(f"/api/scenarios/{sc['id']}/promote", json={"maker": "u_maria"})
    assert resp.status_code == 409
    assert "no overrides" in resp.json()["detail"]
