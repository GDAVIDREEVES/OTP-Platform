"""TDD for the Model Canvas graph model + compiler (Phase 7 MC1).

The canvas is a VISUAL LAYER over the existing engine — these tests pin the
core principle: a graph compiles to a ``calc/expr.py`` expression and reuses the
unchanged evaluator/trace/scenario/lifecycle. Coverage:

* **Round-trip / semantic identity** — for a battery of expressions,
  ``expr_to_graph`` then ``graph_to_expr`` re-parses + evaluates EQUAL to the
  original formula (Decimal-exact), and a hand-built graph evaluates to the same
  value as the equivalent formula.
* **Validation** — rejects a cycle, a no-output graph, a two-output graph, an
  under-specified node (no silent default), a type-incompatible wiring.
* **Lifecycle parity** — a graph-authored ``user_calculations`` row
  tests/activates/scenario-overrides EXACTLY like a formula one, via the
  unchanged ``state/user_calcs.py`` + ``calc_registry`` path.
* **Per-node preview** — per-node values for a hand-checked 3-node graph.

Run from ``backend/``:  python -m pytest tests/test_calc_graph.py
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

import calc.expr as expr
import calc.graph as graph
import services.calc_registry as calc_registry
import state.parameters as parameters
import state.review as review
import state.user_calcs as user_calcs
from main import app

client = TestClient(app)

# A battery spanning every node type: param, measure (scalar + grain + filters),
# calc, const, op (all four), func (sum/min/max/abs), compare + if.
BATTERY = [
    "param('csa.growth')",
    "1 + param('csa.growth')",
    "param('csa.growth') * (1 + param('csa.growth'))",
    "measure('segment_pl.revenue')",
    "measure('segment_pl.revenue', 'group', 'GJAHR=2026')",
    "measure('segment_pl.revenue', 'entity', 'GJAHR=2026') * (1 + param('csa.growth'))",
    "calc('csa', 'pool')",
    "sum(measure('segment_pl.revenue'), measure('segment_pl.cogs'))",
    "abs(measure('segment_pl.cogs'))",
    "min(measure('segment_pl.revenue'), measure('segment_pl.cogs'))",
    "max(param('csa.growth'), 0.05)",
    "if(param('csa.growth') > 0, measure('segment_pl.revenue'), 0)",
    "100 - 40 * 2",
    "(measure('segment_pl.revenue') - measure('segment_pl.cogs')) / measure('segment_pl.revenue')",
]


def _eval_exact(expression: str):
    """Evaluate an expression to a comparable Decimal-exact JSON shape."""
    return expr.to_jsonable(expr.evaluate(expression))


# ----------------------------------------------------------- round-trip --


@pytest.mark.parametrize("expression", BATTERY)
def test_expr_to_graph_to_expr_round_trips(state_db, expression):
    """expr -> graph -> expr re-parses and evaluates EQUAL to the original."""
    parameters.seed_if_empty()
    g = graph.expr_to_graph(expression)
    report = graph.validate_graph(g)
    assert report["ok"], report["errors"]
    recompiled = graph.graph_to_expr(g)
    # Semantic identity: the recompiled string evaluates Decimal-exact-equal.
    assert _eval_exact(recompiled) == _eval_exact(expression)


@pytest.mark.parametrize("expression", BATTERY)
def test_graph_eval_equals_formula_eval(state_db, expression):
    """The graph's compiled expression evaluates to the SAME value as the
    formula (the canvas adds no new evaluation)."""
    parameters.seed_if_empty()
    g = graph.expr_to_graph(expression)
    compiled = graph.graph_to_expr(g)
    assert _eval_exact(compiled) == _eval_exact(expression)


def test_const_is_decimal_faithful():
    """A const node round-trips a decimal literal with no float drift."""
    g = graph.expr_to_graph("0.1 + 0.2")
    assert graph.graph_to_expr(g) == "(0.1 + 0.2)"
    out = expr.evaluate(graph.graph_to_expr(g))
    assert out == Decimal("0.3")


# ------------------------------------------------ hand-built graph eval --


def _output(in_node: str):
    return {"id": "out", "type": "output", "config": {},
            "position": {"x": 0, "y": 0}}, \
           {"source": in_node, "sourceHandle": "out",
            "target": "out", "targetHandle": "in"}


def test_hand_built_op_graph_matches_formula(state_db):
    """A hand-built param * (1 + param) graph evaluates to the formula's value."""
    parameters.seed_if_empty()
    out_node, out_edge = _output("mul")
    g = {
        "nodes": [
            {"id": "p", "type": "param", "config": {"key": "csa.growth"},
             "position": {"x": 0, "y": 0}},
            {"id": "one", "type": "const", "config": {"value": "1"},
             "position": {"x": 0, "y": 0}},
            {"id": "add", "type": "op", "config": {"op": "+"},
             "position": {"x": 0, "y": 0}},
            {"id": "mul", "type": "op", "config": {"op": "*"},
             "position": {"x": 0, "y": 0}},
            out_node,
        ],
        "edges": [
            {"source": "one", "sourceHandle": "out", "target": "add",
             "targetHandle": "a"},
            {"source": "p", "sourceHandle": "out", "target": "add",
             "targetHandle": "b"},
            {"source": "p", "sourceHandle": "out", "target": "mul",
             "targetHandle": "a"},
            {"source": "add", "sourceHandle": "out", "target": "mul",
             "targetHandle": "b"},
            out_edge,
        ],
    }
    assert graph.validate_graph(g)["ok"]
    compiled = graph.graph_to_expr(g)
    assert _eval_exact(compiled) == _eval_exact(
        "param('csa.growth') * (1 + param('csa.growth'))")


