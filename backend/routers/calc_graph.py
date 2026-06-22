"""Model Canvas graph API (Phase 7 MC1).

Thin router over ``calc/graph.py`` (the graph model + bidirectional compiler)
and the unchanged ``calc/expr.py`` evaluator. The canvas is a VISUAL LAYER:
a graph is compiled to an ``expr.py`` expression string and evaluated by the
existing engine — there is no new evaluation here.

* ``GET  /api/calc-graph/node-types`` — the palette catalogue: every node type
  with its input/output handle kinds + config schema, plus the measure
  allowlist (``expr.MEASURE_TABLES``), governed parameters (the store) and the
  composable calcs (registry minus ``expr._NON_COMPOSABLE``). Pure read.
* ``POST /api/calc-graph/validate`` — ``graph.validate_graph`` -> ``{ok,
  errors}``. Pure read; nothing persists.
* ``POST /api/calc-graph/preview`` — compile the graph to an expression,
  evaluate it (traced), and additionally compile + evaluate each node's
  subgraph to paint a per-node value. Returns ``{result, grain, nodes, trace,
  exceptions}``. Pure read; nothing persists.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from contextlib import nullcontext

import calc.expr as expr
import calc.graph as graph
import calc.trace as trace
import services.calc_registry as calc_registry
import state.parameters as parameters
from schemas.calc_graph import GraphIn

router = APIRouter()


@router.get("/api/calc-graph/node-types")
def node_types():
    """The palette catalogue. Node-type handle/config schemas come straight from
    ``graph.NODE_TYPES``; the leaf data sources (measures / params / calcs) come
    from the same registries validate + evaluate enforce, so the palette can
    never offer a term a run would reject."""
    types = []
    for typ, spec in graph.NODE_TYPES.items():
        inputs = (
            "variadic" if spec["inputs"] == "variadic"
            else [{"handle": h, "kind": k} for h, k in spec["inputs"].items()]
        )
        types.append({
            "type": typ,
            "family": spec["family"],
            "inputs": inputs,
            "output": spec["output"],
            "config": list(spec["config"]),
        })
    measures = [
        {
            "table": table,
            "catalog_id": spec["catalog_id"],
            "measures": list(spec["measures"]),
            "grains": {g: list(cols) for g, cols in spec["grains"].items()},
            "filters": spec["filters"],
        }
        for table, spec in expr.MEASURE_TABLES.items()
    ]
    params = [
        {"key": p["key"], "value": p.get("value"), "type": p.get("type"),
         "category": p.get("category"), "unit": p.get("unit")}
        for p in parameters.list_params()
    ]
    calcs = [
        {"id": d["id"], "name": d.get("name"), "process_id": d.get("process_id")}
        for d in calc_registry.defs()
        if d["id"] not in expr._NON_COMPOSABLE
    ]
    return {
        "node_types": types,
        "operators": list(graph._OP_SYMBOLS),
        "comparators": list(graph._COMPARE_SYMBOLS),
        "functions": list(graph._FUNCS),
        "grains": list(expr.GRAINS),
        "measures": measures,
        "parameters": params,
        "calcs": calcs,
        "non_composable": sorted(expr._NON_COMPOSABLE),
    }


@router.post("/api/calc-graph/validate")
def validate_graph(payload: GraphIn):
    """Structural validation report: ``{ok, errors: [{message, node_id}],
    output_id}``. Nothing persists."""
    return graph.validate_graph(payload.graph)


@router.post("/api/calc-graph/preview")
def preview_graph(payload: GraphIn):
    """Compile the graph to an expression, evaluate it (traced), and paint a
    per-node value by compiling + evaluating each node's subgraph. A node whose
    subgraph fails (e.g. a grain mismatch) reports its exception in
    ``exceptions`` and a null value instead of aborting the whole preview.
    Nothing persists.

    When ``overrides`` is supplied (the cockpit's Scenario side of the
    Base⟷Scenario toggle) the WHOLE preview is evaluated inside the existing
    ``parameters.overrides`` overlay — the same contextvar a scenario run uses,
    so the values paint exactly the scenario figures. Omitted/empty it is a
    no-op and the response is identical to the base preview (golden)."""
    report = graph.validate_graph(payload.graph)
    if not report["ok"]:
        raise HTTPException(status_code=400, detail={"errors": report["errors"]})

    overlay = (
        parameters.overrides(payload.overrides)
        if payload.overrides else nullcontext()
    )
    with overlay:
        # The whole-graph result + the canonical trace come from one evaluation
        # of the compiled expression.
        expression = graph.graph_to_expr(payload.graph)
        with trace.collect() as steps:
            try:
                value = expr.evaluate(expression)
            except expr.ExprError as e:
                raise HTTPException(
                    status_code=400, detail={"message": e.message, "pos": e.pos})
        result = expr.to_jsonable(value)
        grain = expr.result_grain(value)

        # Per-node values: compile + evaluate each node's own subgraph. Failures
        # are captured per node (never abort the preview) so the canvas can show
        # the one node that is wrong.
        node_values: dict[str, dict] = {}
        exceptions: list[dict] = []
        for nid, node_expr in graph.node_exprs(payload.graph).items():
            try:
                nv = expr.evaluate(node_expr)
                node_values[nid] = {
                    "ok": True,
                    "grain": expr.result_grain(nv),
                    "result": expr.to_jsonable(nv),
                    "expression": node_expr,
                }
            except expr.ExprError as e:  # precise, with the node's char position
                node_values[nid] = {"ok": False, "result": None,
                                    "expression": node_expr, "error": e.message}
                exceptions.append(
                    {"node_id": nid, "message": e.message, "pos": e.pos})

    return {
        "expression": expression,
        "result": result,
        "grain": grain,
        "nodes": node_values,
        "trace": list(steps),
        "exceptions": exceptions,
    }
