"""Calc-graph model + bidirectional compiler (Phase 7 MC1 — Model Canvas).

The canvas is a **visual layer over the existing engine** — there is NO new
evaluator here. A calc subgraph is compiled to a :mod:`calc.expr` expression
STRING; everything downstream (validate / preview / test / scenario overlay /
trace) is the unchanged ``expr.py`` path. This module is stdlib + Decimal only.

Graph model
-----------
``graph = {"nodes": [...], "edges": [...]}`` where

* ``node  = {"id", "type", "config", "position": {"x", "y"}}``
* ``edge  = {"source", "sourceHandle", "target", "targetHandle"}``

An edge means *the value produced at ``source``'s output handle feeds
``target``'s ``targetHandle`` input*. Calc-value node types and their handles:

==========  =======================  ============================  ============
type        input handles            config                        output kind
==========  =======================  ============================  ============
``param``   —                        ``{key}``                     value
``measure`` —                        ``{ref, grain?, filters?}``   value
``calc``    —                        ``{calc_id, output_key}``     value
``const``   —                        ``{value}``                   value
``op``      ``a``, ``b``             ``{op}`` one of ``+ - * /``   value
``func``    ``in0…inN`` (variadic)   ``{func}`` sum/min/max/abs    value
``if``      ``cond``, ``then``,      —                             value
            ``else``
``compare`` ``a``, ``b``             ``{op}`` ``< <= > >= == !=``  bool
``output``  ``in``                   —                             (terminal)
==========  =======================  ============================  ============

The single ``output`` node's incoming value IS the calculation's result, so
``graph_to_expr`` compiles the subgraph rooted at ``output`` into an expression
and ``expr_to_graph`` walks an ``expr.py`` AST back into nodes (auto-layout).
The two are designed to round-trip: ``expr_to_graph(s)`` then
``graph_to_expr(...)`` re-parses + evaluates equal to ``evaluate(s)``.

Validation (``validate_graph``) enforces: a real DAG (no cycles), exactly one
``output`` for a calc graph, every non-leaf input handle wired exactly once,
handle-type compatibility (a ``bool`` only feeds an ``if`` condition), and known
node/op/func — an unknown or under-wired node is a precise error, NEVER a
silent default (house rule).
"""

from __future__ import annotations

from typing import Any

import calc.expr as expr

# --- Node-type catalogue -------------------------------------------------------
# Each entry: the fixed input handles (name -> accepted kind) and the produced
# output kind. ``func`` is special-cased (variadic inputs); ``leaf`` nodes have
# no inputs and carry their data in ``config``.

_VALUE = "value"
_BOOL = "bool"

# Arithmetic / comparison operators allowed on op / compare nodes.
_OP_SYMBOLS = ("+", "-", "*", "/")
_COMPARE_SYMBOLS = ("<", "<=", ">", ">=", "==", "!=")
# func nodes wrap a single expr builtin; sum/min/max are variadic, abs is unary.
_FUNCS = ("sum", "min", "max", "abs")
_VARIADIC_FUNCS = ("sum", "min", "max")

# Static handle specs for the fixed-arity node types. The value at a leaf's (or
# any node's) output handle is ``value`` unless the node is a ``compare``.
NODE_TYPES: dict[str, dict[str, Any]] = {
    "param": {"family": "calc", "inputs": {}, "output": _VALUE,
              "config": ("key",)},
    "measure": {"family": "calc", "inputs": {}, "output": _VALUE,
                "config": ("ref", "grain", "filters")},
    "calc": {"family": "calc", "inputs": {}, "output": _VALUE,
             "config": ("calc_id", "output_key")},
    "const": {"family": "calc", "inputs": {}, "output": _VALUE,
              "config": ("value",)},
    "op": {"family": "calc", "inputs": {"a": _VALUE, "b": _VALUE},
           "output": _VALUE, "config": ("op",)},
    "func": {"family": "calc", "inputs": "variadic", "output": _VALUE,
             "config": ("func",)},
    "if": {"family": "calc",
           "inputs": {"cond": _BOOL, "then": _VALUE, "else": _VALUE},
           "output": _VALUE, "config": ()},
    "compare": {"family": "calc", "inputs": {"a": _VALUE, "b": _VALUE},
                "output": _BOOL, "config": ("op",)},
    "output": {"family": "calc", "inputs": {"in": _VALUE}, "output": None,
               "config": ()},
}