# ------------------------------------------------------------ validation --


def test_validate_rejects_cycle():
    g = {
        "nodes": [
            {"id": "a", "type": "op", "config": {"op": "+"},
             "position": {"x": 0, "y": 0}},
            {"id": "b", "type": "op", "config": {"op": "+"},
             "position": {"x": 0, "y": 0}},
            {"id": "c", "type": "const", "config": {"value": "1"},
             "position": {"x": 0, "y": 0}},
            {"id": "out", "type": "output", "config": {},
             "position": {"x": 0, "y": 0}},
        ],
        "edges": [
            # a <-> b cycle, both otherwise fully wired
            {"source": "b", "sourceHandle": "out", "target": "a",
             "targetHandle": "a"},
            {"source": "c", "sourceHandle": "out", "target": "a",
             "targetHandle": "b"},
            {"source": "a", "sourceHandle": "out", "target": "b",
             "targetHandle": "a"},
            {"source": "c", "sourceHandle": "out", "target": "b",
             "targetHandle": "b"},
            {"source": "a", "sourceHandle": "out", "target": "out",
             "targetHandle": "in"},
        ],
    }
    report = graph.validate_graph(g)
    assert not report["ok"]
    assert any("cycle" in e["message"] for e in report["errors"])


def test_validate_rejects_no_output():
    g = graph.expr_to_graph("param('csa.growth')")
    out_ids = {n["id"] for n in g["nodes"] if n["type"] == "output"}
    g["nodes"] = [n for n in g["nodes"] if n["type"] != "output"]
    g["edges"] = [e for e in g["edges"] if e["target"] not in out_ids]
    report = graph.validate_graph(g)
    assert not report["ok"]
    assert any("exactly one output" in e["message"] for e in report["errors"])


def test_validate_rejects_two_outputs():
    g = graph.expr_to_graph("param('csa.growth')")
    root = g["edges"][0]["source"]
    g["nodes"].append({"id": "out2", "type": "output", "config": {},
                       "position": {"x": 0, "y": 0}})
    g["edges"].append({"source": root, "sourceHandle": "out", "target": "out2",
                       "targetHandle": "in"})
    report = graph.validate_graph(g)
    assert not report["ok"]
    assert any("exactly one output" in e["message"] for e in report["errors"])


def test_validate_rejects_underspecified_node_no_silent_default():
    """A param node with no key is an error — never a silent default."""
    g = {
        "nodes": [
            {"id": "p", "type": "param", "config": {}, "position": {"x": 0, "y": 0}},
            {"id": "out", "type": "output", "config": {},
             "position": {"x": 0, "y": 0}},
        ],
        "edges": [{"source": "p", "sourceHandle": "out", "target": "out",
                   "targetHandle": "in"}],
    }
    report = graph.validate_graph(g)
    assert not report["ok"]
    assert any("config.key" in e["message"] for e in report["errors"])


