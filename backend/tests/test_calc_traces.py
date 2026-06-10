"""TDD for the shaped traces + lineage graph (services/calc_traces.py, CS-d).

The curated csa/profit_split/beat decompositions must carry the named steps
AND tie out to the run output (the pool step's pool == output.pool, …) — the
drift guard for a handler-formula change. Every step source must resolve in
the catalog, for all 14 calculations. The graph endpoint must serve a sound
DAG: unique node ids, every edge endpoint present, and exactly one parameter
node per seeded governed parameter.

Run from `backend/`:  python -m pytest tests/test_calc_traces.py
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import services.calc_registry as calc_registry
import services.calc_traces as calc_traces
import services.catalog as catalog
import state.parameters as parameters
from main import app

client = TestClient(app)

ALL_IDS = [d["id"] for d in calc_registry.defs()]

CSA_STEP_IDS = ["aggregate", "projected_sales", "pool", "rab_shares", "true_ups", "pct_buyins"]
PS_STEP_IDS = ["aggregate", "key_totals", "residual_shares", "allocated", "true_ups"]
BEAT_STEP_IDS = ["deductions", "classification", "base_eroding", "erosion_test", "mti", "beat_tax"]


def _shape(calc_id: str, with_output: bool = True):
    """Run fresh via the registry and shape (curated path passes the output)."""
    run = calc_registry.run(calc_id, actor="t")
    d = calc_registry.get_def(calc_id)
    shaped = calc_traces.shape_trace(run, d, output=run["output"] if with_output else None)
    return run, shaped


# --- Curated decompositions ------------------------------------------------------

def test_csa_shaped_trace_has_the_six_named_steps(state_db):
    parameters.seed_if_empty()
    _, shaped = _shape("csa")
    assert [s["id"] for s in shaped] == CSA_STEP_IDS


def test_csa_pool_step_ties_out_to_run_output(state_db):
    parameters.seed_if_empty()
    run, shaped = _shape("csa")
    pool_step = next(s for s in shaped if s["id"] == "pool")
    assert pool_step["values"]["pool"] == run["output"]["pool"]


def test_csa_steps_carry_their_governed_params(state_db):
    parameters.seed_if_empty()
    _, shaped = _shape("csa")
    growth = next(s for s in shaped if s["id"] == "projected_sales")["params"]
    assert [p["key"] for p in growth] == ["csa.growth"]
    assert growth[0]["overridden"] is False
    pct = next(s for s in shaped if s["id"] == "pct_buyins")["params"]
    assert [p["key"] for p in pct] == ["csa.pct_mult"]


def test_csa_fresh_run_carries_per_participant_values(state_db):
    parameters.seed_if_empty()
    run, shaped = _shape("csa")
    rab = next(s for s in shaped if s["id"] == "rab_shares")
    for p in run["output"]["participants"]:
        assert rab["values"][p["rbukrs"]] == p["rab_share"]


def test_csa_shapes_without_output_retroactively(state_db):
    """Historical runs (no persisted output body) still get all six steps,
    with the pool figure recovered from the stored summary."""
    parameters.seed_if_empty()
    run, shaped = _shape("csa", with_output=False)
    assert [s["id"] for s in shaped] == CSA_STEP_IDS
    pool_step = next(s for s in shaped if s["id"] == "pool")
    assert pool_step["values"]["pool"] == run["summary"]["pool"]


def test_profit_split_shaped_trace_steps_and_tie_out(state_db):
    parameters.seed_if_empty()
    run, shaped = _shape("profit_split")
    assert [s["id"] for s in shaped] == PS_STEP_IDS
    allocated = next(s for s in shaped if s["id"] == "allocated")
    assert allocated["values"]["combined_profit"] == run["output"]["combined_profit"]


def test_beat_shaped_trace_steps_and_tie_out(state_db):
    parameters.seed_if_empty()
    run, shaped = _shape("beat")
    assert [s["id"] for s in shaped] == BEAT_STEP_IDS
    eroding = next(s for s in shaped if s["id"] == "base_eroding")
    assert eroding["values"]["base_eroding_payments"] == run["output"]["base_eroding_payments"]
    tax = next(s for s in shaped if s["id"] == "beat_tax")
    assert tax["values"]["beat_base_tax"] == run["output"]["beat_base_tax"]


def test_beat_classification_carries_the_racct_rule(state_db):
    parameters.seed_if_empty()
    _, shaped = _shape("beat")
    cls = next(s for s in shaped if s["id"] == "classification")
    assert {p["key"] for p in cls["params"]} == {"beat.racct_type", "beat.payment_types"}


# --- Generic fallback ------------------------------------------------------------

def test_generic_fallback_inputs_then_output(state_db):
    parameters.seed_if_empty()
    run, shaped = _shape("treasury")
    assert [s["id"] for s in shaped] == ["inputs", "output"]
    d = calc_registry.get_def("treasury")
    assert shaped[0]["sources"] == d["inputs"]["catalog"]
    assert shaped[1]["values"]["digest"] == run["output_digest"]


def test_generic_fallback_summary_in_output_step(state_db):
    parameters.seed_if_empty()
    run, shaped = _shape("flows")
    assert shaped[1]["values"]["rows"] == run["summary"]["rows"]


@pytest.mark.parametrize("calc_id", ALL_IDS)
def test_every_step_source_resolves_in_the_catalog(state_db, calc_id):
    parameters.seed_if_empty()
    _, shaped = _shape(calc_id)
    d = calc_registry.get_def(calc_id)
    for step in shaped:
        for sid in step["sources"]:
            assert sid in d["inputs"]["catalog"], f"{calc_id}/{step['id']}: {sid} not a def input"
            assert catalog.entry(sid) is not None, f"{calc_id}/{step['id']}: {sid} not in catalog"


# --- Shaped traces over HTTP -------------------------------------------------------

def test_post_run_returns_shaped_trace(state_db):
    parameters.seed_if_empty()
    resp = client.post("/api/calcs/csa/run", json={"actor": "t"})
    assert resp.status_code == 200
    body = resp.json()
    assert [s["id"] for s in body["shaped_trace"]] == CSA_STEP_IDS
    # Fresh runs shape with the full output → per-participant figures present.
    rab = next(s for s in body["shaped_trace"] if s["id"] == "rab_shares")
    assert "1000" in rab["values"]


def test_get_run_shaped_query_param(state_db):
    parameters.seed_if_empty()
    run = calc_registry.run("csa", actor="t")
    plain = client.get(f"/api/runs/{run['id']}")
    assert plain.status_code == 200
    assert "shaped_trace" not in plain.json()
    shaped = client.get(f"/api/runs/{run['id']}", params={"shaped": "true"})
    assert shaped.status_code == 200
    assert [s["id"] for s in shaped.json()["shaped_trace"]] == CSA_STEP_IDS


# --- Lineage graph ----------------------------------------------------------------

def test_graph_node_ids_unique_and_edges_resolve(state_db):
    parameters.seed_if_empty()
    g = calc_registry.graph()
    ids = [n["id"] for n in g["nodes"]]
    assert len(ids) == len(set(ids))
    id_set = set(ids)
    for e in g["edges"]:
        assert e["from"] in id_set, f"dangling edge source {e['from']}"
        assert e["to"] in id_set, f"dangling edge target {e['to']}"


def test_graph_parameter_column_matches_seeded_param_count(state_db):
    parameters.seed_if_empty()
    g = calc_registry.graph()
    param_nodes = [n for n in g["nodes"] if n["kind"] == "parameter"]
    assert all(n["column"] == 1 for n in param_nodes)
    assert len(param_nodes) == len(parameters.list_params())


def test_graph_kinds_map_to_their_columns(state_db):
    parameters.seed_if_empty()
    g = calc_registry.graph()
    expected = {"source": 0, "parameter": 1, "calculation": 2, "process": 3}
    for n in g["nodes"]:
        assert n["column"] == expected[n["kind"]], n["id"]
    calc_nodes = {n["id"] for n in g["nodes"] if n["kind"] == "calculation"}
    assert calc_nodes == set(ALL_IDS)


def test_graph_endpoint_not_shadowed_by_calc_id_route(state_db):
    """/api/calcs/graph must be registered before /api/calcs/{calc_id}."""
    parameters.seed_if_empty()
    resp = client.get("/api/calcs/graph")
    assert resp.status_code == 200
    body = resp.json()
    assert {n["id"] for n in body["nodes"]} == {n["id"] for n in calc_registry.graph()["nodes"]}
