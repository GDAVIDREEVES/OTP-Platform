"""TDD for the Model Canvas ALLOCATION stage nodes (Phase 7 MC3).

The allocation side of the canvas is a VISUAL LAYER over the authored-pool
engine (PB2) — there is NO new allocation engine here. A stage graph
(source → pool → benefit_test → allocate → markup → charge → recon) compiles to
exactly the authored-pool ``definition`` PB2 consumes, so it previews / tests /
runs through the unchanged Stages 1-7 in isolation. Coverage:

* **Compile + dry-run parity** — a hand-built stage graph compiles to a
  definition whose dry-run reconciles to ZERO residual (V-X1), identical to the
  equivalent hand-authored pool.
* **Stage order** — canonical order validates; an out-of-order stage connection
  and a missing stage are rejected (no silent defaults).
* **Calc-bound numeric input** — a calc-value subgraph wired into ``markup.pct``
  compiles to an ``expr.py`` string that evaluates at RUN time (a governed
  parameter drives the markup %); the priced charge reflects the bound %.
* **GOLDEN** — the governed allocation run (actual, all periods) stays cent-exact
  (FY gross 14,344,773.26); stage graphs never touch it.

NO float arithmetic on amounts anywhere (ENGINE-CLAUDE.md).

Run from backend/:  ../.venv/bin/python -m pytest tests/test_calc_graph_alloc.py
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

import calc.graph as graph
import services.allocation_runner as runner
import state.allocation_store as store
import state.authored_pools as authored_pools
import state.engine as engine
import state.parameters as parameters
import state.review as review
from main import app

client = TestClient(app)

ZERO = Decimal("0")


# ----------------------------------------------------------------- fixtures --


@pytest.fixture()
def db(tmp_path):
    """An isolated state DB per test (authored pools live in SQLite)."""
    engine.configure(tmp_path / "state.db")
    engine.init_db()
    parameters.seed_if_empty()
    yield
    engine.close()


def _node(nid: str, typ: str, config: dict | None = None) -> dict:
    return {"id": nid, "type": typ, "config": config or {}, "position": {"x": 0, "y": 0}}


def _flow(src: str, tgt: str) -> dict:
    return {"source": src, "sourceHandle": "out", "target": tgt, "targetHandle": "in"}


# A sound stage graph mirroring tests/allocation/test_pb2 _sound_def(): capture
# provider-1000 IT-OPS cost centers, beneficiary 3000 (DE), Equal key, one DE
# markup policy. Touches 2026-05 / 2026-11.
def _sound_stage_graph(extra_nodes=None, extra_edges=None) -> dict:
    nodes = [
        _node("src", "source", {"cost_capture_rule": {
            "cost_centers": ["CC-1000-IT-OPS-ERP", "CC-1000-IT-OPS-SUPPORT"]}}),
        _node("pool", "pool", {
            "name": "Authored IT Ops (canvas)",
            "provider_entity_id": "1000",
            "service_line": "IT",
            "characterization": "Routine-benchmarked",
            "cost_base_definition": "Total services cost"}),
        _node("ben", "benefit_test", {"beneficiaries": ["3000"], "exclusions": []}),
        _node("alloc", "allocate", {"key_factor": "Equal"}),
        _node("mk", "markup", {"markup_policies": [{
            "jurisdiction": "DE", "regime": "Benchmarked",
            "markup_pct": "0.05", "benchmark_study_ref": "BM-AP-DE"}]}),
        _node("chg", "charge", {}),
        _node("rec", "recon", {}),
    ]
    edges = [
        _flow("src", "pool"), _flow("pool", "ben"), _flow("ben", "alloc"),
        _flow("alloc", "mk"), _flow("mk", "chg"), _flow("chg", "rec"),
    ]
    nodes.extend(extra_nodes or [])
    edges.extend(extra_edges or [])
    return {"nodes": nodes, "edges": edges}


# ------------------------------------------------------ compile + dry-run --


def test_stage_graph_compiles_to_definition_that_dry_runs_zero_residual(db):
    """A sound stage graph compiles to an authored-pool definition that dry-runs
    Balanced with zero residual — identical to the equivalent hand-authored pool
    (the canvas reuses the PB2 engine unchanged)."""
    g = _sound_stage_graph()
    rep = graph.validate_stage_graph(g)
    assert rep["ok"], rep["errors"]
    assert rep["order"] == ["src", "pool", "ben", "alloc", "mk", "chg", "rec"]

    definition = graph.stage_graph_to_pool_definition(g)
    # Structurally valid as an authored pool (the PB2 validator is the SoT).
    assert authored_pools.validate_definition(definition) == []

    dry = runner.dry_run_authored_pool(definition, pool_id="AP-CANVAS")
    assert dry["periods"] == ["2026-05", "2026-11"]
    assert dry["balanced"] is True
    assert dry["exceptions"] == []
    assert dry["charges"]
    for row in dry["recon"]:
        assert row["recon_status"] == "Balanced"
        assert Decimal(row["unallocated_residual"]) == ZERO


def test_stage_graph_definition_matches_hand_authored_pool(db):
    """The compiled definition is the same object PB2 builds by hand — same
    captured cost, same charged-out total."""
    hand = {
        "name": "Authored IT Ops (canvas)",
        "provider_entity_id": "1000",
        "service_line": "IT",
        "characterization": "Routine-benchmarked",
        "cost_base_definition": "Total services cost",
        "cost_capture_rule": {
            "cost_centers": ["CC-1000-IT-OPS-ERP", "CC-1000-IT-OPS-SUPPORT"]},
        "beneficiaries": ["3000"],
        "key": {"key_factor": "Equal"},
        "exclusions": [],
        "markup_policies": [{
            "jurisdiction": "DE", "regime": "Benchmarked",
            "markup_pct": "0.05", "benchmark_study_ref": "BM-AP-DE"}],
    }
    compiled = graph.stage_graph_to_pool_definition(_sound_stage_graph())
    a = runner.dry_run_authored_pool(hand, pool_id="AP-HAND")
    b = runner.dry_run_authored_pool(compiled, pool_id="AP-HAND")
    assert a["total_charged_out"] == b["total_charged_out"]
    assert a["balanced"] == b["balanced"] is True


def test_stage_graph_full_authored_lifecycle(db):
    """A stage-graph pool stores its graph_json, tests, activates via
    maker-checker and runs — exactly the PB2 path."""
    g = _sound_stage_graph()
    definition = graph.stage_graph_to_pool_definition(g)
    p = authored_pools.create_authored_pool(graph_json=g, actor="maker1")
    assert p["status"] == "draft"
    assert p["definition"] == definition
    # The stored graph is fetchable and recompiles to the same definition.
    fetched = authored_pools.get_authored_pool_graph(p["id"])
    assert graph.stage_graph_to_pool_definition(fetched) == definition

    res = authored_pools.test_run(p["id"], actor="maker1")
    assert res["tested"] is True
    authored_pools.submit_for_activation(p["id"], maker="maker1")
    item = next(i for i in review.list_queue()
                if i["record_ref"] == f"allocpool:{p['id']}")
    review.decide(item["id"], checker="checker1", decision="approve")
    assert authored_pools.get_authored_pool(p["id"])["status"] == "active"


# --------------------------------------------------------------- ordering --


def test_validate_rejects_out_of_order_stage_connection(db):
    """Wiring markup directly after pool (skipping benefit_test/allocate) is an
    out-of-order stage connection — rejected, never silently reordered."""
    g = _sound_stage_graph()
    # Rewire: markup.in now comes from pool (not allocate).
    g["edges"] = [e for e in g["edges"] if e["target"] != "mk"]
    g["edges"].append(_flow("pool", "mk"))
    rep = graph.validate_stage_graph(g)
    assert rep["ok"] is False
    assert any("out-of-order" in e["message"] or "must follow" in e["message"]
               for e in rep["errors"])


def test_validate_rejects_missing_stage(db):
    """Dropping the recon stage is a missing-stage error (no silent default)."""
    g = _sound_stage_graph()
    g["nodes"] = [n for n in g["nodes"] if n["id"] != "rec"]
    g["edges"] = [e for e in g["edges"] if e["target"] != "rec"]
    rep = graph.validate_stage_graph(g)
    assert rep["ok"] is False
    assert any("missing" in e["message"] and "recon" in e["message"]
               for e in rep["errors"])


def test_validate_rejects_underspecified_stage_no_silent_default(db):
    """A pool stage with no provider is an error surfaced via compile — never
    defaulted (it would BLOCK at engine time as V-rules anyway)."""
    g = _sound_stage_graph()
    for n in g["nodes"]:
        if n["id"] == "pool":
            n["config"].pop("provider_entity_id")
    rep = graph.validate_stage_graph(g)
    assert rep["ok"] is False


def test_validate_endpoint_covers_stage_order(db):
    """POST /api/calc-graph/validate routes a stage graph through the stage-order
    validator and returns the same {ok, errors} shape as a calc graph."""
    g = _sound_stage_graph()
    r = client.post("/api/calc-graph/validate", json={"graph": g})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    g["edges"] = [e for e in g["edges"] if e["target"] != "mk"]
    g["edges"].append(_flow("pool", "mk"))
    bad = client.post("/api/calc-graph/validate", json={"graph": g})
    assert bad.json()["ok"] is False


def test_node_types_catalogue_includes_stage_family(db):
    r = client.get("/api/calc-graph/node-types")
    assert r.status_code == 200, r.text
    body = r.json()
    stage_types = {t["type"] for t in body["stage_types"]}
    assert stage_types == {"source", "pool", "benefit_test", "allocate",
                           "markup", "charge", "recon"}
    assert body["stage_order"] == [
        "source", "pool", "benefit_test", "allocate", "markup", "charge", "recon"]


# ----------------------------------------------------- calc-bound markup % --


def _const_pct_subgraph(stage_id: str, value: str) -> tuple[list[dict], list[dict]]:
    """A trivial calc-value subgraph (a single const) wired into ``stage.pct``."""
    nodes = [_node("k", "const", {"value": value})]
    edges = [{"source": "k", "sourceHandle": "out",
              "target": stage_id, "targetHandle": "pct"}]
    return nodes, edges


def test_calc_bound_markup_pct_compiles_to_expr(db):
    """A const(0.07) wired into markup.pct compiles to an expr string stored on
    every markup policy as markup_pct_expr."""
    extra_n, extra_e = _const_pct_subgraph("mk", "0.07")
    g = _sound_stage_graph(extra_n, extra_e)
    rep = graph.validate_stage_graph(g)
    assert rep["ok"], rep["errors"]
    definition = graph.stage_graph_to_pool_definition(g)
    assert definition["markup_policies"][0]["markup_pct_expr"] == "0.07"


def test_calc_bound_markup_pct_evaluates_at_run(db):
    """The bound % is evaluated at RUN time (not the literal): pricing a stage
    graph with const(0.10) bound into markup.pct yields a 10% markup, overriding
    the literal 0.05 fallback."""
    extra_n, extra_e = _const_pct_subgraph("mk", "0.10")
    g = _sound_stage_graph(extra_n, extra_e)
    definition = graph.stage_graph_to_pool_definition(g)
    dry = runner.dry_run_authored_pool(definition, pool_id="AP-BOUND")
    assert dry["balanced"] is True
    # Every priced charge applied the BOUND 10%, not the literal 5%.
    assert dry["charges"]
    for c in dry["charges"]:
        assert Decimal(c["markup_pct_applied"]) == Decimal("0.10")


def test_calc_bound_markup_pct_from_governed_param(db):
    """A governed parameter drives the markup % through the unchanged evaluator:
    param('beat.rate_pct') seeds to 10.0; bound as 10.0/100 == 0.10."""
    sub_nodes = [
        _node("p", "param", {"key": "beat.rate_pct"}),
        _node("hundred", "const", {"value": "100"}),
        _node("div", "op", {"op": "/"}),
    ]
    sub_edges = [
        {"source": "p", "sourceHandle": "out", "target": "div", "targetHandle": "a"},
        {"source": "hundred", "sourceHandle": "out", "target": "div", "targetHandle": "b"},
        {"source": "div", "sourceHandle": "out", "target": "mk", "targetHandle": "pct"},
    ]
    g = _sound_stage_graph(sub_nodes, sub_edges)
    rep = graph.validate_stage_graph(g)
    assert rep["ok"], rep["errors"]
    definition = graph.stage_graph_to_pool_definition(g)
    assert definition["markup_policies"][0]["markup_pct_expr"] == "(param('beat.rate_pct') / 100)"
    dry = runner.dry_run_authored_pool(definition, pool_id="AP-PARAM")
    assert dry["balanced"] is True
    for c in dry["charges"]:
        assert Decimal(c["markup_pct_applied"]) == Decimal("0.10")


def test_bad_calc_binding_into_unknown_stage_input_rejected(db):
    """A calc value wired into a non-numeric stage input (charge has none) is a
    validation error, not a silent drop."""
    nodes = [_node("k", "const", {"value": "1"})]
    edges = [{"source": "k", "sourceHandle": "out",
              "target": "chg", "targetHandle": "pct"}]
    g = _sound_stage_graph(nodes, edges)
    rep = graph.validate_stage_graph(g)
    assert rep["ok"] is False
    assert any("numeric input" in e["message"] for e in rep["errors"])


# ----------------------------------------------------- preview/test routes --


def test_pool_preview_accepts_stage_graph(db):
    """POST /api/allocation/pools/preview-graph compiles a stage graph and returns
    the per-stage dry-run results (captured cost, charges, recon zero residual)."""
    g = _sound_stage_graph()
    r = client.post("/api/allocation/pools/preview-graph", json={"graph": g})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["balanced"] is True
    # Per-stage results painted onto the stage node ids.
    stages = body["stages"]
    assert Decimal(stages["src"]["captured_amount"]) > ZERO
    assert stages["rec"]["balanced"] is True
    assert Decimal(stages["rec"]["residual"]) == ZERO


def test_pool_create_from_graph_then_fetch_graph(db):
    """POST /api/allocation/pools with a graph stores graph_json; GET .../graph
    returns it and it recompiles to the stored definition."""
    g = _sound_stage_graph()
    r = client.post("/api/allocation/pools", json={
        "graph": g, "actor": "maker1"})
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    gr = client.get(f"/api/allocation/pools/{pid}/graph")
    assert gr.status_code == 200, gr.text
    assert graph.stage_graph_to_pool_definition(gr.json()) == r.json()["definition"]


# ----------------------------------------------------------------- GOLDEN --


def test_golden_governed_run_unchanged_by_stage_graphs(db):
    """The governed demo allocation (actual, all four periods) is cent-exact:
    FY gross == 14,344,773.26 — even with a stage-graph-authored pool active in
    the same DB. Stage graphs are isolated experiments and never perturb the
    governed tie-out."""
    # Author + activate a stage-graph pool in this DB.
    g = _sound_stage_graph()
    p = authored_pools.create_authored_pool(graph_json=g, actor="maker1")
    authored_pools.test_run(p["id"], actor="maker1")
    authored_pools.submit_for_activation(p["id"], maker="maker1")
    item = next(i for i in review.list_queue("pending")
                if i["record_ref"] == f"allocpool:{p['id']}")
    review.decide(item["id"], checker="checker1", decision="approve")
    runner.run_authored_allocation(period="2026-05", actor="ops")

    fy_gross = ZERO
    for period in ["2026-04", "2026-05", "2026-10", "2026-11"]:
        res = runner.run_allocation(period=period, run_type="actual", actor="gov")
        assert res["summary"]["status"] == "succeeded"
        for row in store.list_charges(run_id=res["run_id"]):
            fy_gross += Decimal(row["gross_charge_amount"])
    assert fy_gross == Decimal("14344773.26")