def test_validate_rejects_type_incompatible_wiring():
    """A bool (compare output) cannot feed an op input that wants a value."""
    g = {
        "nodes": [
            {"id": "p", "type": "param", "config": {"key": "csa.growth"},
             "position": {"x": 0, "y": 0}},
            {"id": "z", "type": "const", "config": {"value": "0"},
             "position": {"x": 0, "y": 0}},
            {"id": "cmp", "type": "compare", "config": {"op": ">"},
             "position": {"x": 0, "y": 0}},
            {"id": "add", "type": "op", "config": {"op": "+"},
             "position": {"x": 0, "y": 0}},
            {"id": "out", "type": "output", "config": {},
             "position": {"x": 0, "y": 0}},
        ],
        "edges": [
            {"source": "p", "sourceHandle": "out", "target": "cmp",
             "targetHandle": "a"},
            {"source": "z", "sourceHandle": "out", "target": "cmp",
             "targetHandle": "b"},
            {"source": "cmp", "sourceHandle": "out", "target": "add",
             "targetHandle": "a"},
            {"source": "z", "sourceHandle": "out", "target": "add",
             "targetHandle": "b"},
            {"source": "add", "sourceHandle": "out", "target": "out",
             "targetHandle": "in"},
        ],
    }
    report = graph.validate_graph(g)
    assert not report["ok"]
    assert any("expects a value" in e["message"] for e in report["errors"])


def test_validate_rejects_unwired_op_input():
    g = {
        "nodes": [
            {"id": "c", "type": "const", "config": {"value": "1"},
             "position": {"x": 0, "y": 0}},
            {"id": "add", "type": "op", "config": {"op": "+"},
             "position": {"x": 0, "y": 0}},
            {"id": "out", "type": "output", "config": {},
             "position": {"x": 0, "y": 0}},
        ],
        "edges": [
            {"source": "c", "sourceHandle": "out", "target": "add",
             "targetHandle": "a"},
            {"source": "add", "sourceHandle": "out", "target": "out",
             "targetHandle": "in"},
        ],
    }
    report = graph.validate_graph(g)
    assert not report["ok"]
    assert any("'b' is not wired" in e["message"] for e in report["errors"])


def test_validate_rejects_unknown_node_type():
    g = {
        "nodes": [
            {"id": "x", "type": "frobnicate", "config": {},
             "position": {"x": 0, "y": 0}},
        ],
        "edges": [],
    }
    report = graph.validate_graph(g)
    assert not report["ok"]
    assert any("unknown node type" in e["message"] for e in report["errors"])


# ---------------------------------------------------- per-node preview --


def test_preview_per_node_values_three_node_graph(state_db):
    """A hand-checked 3-value graph: const 100 + const 25 -> 125."""
    g = {
        "nodes": [
            {"id": "a", "type": "const", "config": {"value": "100"},
             "position": {"x": 0, "y": 0}},
            {"id": "b", "type": "const", "config": {"value": "25"},
             "position": {"x": 0, "y": 0}},
            {"id": "add", "type": "op", "config": {"op": "+"},
             "position": {"x": 0, "y": 0}},
            {"id": "out", "type": "output", "config": {},
             "position": {"x": 0, "y": 0}},
        ],
        "edges": [
            {"source": "a", "sourceHandle": "out", "target": "add",
             "targetHandle": "a"},
            {"source": "b", "sourceHandle": "out", "target": "add",
             "targetHandle": "b"},
            {"source": "add", "sourceHandle": "out", "target": "out",
             "targetHandle": "in"},
        ],
    }
    r = client.post("/api/calc-graph/preview", json={"graph": g})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result"]["value_exact"] == "125"
    nodes = body["nodes"]
    assert nodes["a"]["result"]["value_exact"] == "100"
    assert nodes["b"]["result"]["value_exact"] == "25"
    assert nodes["add"]["result"]["value_exact"] == "125"
    assert "out" not in nodes  # output relays its input; no value of its own
    assert body["exceptions"] == []