# --- Allocation stage-node catalogue (Phase 7 MC3) ----------------------------
# An ALLOCATION stage graph is a visual layer over an ``authored_pools``
# definition (PB2) — there is NO new engine here either. The seven stages form a
# linear pipeline in the OECD Ch.VII / §1.482-9 cost-to-charge ORDER:
#
#     source -> pool -> benefit_test -> allocate -> markup -> charge -> recon
#
# Stages are wired through a third handle KIND, ``flow`` (distinct from the
# calc-value ``value``/``bool``), so a stage can never connect to a calc node and
# vice-versa; the canonical order is enforced because each stage's ``in`` flow
# handle must come from exactly its predecessor in the sequence. Each stage
# carries the slice of the authoring object it owns; ``allocate`` and ``markup``
# additionally expose a NUMERIC ``value`` input handle that a calc-value subgraph
# may feed (the bound subgraph compiles to an ``expr.py`` string evaluated at run
# time — e.g. a governed-parameter-driven markup %), so the two families compose
# at exactly the documented seams and nowhere else.
_FLOW = "flow"

#: The canonical stage order (head -> tail). Index in this tuple == the stage's
#: position; a stage's ``in`` may only be fed by the stage one position earlier.
STAGE_ORDER = (
    "source", "pool", "benefit_test", "allocate", "markup", "charge", "recon",
)

#: Stage node specs. ``flow_in``/``flow_out`` are the pipeline handles; ``value``
#: lists optional calc-bindable numeric input handles (kind ``value``); ``config``
#: is the authoring slice each stage owns.
STAGE_TYPES: dict[str, dict[str, Any]] = {
    "source": {"family": "alloc", "flow_in": False, "flow_out": True,
               "value": (), "config": ("cost_capture_rule",)},
    "pool": {"family": "alloc", "flow_in": True, "flow_out": True,
             "value": (), "config": ("name", "provider_entity_id", "service_line",
                                      "characterization", "cost_base_definition")},
    "benefit_test": {"family": "alloc", "flow_in": True, "flow_out": True,
                     "value": (), "config": ("beneficiaries", "exclusions")},
    "allocate": {"family": "alloc", "flow_in": True, "flow_out": True,
                 "value": ("weight",), "config": ("key_factor",)},
    "markup": {"family": "alloc", "flow_in": True, "flow_out": True,
               "value": ("pct",), "config": ("markup_policies",)},
    "charge": {"family": "alloc", "flow_in": True, "flow_out": True,
               "value": (), "config": ()},
    "recon": {"family": "alloc", "flow_in": True, "flow_out": False,
              "value": (), "config": ()},
}


def _is_stage(typ: str | None) -> bool:
    return typ in STAGE_TYPES


def _is_stage_graph(graph: dict[str, Any]) -> bool:
    """A graph is an ALLOCATION stage graph if it contains any stage node. A
    graph mixing families is rejected by validation (never silently coerced)."""
    return any(_is_stage(n.get("type")) for n in (graph.get("nodes") or []))


class GraphError(ValueError):
    """A graph that cannot be validated or compiled — carries a message and,
    when known, the offending ``node_id``."""

    def __init__(self, message: str, node_id: str | None = None):
        super().__init__(message)
        self.message = message
        self.node_id = node_id


# --- Indexing helpers ----------------------------------------------------------