def test_preview_rejects_invalid_graph():
    g = {"nodes": [{"id": "p", "type": "param", "config": {},
                    "position": {"x": 0, "y": 0}},
                   {"id": "out", "type": "output", "config": {},
                    "position": {"x": 0, "y": 0}}],
         "edges": [{"source": "p", "sourceHandle": "out", "target": "out",
                    "targetHandle": "in"}]}
    r = client.post("/api/calc-graph/preview", json={"graph": g})
    assert r.status_code == 400


def _param_times_two_graph(key: str) -> dict:
    """param(key) * 2 -> output (a deterministic scalar graph for overlay tests)."""
    return {
        "nodes": [
            {"id": "p", "type": "param", "config": {"key": key},
             "position": {"x": 0, "y": 0}},
            {"id": "two", "type": "const", "config": {"value": "2"},
             "position": {"x": 0, "y": 0}},
            {"id": "mul", "type": "op", "config": {"op": "*"},
             "position": {"x": 0, "y": 0}},
            {"id": "out", "type": "output", "config": {},
             "position": {"x": 0, "y": 0}},
        ],
        "edges": [
            {"source": "p", "sourceHandle": "out", "target": "mul",
             "targetHandle": "a"},
            {"source": "two", "sourceHandle": "out", "target": "mul",
             "targetHandle": "b"},
            {"source": "mul", "sourceHandle": "out", "target": "out",
             "targetHandle": "in"},
        ],
    }


def test_preview_scenario_overlay_paints_whatif_values(state_db):
    """The MC2 Base⟷Scenario toggle: preview under an ``overrides`` overlay
    re-evaluates the whole graph (and every node) with the what-if value, reusing
    the EXISTING parameters.overrides contextvar — no new evaluator.

    beat.rate_pct seeds to 10.0, so param(rate)*2 == 20 at base; overlaying
    15.0 yields 30 on both the whole-graph result and the param node."""
    parameters.seed_if_empty()
    base_rate = parameters.get_param("beat.rate_pct")
    assert Decimal(str(base_rate)) == Decimal("10.0")
    g = _param_times_two_graph("beat.rate_pct")

    base = client.post("/api/calc-graph/preview", json={"graph": g}).json()
    assert Decimal(base["result"]["value_exact"]) == Decimal("20.0")
    assert Decimal(base["nodes"]["p"]["result"]["value_exact"]) == Decimal("10.0")

    scen = client.post(
        "/api/calc-graph/preview",
        json={"graph": g, "overrides": {"beat.rate_pct": 15.0}},
    ).json()
    assert Decimal(scen["result"]["value_exact"]) == Decimal("30.0")
    assert Decimal(scen["nodes"]["p"]["result"]["value_exact"]) == Decimal("15.0")
    # The param trace step is flagged overridden inside the overlay.
    overridden = [s for s in scen["trace"] if s.get("step") == "param" and s.get("overridden")]
    assert any(s["key"] == "beat.rate_pct" for s in overridden)

    # The governed store is never written — the overlay is request-scoped only.
    assert Decimal(str(parameters.get_param("beat.rate_pct"))) == Decimal("10.0")


def test_preview_empty_overrides_is_byte_identical_to_base(state_db):
    """An omitted / empty ``overrides`` is a pure no-op — the response is
    identical to the plain base preview (golden non-regression for every
    existing caller)."""
    parameters.seed_if_empty()
    g = _param_times_two_graph("beat.rate_pct")
    plain = client.post("/api/calc-graph/preview", json={"graph": g}).json()
    empty = client.post(
        "/api/calc-graph/preview", json={"graph": g, "overrides": {}}
    ).json()
    assert plain == empty


# --------------------------------------------------------- node-types --


def test_node_types_catalogue(state_db):
    r = client.get("/api/calc-graph/node-types")
    assert r.status_code == 200, r.text
    body = r.json()
    types = {t["type"] for t in body["node_types"]}
    assert {"param", "measure", "calc", "const", "op", "func", "if",
            "compare", "output"} <= types
    # service_allocation is non-composable -> not offered as a calc node source.
    calc_ids = {c["id"] for c in body["calcs"]}
    assert "service_allocation" not in calc_ids
    assert "csa" in calc_ids
    # measures + params come from the same registries the evaluator enforces.
    assert any(m["table"] == "segment_pl" for m in body["measures"])


def test_validate_endpoint(state_db):
    g = graph.expr_to_graph("1 + param('csa.growth')")
    r = client.post("/api/calc-graph/validate", json={"graph": g})
    assert r.status_code == 200
    assert r.json()["ok"] is True


# ---------------------------------------------- lifecycle parity (graph) --


def _pending_item(uid: str) -> dict:
    return next(i for i in review.list_queue() if i["record_ref"] == f"ucalc:{uid}")


def test_graph_authored_user_calc_full_lifecycle(state_db):
    """A graph-authored calc creates with the COMPILED expression, tests,
    activates via maker-checker, and runs through the registry — exactly the
    formula path. The stored graph round-trips back out."""
    parameters.seed_if_empty()
    g = graph.expr_to_graph(
        "measure('segment_pl.revenue', 'entity', 'GJAHR=2026') * (1 + param('csa.growth'))")
    created = user_calcs.create_user_calc(
        name="Projected revenue (canvas)", graph_json=g, actor="u_maria",
        output_grain="entity",
    )
    # The compiled expression is the source of truth and validates.
    assert created["expression"]
    assert _eval_exact(created["expression"])  # evaluable
    # The stored graph is fetchable and recompiles to the same expression.
    fetched = user_calcs.get_user_calc_graph(created["id"])
    assert graph.graph_to_expr(fetched) == created["expression"]

    # Lifecycle: test -> submit -> approve (different checker).
    user_calcs.test_run(created["id"], actor="u_maria")
    assert user_calcs.get_user_calc(created["id"])["status"] == "tested"
    user_calcs.submit_for_activation(created["id"], maker="u_maria")
    review.decide(_pending_item(created["id"])["id"], checker="u_sam",
                  decision="approve")
    assert user_calcs.get_user_calc(created["id"])["status"] == "active"

    # Runs through the registry like any active calc, and a scenario override
    # of csa.growth changes the result without contaminating the base.
    base = calc_registry.run(created["id"], actor="u_sam")
    scen = calc_registry.run(created["id"], actor="u_sam",
                             scenario_overrides={"csa.growth": 0.20})
    assert base["output"]["total_exact"] != scen["output"]["total_exact"]
    base_again = calc_registry.run(created["id"], actor="u_sam")
    assert base_again["output"]["total_exact"] == base["output"]["total_exact"]


def test_graph_and_formula_authored_calc_are_identical(state_db):
    """Same logic authored as a graph vs a formula -> identical stored
    expression and identical test-run result."""
    parameters.seed_if_empty()
    formula = "1 + param('csa.growth')"
    f = user_calcs.create_user_calc(name="f", expression=formula, actor="u_maria")
    g = user_calcs.create_user_calc(
        name="g", graph_json=graph.expr_to_graph(formula), actor="u_maria")
    fr = user_calcs.test_run(f["id"], actor="u_maria")
    gr = user_calcs.test_run(g["id"], actor="u_maria")
    assert fr["result"]["value_exact"] == gr["result"]["value_exact"]


def test_create_rejects_both_expression_and_graph(state_db):
    with pytest.raises(ValueError, match="exactly one"):
        user_calcs.create_user_calc(
            name="bad", expression="1", graph_json=graph.expr_to_graph("1"),
            actor="u_maria")


def test_create_rejects_neither_expression_nor_graph(state_db):
    with pytest.raises(ValueError, match="exactly one"):
        user_calcs.create_user_calc(name="bad", actor="u_maria")


def test_http_create_from_graph_then_fetch_graph(state_db):
    parameters.seed_if_empty()
    g = graph.expr_to_graph("1 + param('csa.growth')")
    r = client.post("/api/user-calcs", json={
        "name": "via http", "graph": g, "actor": "u_maria"})
    assert r.status_code == 200, r.text
    uid = r.json()["id"]
    gr = client.get(f"/api/user-calcs/{uid}/graph")
    assert gr.status_code == 200
    assert graph.graph_to_expr(gr.json()) == r.json()["expression"]