def _nodes(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """``{node_id: node}`` — raising on a missing id or a duplicate id."""
    out: dict[str, dict[str, Any]] = {}
    for n in graph.get("nodes") or []:
        nid = n.get("id")
        if not nid:
            raise GraphError("every node needs an id")
        if nid in out:
            raise GraphError(f"duplicate node id {nid!r}", nid)
        out[nid] = n
    return out


def _config(node: dict[str, Any]) -> dict[str, Any]:
    return node.get("config") or {}


def _expected_handles(node: dict[str, Any]) -> list[str]:
    """The input handle names this node requires (variadic for func nodes)."""
    spec = NODE_TYPES[node["type"]]
    if spec["inputs"] == "variadic":
        return []  # validated separately — any number of in0..inN
    return list(spec["inputs"].keys())


def _incoming(
    graph: dict[str, Any], nodes: dict[str, dict[str, Any]]
) -> dict[str, dict[str, str]]:
    """``{target_id: {targetHandle: source_id}}`` from the edge list, raising on
    a dangling endpoint, an unknown handle or a doubly-wired handle."""
    incoming: dict[str, dict[str, str]] = {nid: {} for nid in nodes}
    for e in graph.get("edges") or []:
        src, tgt = e.get("source"), e.get("target")
        handle = e.get("targetHandle")
        if src not in nodes:
            raise GraphError(f"edge from unknown node {src!r}")
        if tgt not in nodes:
            raise GraphError(f"edge to unknown node {tgt!r}")
        if handle is None:
            raise GraphError(f"edge into {tgt!r} has no targetHandle", tgt)
        tnode = nodes[tgt]
        spec = NODE_TYPES[tnode["type"]]
        if spec["inputs"] == "variadic":
            if not (handle.startswith("in") and handle[2:].isdigit()):
                raise GraphError(
                    f"{tnode['type']} node {tgt!r} expects 'in0','in1',… inputs, "
                    f"got {handle!r}", tgt)
        elif handle not in spec["inputs"]:
            allowed = ", ".join(spec["inputs"]) or "no"
            raise GraphError(
                f"{tnode['type']} node {tgt!r} has no input handle {handle!r} "
                f"({allowed} inputs)", tgt)
        if handle in incoming[tgt]:
            raise GraphError(
                f"input {handle!r} of node {tgt!r} is wired more than once", tgt)
        incoming[tgt][handle] = src
    return incoming


# --- Validation ----------------------------------------------------------------


def _output_kind(node: dict[str, Any]) -> str:
    return NODE_TYPES[node["type"]]["output"]


def validate_graph(graph: dict[str, Any]) -> dict[str, Any]:
    """Validate a calc graph. Returns ``{"ok": bool, "errors": [{message,
    node_id}], "output_id": str|None}``. Collects EVERY structural error so the
    canvas can surface them all at once; an unknown node type is fatal (it would
    poison every downstream check) and returns immediately.

    A graph containing any ALLOCATION stage node is an allocation stage graph and
    is validated by :func:`validate_stage_graph` instead (stage-order rules) — the
    return shape is normalised to ``{ok, errors, output_id}`` so callers need not
    branch (a stage graph has no calc output, so ``output_id`` is ``None``)."""
    if _is_stage_graph(graph):
        rep = validate_stage_graph(graph)
        return {"ok": rep["ok"], "errors": rep["errors"], "output_id": None}

    errors: list[dict[str, Any]] = []

    try:
        nodes = _nodes(graph)
    except GraphError as e:
        return {"ok": False, "errors": [{"message": e.message, "node_id": e.node_id}],
                "output_id": None}

    for nid, n in nodes.items():
        if n.get("type") not in NODE_TYPES:
            return {
                "ok": False,
                "errors": [{
                    "message": f"unknown node type {n.get('type')!r} "
                               f"(known: {', '.join(sorted(NODE_TYPES))})",
                    "node_id": nid,
                }],
                "output_id": None,
            }

    try:
        incoming = _incoming(graph, nodes)
    except GraphError as e:
        return {"ok": False, "errors": [{"message": e.message, "node_id": e.node_id}],
                "output_id": None}

    # Exactly one output node for a calc graph.
    outputs = [nid for nid, n in nodes.items() if n["type"] == "output"]
    output_id = outputs[0] if len(outputs) == 1 else None
    if len(outputs) == 0:
        errors.append({"message": "a calc graph needs exactly one output node "
                                  "(found none)", "node_id": None})
    elif len(outputs) > 1:
        for nid in outputs:
            errors.append({"message": "a calc graph must have exactly one output "
                                      f"node (found {len(outputs)})", "node_id": nid})

    # Per-node config + wiring + handle-kind checks.
    for nid, n in nodes.items():
        errors.extend(_check_node(nid, n, nodes, incoming))

    # Acyclic (a real DAG) — detected over the input edges.
    if not _is_acyclic(nodes, incoming):
        errors.append({"message": "graph has a cycle — calc graphs must be acyclic",
                       "node_id": None})

    ok = not errors
    return {"ok": ok, "errors": errors, "output_id": output_id if ok else output_id}


def _check_node(
    nid: str, node: dict[str, Any], nodes: dict[str, dict[str, Any]],
    incoming: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    """Config presence/shape, required-input wiring, and handle-kind matching
    for a single node. Reuses ``expr`` resolvers where a leaf's config maps onto
    an expr term so the catalogue can never drift."""
    errs: list[dict[str, Any]] = []
    cfg = _config(node)
    typ = node["type"]
    wired = incoming.get(nid, {})

    def err(msg: str) -> None:
        errs.append({"message": msg, "node_id": nid})

    # --- config shape (no silent defaults for required fields) ---
    if typ == "param":
        if not cfg.get("key"):
            err("param node needs config.key")
    elif typ == "measure":
        if not cfg.get("ref"):
            err("measure node needs config.ref (e.g. 'segment_pl.revenue')")
    elif typ == "calc":
        if not cfg.get("calc_id") or not cfg.get("output_key"):
            err("calc node needs config.calc_id and config.output_key")
    elif typ == "const":
        if cfg.get("value") in (None, ""):
            err("const node needs config.value")
        else:
            try:
                from decimal import Decimal
                Decimal(str(cfg["value"]))
            except Exception:  # noqa: BLE001
                err(f"const node value {cfg['value']!r} is not a number")
    elif typ == "op":
        if cfg.get("op") not in _OP_SYMBOLS:
            err(f"op node needs config.op in {_OP_SYMBOLS}, got {cfg.get('op')!r}")
    elif typ == "compare":
        if cfg.get("op") not in _COMPARE_SYMBOLS:
            err(f"compare node needs config.op in {_COMPARE_SYMBOLS}, "
                f"got {cfg.get('op')!r}")
    elif typ == "func":
        if cfg.get("func") not in _FUNCS:
            err(f"func node needs config.func in {_FUNCS}, got {cfg.get('func')!r}")

    # --- required-input wiring ---
    if typ == "func":
        n_in = len(wired)
        fn = cfg.get("func")
        if fn == "abs" and n_in != 1:
            err(f"abs() takes exactly 1 input, {n_in} wired")
        elif fn in _VARIADIC_FUNCS and n_in < 1:
            err(f"{fn}() needs at least 1 input, none wired")
    else:
        for handle in _expected_handles(node):
            if handle not in wired:
                err(f"{typ} node input {handle!r} is not wired")

    # --- handle-kind compatibility (a bool may only feed an if condition) ---
    spec = NODE_TYPES[typ]
    if spec["inputs"] != "variadic":
        for handle, src in wired.items():
            want = spec["inputs"].get(handle)
            got = _output_kind(nodes[src])
            if want is not None and got is not None and want != got:
                err(f"{typ} node input {handle!r} expects a {want}, but node "
                    f"{src!r} produces a {got}")
    else:  # func inputs must be values, not bools
        for handle, src in wired.items():
            if _output_kind(nodes[src]) == _BOOL:
                err(f"{typ} node input {handle!r} cannot take a comparison "
                    f"(bool) from node {src!r}")
    return errs


def _is_acyclic(
    nodes: dict[str, dict[str, Any]], incoming: dict[str, dict[str, str]]
) -> bool:
    """DFS cycle check over the dependency edges (source -> target via inputs)."""
    WHITE, GREY, BLACK = 0, 1, 2
    color = {nid: WHITE for nid in nodes}
    # adjacency: a node depends on its incoming sources.
    deps = {nid: set(srcs.values()) for nid, srcs in incoming.items()}

    def visit(nid: str) -> bool:
        color[nid] = GREY
        for dep in deps.get(nid, ()):  # noqa: SIM118
            if dep not in color:
                continue
            if color[dep] == GREY:
                return False
            if color[dep] == WHITE and not visit(dep):
                return False
        color[nid] = BLACK
        return True

    return all(color[nid] != WHITE or visit(nid) for nid in nodes)


# --- graph -> expr -------------------------------------------------------------


def _q(value: str) -> str:
    """Quote a string term argument for an expr call (single quotes; the value
    never itself contains a quote in this domain — keys/refs/filters)."""
    return "'" + str(value) + "'"


def graph_to_expr(graph: dict[str, Any]) -> str:
    """Compile a calc graph into a :mod:`calc.expr` expression string.

    Validates first (a bad graph raises :class:`GraphError`), then emits the
    expression for the subgraph rooted at the single ``output`` node. The output
    is a syntactically valid expr string that ``expr.parse``/``expr.evaluate``
    accept unchanged — no new evaluation lives here."""
    report = validate_graph(graph)
    if not report["ok"]:
        msgs = "; ".join(e["message"] for e in report["errors"])
        raise GraphError(f"cannot compile graph: {msgs}")
    nodes = _nodes(graph)
    incoming = _incoming(graph, nodes)
    output_id = report["output_id"]
    src = incoming[output_id].get("in")
    if src is None:  # defended by validate_graph, kept for safety
        raise GraphError("output node is not wired", output_id)
    return _emit(src, nodes, incoming)


def _emit(
    nid: str, nodes: dict[str, dict[str, Any]], incoming: dict[str, dict[str, str]]
) -> str:
    """Recursively emit the expression string for the subgraph rooted at ``nid``.
    Binary operators/comparisons are always parenthesised so the emitted string
    re-parses to the exact same AST shape (round-trip fidelity)."""
    node = nodes[nid]
    typ = node["type"]
    cfg = _config(node)
    wired = incoming.get(nid, {})

    if typ == "param":
        return f"param({_q(cfg['key'])})"
    if typ == "measure":
        args = [_q(cfg["ref"])]
        grain = cfg.get("grain")
        filters = cfg.get("filters")
        if grain:
            args.append(_q(grain))
        elif filters:
            args.append(_q("group"))  # grain is positional before filters
        if filters:
            args.append(_q(filters))
        return f"measure({', '.join(args)})"
    if typ == "calc":
        return f"calc({_q(cfg['calc_id'])}, {_q(cfg['output_key'])})"
    if typ == "const":
        # Decimal-faithful literal: emit the canonical string of the config value.
        from decimal import Decimal
        return str(Decimal(str(cfg["value"])))
    if typ == "op":
        a = _emit(wired["a"], nodes, incoming)
        b = _emit(wired["b"], nodes, incoming)
        return f"({a} {cfg['op']} {b})"
    if typ == "compare":
        a = _emit(wired["a"], nodes, incoming)
        b = _emit(wired["b"], nodes, incoming)
        return f"({a} {cfg['op']} {b})"
    if typ == "func":
        fn = cfg["func"]
        # Preserve input order by the numeric suffix on the handle name.
        ordered = sorted(wired, key=lambda h: int(h[2:]))
        parts = [_emit(wired[h], nodes, incoming) for h in ordered]
        return f"{fn}({', '.join(parts)})"
    if typ == "if":
        cond = _emit(wired["cond"], nodes, incoming)
        then = _emit(wired["then"], nodes, incoming)
        els = _emit(wired["else"], nodes, incoming)
        return f"if({cond}, {then}, {els})"
    raise GraphError(f"cannot emit node type {typ!r}", nid)


# --- expr -> graph -------------------------------------------------------------


class _Builder:
    """Walks an ``expr.py`` AST into graph nodes, assigning a depth (column) per
    node so positions auto-layout left→right. Each visit returns the new node's
    id; an output node is appended last and wired to the root."""

    def __init__(self) -> None:
        self.nodes: list[dict[str, Any]] = []
        self.edges: list[dict[str, str]] = []
        self._seq = 0
        # node_id -> depth (distance from leaves); used for x positioning.
        self._depth: dict[str, int] = {}

    def _new(self, typ: str, config: dict[str, Any]) -> str:
        self._seq += 1
        nid = f"n{self._seq}"
        self.nodes.append({"id": nid, "type": typ, "config": config,
                           "position": {"x": 0, "y": 0}})
        self._depth[nid] = 0
        return nid

    def _edge(self, src: str, tgt: str, handle: str) -> None:
        self.edges.append({"source": src, "sourceHandle": "out",
                           "target": tgt, "targetHandle": handle})
        # target sits at least one column to the right of its deepest input.
        self._depth[tgt] = max(self._depth[tgt], self._depth[src] + 1)

    def visit(self, node: expr.Node) -> str:
        if isinstance(node, expr.Num):
            return self._new("const", {"value": str(node.value)})
        if isinstance(node, expr.Str):
            # A bare string only ever reaches here as a stray literal; preserve
            # it as a const-like node is wrong, so reject — expr_to_graph is for
            # numeric calc expressions terminating in a value.
            raise GraphError(
                f"cannot visualise a bare string literal {node.value!r}")
        if isinstance(node, expr.Name):
            raise GraphError(
                f"cannot visualise a bare name {node.value!r} — "
                f"did you mean param('{node.value}')?")
        if isinstance(node, expr.Unary):
            # -x  ->  (0 - x) ; +x -> x. Keeps the model to the documented set.
            operand = self.visit(node.operand)
            if node.op == "+":
                return operand
            zero = self._new("const", {"value": "0"})
            op = self._new("op", {"op": "-"})
            self._edge(zero, op, "a")
            self._edge(operand, op, "b")
            return op
        if isinstance(node, expr.Bin):
            left = self.visit(node.left)
            right = self.visit(node.right)
            typ = "compare" if node.op in expr._COMPARE_OPS else "op"
            nid = self._new(typ, {"op": node.op})
            self._edge(left, nid, "a")
            self._edge(right, nid, "b")
            return nid
        if isinstance(node, expr.Call):
            return self._visit_call(node)
        raise GraphError(f"cannot visualise AST node {type(node).__name__}")

    def _visit_call(self, node: expr.Call) -> str:
        fn = node.func
        if fn == "param":
            key = expr._resolve_param(node)
            return self._new("param", {"key": key})
        if fn == "measure":
            m = expr._resolve_measure(node)
            cfg: dict[str, Any] = {"ref": f"{m['table']}.{m['column']}",
                                   "grain": m["grain"]}
            if m["filters"] is not None:
                cfg["filters"] = m["filters"]
            return self._new("measure", cfg)
        if fn == "calc":
            calc_id, output_key = expr._resolve_calc(node)
            return self._new("calc", {"calc_id": calc_id, "output_key": output_key})
        if fn in ("sum", "min", "max"):
            nid = self._new("func", {"func": fn})
            for i, arg in enumerate(node.args):
                self._edge(self.visit(arg), nid, f"in{i}")
            return nid
        if fn == "abs":
            nid = self._new("func", {"func": "abs"})
            self._edge(self.visit(node.args[0]), nid, "in0")
            return nid
        if fn == "if":
            nid = self._new("if", {})
            self._edge(self.visit(node.args[0]), nid, "cond")
            self._edge(self.visit(node.args[1]), nid, "then")
            self._edge(self.visit(node.args[2]), nid, "else")
            return nid
        raise GraphError(f"cannot visualise function {fn!r}")

    def layout(self) -> None:
        """Assign positions: x by depth column (160px), y stacked per column."""
        col_count: dict[int, int] = {}
        for n in self.nodes:
            d = self._depth[n["id"]]
            row = col_count.get(d, 0)
            col_count[d] = row + 1
            n["position"] = {"x": d * 200, "y": row * 110}


def node_exprs(graph: dict[str, Any]) -> dict[str, str]:
    """The expression each non-leaf, non-output node computes — the subgraph
    rooted at that node compiled to an ``expr.py`` string. Used by preview to
    paint a value onto every node (compile each, evaluate each). The graph must
    already validate; ``output`` nodes are skipped (they hold no value of their
    own — they relay their single input) and ``compare`` nodes are included
    (their value is a bool the evaluator returns)."""
    report = validate_graph(graph)
    if not report["ok"]:
        msgs = "; ".join(e["message"] for e in report["errors"])
        raise GraphError(f"cannot compile graph: {msgs}")
    nodes = _nodes(graph)
    incoming = _incoming(graph, nodes)
    out: dict[str, str] = {}
    for nid, n in nodes.items():
        if n["type"] == "output":
            continue
        out[nid] = _emit(nid, nodes, incoming)
    return out


def expr_to_graph(expression: str) -> dict[str, Any]:
    """Compile an ``expr.py`` expression STRING into a calc graph (for the
    canvas to visualise a formula-authored calc). Reuses ``expr.tokenize`` +
    ``expr.parse`` to build the AST — no parsing logic is duplicated — then
    walks it into nodes with a layered left→right auto-layout, terminating in a
    single ``output`` node wired to the root."""
    ast = expr.parse(expression)  # ExprSyntaxError on malformed source
    b = _Builder()
    root = b.visit(ast)
    out = b._new("output", {})
    b._edge(root, out, "in")
    b.layout()
    return {"nodes": b.nodes, "edges": b.edges}


# ============================================================================
# Allocation stage graphs (Phase 7 MC3)
# ----------------------------------------------------------------------------
# A stage graph compiles to an authored-pool ``definition`` (the SAME object
# PB2's preview/test/run consume) — the canvas adds NO new allocation engine.
# ``validate_stage_graph`` enforces the canonical stage order via the ``flow``
# handles; ``stage_graph_to_pool_definition`` assembles the definition, compiling
# any calc-value subgraph bound into a stage's numeric input to an ``expr.py``
# string stored alongside the literal (evaluated at run time, never guessed).
# ============================================================================


def _stage_index(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """``{node_id: node}`` over the STAGE nodes only (calc-value nodes that feed
    numeric inputs are indexed separately by the wiring walk)."""
    return {n["id"]: n for n in (graph.get("nodes") or []) if _is_stage(n.get("type"))}


def _stage_flow_edges(
    graph: dict[str, Any], stages: dict[str, dict[str, Any]]
) -> dict[str, str]:
    """``{target_stage_id: source_stage_id}`` for the pipeline (``flow``) edges —
    a stage's ``in`` handle. Raises on a non-stage source feeding a flow input or
    a doubly-wired flow input (a stage takes exactly one predecessor)."""
    flow: dict[str, str] = {}
    for e in graph.get("edges") or []:
        if e.get("targetHandle") != "in":
            continue
        tgt = e.get("target")
        if tgt not in stages:
            continue  # an output node's 'in' — handled by the calc validator
        src = e.get("source")
        if src not in stages:
            raise GraphError(
                f"stage {stages[tgt]['type']!r} input must come from another "
                f"stage, not {src!r}", tgt)
        if tgt in flow:
            raise GraphError(
                f"stage {stages[tgt]['type']!r} has more than one predecessor", tgt)
        flow[tgt] = src
    return flow


def validate_stage_graph(graph: dict[str, Any]) -> dict[str, Any]:
    """Validate an ALLOCATION stage graph. Returns ``{"ok", "errors":[{message,
    node_id}], "order":[stage_id…]}``. Enforces: every node is a stage or a
    calc-value node feeding a stage NUMERIC input; exactly one of each stage
    type; the seven stages present (no silent omission); the flow edges form the
    canonical chain source→…→recon with each stage fed only by its predecessor.
    Collects every error so the canvas can surface them at once."""
    errors: list[dict[str, Any]] = []

    try:
        all_nodes = _nodes(graph)  # dup-id / missing-id guard (shared)
    except GraphError as e:
        return {"ok": False, "errors": [{"message": e.message, "node_id": e.node_id}],
                "order": []}

    stages = _stage_index(graph)
    # Every node must be a stage OR a known calc-value node (the binding subgraph).
    for nid, n in all_nodes.items():
        typ = n.get("type")
        if not _is_stage(typ) and typ not in NODE_TYPES:
            return {"ok": False, "errors": [{
                "message": f"unknown node type {typ!r}", "node_id": nid}],
                "order": []}

    # Exactly one of each stage type, all seven present.
    by_type: dict[str, list[str]] = {t: [] for t in STAGE_ORDER}
    for nid, n in stages.items():
        by_type[n["type"]].append(nid)
    for t in STAGE_ORDER:
        if len(by_type[t]) == 0:
            errors.append({"message": f"stage graph is missing its {t!r} stage",
                           "node_id": None})
        elif len(by_type[t]) > 1:
            for nid in by_type[t]:
                errors.append({"message": f"stage graph must have exactly one "
                               f"{t!r} stage (found {len(by_type[t])})", "node_id": nid})

    # A calc graph must not declare an output node inside a stage graph.
    for nid, n in all_nodes.items():
        if n.get("type") == "output":
            errors.append({"message": "a stage graph has no output node — its "
                           "terminal is the recon stage", "node_id": nid})

    try:
        flow = _stage_flow_edges(graph, stages)
    except GraphError as e:
        errors.append({"message": e.message, "node_id": e.node_id})
        flow = {}

    # Canonical order: stage at position i (i>0) must be fed by the stage at i-1.
    order: list[str] = []
    if all(len(by_type[t]) == 1 for t in STAGE_ORDER):
        ids = {t: by_type[t][0] for t in STAGE_ORDER}
        order = [ids[t] for t in STAGE_ORDER]
        for i, t in enumerate(STAGE_ORDER):
            sid = ids[t]
            if i == 0:
                if sid in flow:
                    errors.append({"message": "the source stage is the head — it "
                                   "takes no predecessor", "node_id": sid})
                continue
            prev_t = STAGE_ORDER[i - 1]
            fed = flow.get(sid)
            if fed is None:
                errors.append({"message": f"{t!r} stage is not wired to its "
                               f"predecessor {prev_t!r}", "node_id": sid})
            elif fed != ids[prev_t]:
                got = stages[fed]["type"] if fed in stages else fed
                errors.append({"message": f"{t!r} stage must follow {prev_t!r}, "
                               f"but is wired after {got!r} (out-of-order stage "
                               "connection)", "node_id": sid})

    # Calc-value bindings into stage numeric inputs: the source must be a
    # calc-value node and the target handle a declared numeric input of the stage.
    for e in graph.get("edges") or []:
        handle = e.get("targetHandle")
        tgt, src = e.get("target"), e.get("source")
        if tgt not in stages or handle == "in":
            continue
        numeric = STAGE_TYPES[stages[tgt]["type"]]["value"]
        if handle not in numeric:
            errors.append({"message": f"{stages[tgt]['type']!r} stage has no "
                           f"numeric input {handle!r} (accepts: "
                           f"{', '.join(numeric) or 'none'})", "node_id": tgt})
            continue
        if src not in all_nodes or _is_stage(all_nodes[src].get("type")):
            errors.append({"message": f"{stages[tgt]['type']}.{handle} must be fed "
                           "by a calc-value subgraph, not a stage", "node_id": tgt})

    # Per-stage config presence (no silent defaults) — compile to the authoring
    # object and run the AUTHORED-POOL validator (the single source of truth for
    # the definition shape), so an under-specified stage surfaces here exactly as
    # it would BLOCK at engine time. Deferred import: state.authored_pools imports
    # this module, so the dependency points one way only.
    if not errors:
        try:
            definition = stage_graph_to_pool_definition(graph)
        except GraphError as e:
            errors.append({"message": e.message, "node_id": e.node_id})
        else:
            import state.authored_pools as authored_pools
            for msg in authored_pools.validate_definition(definition):
                errors.append({"message": msg, "node_id": None})

    return {"ok": not errors, "errors": errors, "order": order}


def _bound_expr(
    graph: dict[str, Any], stage_id: str, handle: str,
    all_nodes: dict[str, dict[str, Any]],
) -> str | None:
    """If a calc-value subgraph is wired into ``stage_id.handle``, compile that
    subgraph to an ``expr.py`` string (evaluated at run time). Returns ``None``
    when the handle is unbound. The bound subgraph is the calc graph rooted at the
    feeding node, so we wrap it in a synthetic ``output`` and reuse the calc
    compiler — no new emission logic."""
    src: str | None = None
    for e in graph.get("edges") or []:
        if e.get("target") == stage_id and e.get("targetHandle") == handle:
            src = e.get("source")
            break
    if src is None:
        return None
    # Build a calc sub-graph: every reachable calc-value node + a fresh output.
    reach: set[str] = set()
    stack = [src]
    incoming_all: dict[str, list[tuple[str, str]]] = {}
    for e in graph.get("edges") or []:
        incoming_all.setdefault(e["target"], []).append((e["source"], e["targetHandle"]))
    while stack:
        cur = stack.pop()
        if cur in reach or cur not in all_nodes or _is_stage(all_nodes[cur].get("type")):
            continue
        reach.add(cur)
        for s, _h in incoming_all.get(cur, []):
            stack.append(s)
    sub_nodes = [all_nodes[n] for n in reach]
    sub_edges = [
        e for e in (graph.get("edges") or [])
        if e["source"] in reach and e["target"] in reach
    ]
    out_id = f"__bound_out_{stage_id}_{handle}"
    sub_nodes = list(sub_nodes) + [
        {"id": out_id, "type": "output", "config": {}, "position": {"x": 0, "y": 0}}]
    sub_edges = list(sub_edges) + [
        {"source": src, "sourceHandle": "out", "target": out_id, "targetHandle": "in"}]
    try:
        return graph_to_expr({"nodes": sub_nodes, "edges": sub_edges})
    except GraphError as e:
        raise GraphError(
            f"calc binding into {all_nodes[stage_id]['type']}.{handle} is invalid: "
            f"{e.message}", stage_id)


def stage_graph_to_pool_definition(graph: dict[str, Any]) -> dict[str, Any]:
    """Compile an allocation stage graph into an authored-pool ``definition`` —
    the exact object ``state/authored_pools.validate_definition`` and the PB2
    preview/test/run path consume. The stage CONFIG slices assemble the
    definition; a calc-value subgraph bound into a numeric input is compiled to an
    ``expr.py`` string stored alongside its literal (``markup_pct_expr`` /
    ``weight_expr``) and evaluated at run time. Under-specified config is NEVER
    defaulted — a missing required field raises (and surfaces in validation)."""
    all_nodes = _nodes(graph)
    stages = _stage_index(graph)
    by_type: dict[str, dict[str, Any]] = {}
    for n in stages.values():
        t = n["type"]
        if t in by_type:
            raise GraphError(f"stage graph has more than one {t!r} stage", n["id"])
        by_type[t] = n
    missing = [t for t in STAGE_ORDER if t not in by_type]
    if missing:
        raise GraphError(
            f"stage graph cannot compile — missing stage(s): {', '.join(missing)}")

    def cfg(t: str) -> dict[str, Any]:
        return _config(by_type[t])

    pool = cfg("pool")
    source = cfg("source")
    benefit = cfg("benefit_test")
    allocate = cfg("allocate")
    markup = cfg("markup")

    definition: dict[str, Any] = {
        "name": pool.get("name"),
        "provider_entity_id": pool.get("provider_entity_id"),
        "service_line": pool.get("service_line"),
        "characterization": pool.get("characterization"),
        "cost_base_definition": pool.get("cost_base_definition"),
        "cost_capture_rule": source.get("cost_capture_rule") or {},
        "beneficiaries": benefit.get("beneficiaries") or [],
        "key": {"key_factor": allocate.get("key_factor")},
        "exclusions": benefit.get("exclusions") or [],
        "markup_policies": [dict(mp) for mp in (markup.get("markup_policies") or [])],
    }

    # Calc-bound markup % — a single bound expr applies to every markup policy
    # (the common "all jurisdictions priced off one governed driver" case). The
    # literal markup_pct stays as the fallback the validator checks; the engine
    # reads markup_pct_expr first at run time when present.
    pct_expr = _bound_expr(graph, by_type["markup"]["id"], "pct", all_nodes)
    if pct_expr is not None:
        if not definition["markup_policies"]:
            raise GraphError(
                "markup stage binds a calc % but declares no policy to apply it to",
                by_type["markup"]["id"])
        for mp in definition["markup_policies"]:
            mp["markup_pct_expr"] = pct_expr

    weight_expr = _bound_expr(graph, by_type["allocate"]["id"], "weight", all_nodes)
    if weight_expr is not None:
        definition["key"]["weight_expr"] = weight_expr

    return definition
