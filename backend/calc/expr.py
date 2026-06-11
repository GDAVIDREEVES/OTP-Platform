"""Safe expression engine for user-authored calculations (Phase 5 W3).

A hand-written tokenizer → recursive-descent parser → AST → Decimal evaluator.
There is NO ``eval``/``exec``/``compile`` anywhere in this module (test-gated in
tests/test_expr.py): every construct is parsed into explicit AST dataclasses and
interpreted by ``_eval_node``, so an expression can never reach the Python
runtime.

Grammar (operator precedence low → high):

    expr       := comparison
    comparison := additive (('<'|'<='|'>'|'>='|'=='|'!=') additive)?   -- no chains
    additive   := term (('+'|'-') term)*
    term       := unary (('*'|'/') unary)*
    unary      := ('+'|'-') unary | primary
    primary    := NUMBER | STRING | call | NAME | '(' expr ')'
    call       := FUNC '(' expr (',' expr)* ')'

Terms (the data-bound leaf functions):

* ``param('csa.growth')``   — governed parameter store read via
  ``state.parameters.get_param`` (scenario-overlay aware, traced "param").
* ``measure('segment_pl.revenue', 'entity', 'GJAHR=2026')`` — warehouse
  aggregate via ``calc.warehouse.aggregate`` against the ``MEASURE_TABLES``
  allowlist (columns + grains + filter columns; filter values are always bound
  parameters — never interpolated). Traced "measure" (+ the kernel's own
  "aggregate" step). Grain ``'group'`` yields a scalar; ``'entity'`` /
  ``'entity_function'`` yield a :class:`Series` keyed by the group columns.
* ``calc('csa', 'pool')``   — composition: invokes a registered SYSTEM
  calculation's handler directly (same callable the registry runs; deferred
  import — no cycle) and extracts one numeric top-level output key. Traced
  "calc".

Builtin functions: ``sum``/``min``/``max`` (variadic; a single Series argument
reduces over its members), ``abs`` (elementwise), ``if(cond, a, b)`` with the
comparison operators. Quoted strings and bare dotted names are interchangeable
for term arguments (``param(csa.growth)`` == ``param('csa.growth')``), except
``measure()`` filters which must be a quoted ``'COL=value[,COL=value]'`` string.

All numbers are :class:`decimal.Decimal` end to end — literals parse to
Decimal, warehouse/param/calc values convert via ``Decimal(str(v))`` — so money
math is exact and float artifacts cannot creep in. A bare name reaching
arithmetic, a comparison used as a number, division by zero, grain mismatches
and unknown terms all raise precise :class:`ExprError` subclasses carrying the
character position.
"""

from __future__ import annotations

import operator
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Union

import calc.trace as trace
import calc.warehouse as warehouse
import state.parameters as parameters

# --- Errors --------------------------------------------------------------------


class ExprError(ValueError):
    """Base error: a message plus the character position it points at."""

    def __init__(self, message: str, pos: int | None = None):
        super().__init__(message)
        self.message = message
        self.pos = pos


class ExprSyntaxError(ExprError):
    """Tokenizer/parser error (malformed source)."""


class ExprEvalError(ExprError):
    """Evaluation error (unknown term, type misuse, division by zero, …)."""


# --- Measure allowlist -----------------------------------------------------------
# The only tables/columns/grains/filters measure() may touch. Filter VALUES are
# bound query parameters; column names come exclusively from this registry, so
# user expressions can never inject SQL.

MEASURE_TABLES: dict[str, dict[str, Any]] = {
    "segment_pl": {
        "catalog_id": "warehouse:segment_pl",
        "measures": (
            "revenue", "other_income", "cogs", "opex_production", "opex_rd",
            "opex_sm", "opex_ga", "opex_dist", "ic_charges", "depreciation",
            "operating_profit",
        ),
        "grains": {
            "group": (),
            "entity": ("RBUKRS",),
            "entity_function": ("RBUKRS", "ROLE_CODE"),
        },
        # filter column -> value type ("int" values are bound as ints)
        "filters": {"RBUKRS": "str", "ROLE_CODE": "str", "SEGMENT": "str",
                    "GJAHR": "int", "POPER": "str"},
    },
}

GRAINS = ("group", "entity", "entity_function")

# System calculations that calc() may NOT compose: service_allocation is a
# POST-equivalent run that WRITES the allocation ledgers (M6) — composing it
# would make every preview a ledger mutation.
_NON_COMPOSABLE = {"service_allocation"}

# --- Tokenizer -------------------------------------------------------------------

_COMPARE_OPS = ("<=", ">=", "==", "!=", "<", ">")


@dataclass(frozen=True)
class Token:
    kind: str  # NUM | STR | IDENT | OP | LPAREN | RPAREN | COMMA | EOF
    text: str
    pos: int


def tokenize(text: str) -> list[Token]:
    tokens: list[Token] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c.isspace():
            i += 1
            continue
        if c.isdigit() or (c == "." and i + 1 < n and text[i + 1].isdigit()):
            j = i
            while j < n and (text[j].isdigit() or text[j] == "."):
                j += 1
            lit = text[i:j]
            if lit.count(".") > 1:
                raise ExprSyntaxError(f"malformed number {lit!r}", i)
            tokens.append(Token("NUM", lit, i))
            i = j
            continue
        if c in ("'", '"'):
            j = i + 1
            while j < n and text[j] != c:
                j += 1
            if j >= n:
                raise ExprSyntaxError("unterminated string literal", i)
            tokens.append(Token("STR", text[i + 1:j], i))
            i = j + 1
            continue
        if c.isalpha() or c == "_":
            j = i
            while j < n and (text[j].isalnum() or text[j] in "_."):
                j += 1
            ident = text[i:j]
            if ident.endswith(".") or ".." in ident:
                raise ExprSyntaxError(f"malformed name {ident!r}", i)
            tokens.append(Token("IDENT", ident, i))
            i = j
            continue
        if c == "(":
            tokens.append(Token("LPAREN", "(", i)); i += 1; continue
        if c == ")":
            tokens.append(Token("RPAREN", ")", i)); i += 1; continue
        if c == ",":
            tokens.append(Token("COMMA", ",", i)); i += 1; continue
        two = text[i:i + 2]
        if two in ("<=", ">=", "==", "!="):
            tokens.append(Token("OP", two, i)); i += 2; continue
        if c in "+-*/<>":
            tokens.append(Token("OP", c, i)); i += 1; continue
        if c == "=":
            raise ExprSyntaxError("'=' is not an operator — use '==' for comparison", i)
        raise ExprSyntaxError(f"unexpected character {c!r}", i)
    tokens.append(Token("EOF", "", n))
    return tokens


# --- AST -------------------------------------------------------------------------


@dataclass(frozen=True)
class Num:
    value: Decimal
    pos: int


@dataclass(frozen=True)
class Str:
    value: str
    pos: int


@dataclass(frozen=True)
class Name:
    """A bare (possibly dotted) identifier — only valid as a term argument."""
    value: str
    pos: int


@dataclass(frozen=True)
class Unary:
    op: str
    operand: "Node"
    pos: int


@dataclass(frozen=True)
class Bin:
    op: str
    left: "Node"
    right: "Node"
    pos: int


@dataclass(frozen=True)
class Call:
    func: str
    args: tuple["Node", ...]
    pos: int


Node = Union[Num, Str, Name, Unary, Bin, Call]

# func -> (min_args, max_args | None = variadic)
_FUNCS: dict[str, tuple[int, int | None]] = {
    "param": (1, 1),
    "measure": (1, 3),
    "calc": (2, 2),
    "sum": (1, None),
    "min": (1, None),
    "max": (1, None),
    "abs": (1, 1),
    "if": (3, 3),
}


class _Parser:
    def __init__(self, tokens: list[Token]):
        self._toks = tokens
        self._i = 0

    def _peek(self) -> Token:
        return self._toks[self._i]

    def _next(self) -> Token:
        t = self._toks[self._i]
        self._i += 1
        return t

    def comparison(self) -> Node:
        left = self.additive()
        t = self._peek()
        if t.kind == "OP" and t.text in _COMPARE_OPS:
            self._next()
            right = self.additive()
            nxt = self._peek()
            if nxt.kind == "OP" and nxt.text in _COMPARE_OPS:
                raise ExprSyntaxError("comparison chains are not supported", nxt.pos)
            return Bin(t.text, left, right, t.pos)
        return left

    def additive(self) -> Node:
        node = self.term()
        while True:
            t = self._peek()
            if t.kind == "OP" and t.text in ("+", "-"):
                self._next()
                node = Bin(t.text, node, self.term(), t.pos)
            else:
                return node

    def term(self) -> Node:
        node = self.unary()
        while True:
            t = self._peek()
            if t.kind == "OP" and t.text in ("*", "/"):
                self._next()
                node = Bin(t.text, node, self.unary(), t.pos)
            else:
                return node

    def unary(self) -> Node:
        t = self._peek()
        if t.kind == "OP" and t.text in ("+", "-"):
            self._next()
            return Unary(t.text, self.unary(), t.pos)
        return self.primary()

    def primary(self) -> Node:
        t = self._next()
        if t.kind == "NUM":
            try:
                return Num(Decimal(t.text), t.pos)
            except InvalidOperation:
                raise ExprSyntaxError(f"malformed number {t.text!r}", t.pos)
        if t.kind == "STR":
            return Str(t.text, t.pos)
        if t.kind == "IDENT":
            if self._peek().kind == "LPAREN":
                if t.text not in _FUNCS:
                    raise ExprSyntaxError(
                        f"unknown function {t.text!r} (known: {', '.join(sorted(_FUNCS))})",
                        t.pos,
                    )
                self._next()  # consume '('
                args: list[Node] = []
                if self._peek().kind != "RPAREN":
                    args.append(self.comparison())
                    while self._peek().kind == "COMMA":
                        self._next()
                        args.append(self.comparison())
                close = self._next()
                if close.kind != "RPAREN":
                    raise ExprSyntaxError(
                        f"expected ')' to close {t.text}(...)", close.pos
                    )
                lo, hi = _FUNCS[t.text]
                if len(args) < lo or (hi is not None and len(args) > hi):
                    span = str(lo) if hi == lo else (f"{lo}+" if hi is None else f"{lo}–{hi}")
                    raise ExprSyntaxError(
                        f"{t.text}() takes {span} argument(s), got {len(args)}", t.pos
                    )
                return Call(t.text, tuple(args), t.pos)
            return Name(t.text, t.pos)
        if t.kind == "LPAREN":
            node = self.comparison()
            close = self._next()
            if close.kind != "RPAREN":
                raise ExprSyntaxError("expected ')'", close.pos)
            return node
        if t.kind == "EOF":
            raise ExprSyntaxError("unexpected end of expression", t.pos)
        raise ExprSyntaxError(f"unexpected {t.text!r}", t.pos)


def parse(text: str) -> Node:
    if not text or not text.strip():
        raise ExprSyntaxError("empty expression", 0)
    p = _Parser(tokenize(text))
    node = p.comparison()
    t = p._peek()
    if t.kind != "EOF":
        raise ExprSyntaxError(f"unexpected {t.text!r} after the expression", t.pos)
    return node


# --- Static term resolution (shared by validate + evaluate) -----------------------


def _lit_str(node: Node, what: str) -> str:
    """A term argument that must be a quoted string or a bare dotted name."""
    if isinstance(node, (Str, Name)):
        return node.value
    raise ExprError(f"{what} must be a quoted string or bare name", node.pos)


def _resolve_param(call: Call) -> str:
    return _lit_str(call.args[0], "param() key")


def _resolve_calc(call: Call) -> tuple[str, str]:
    return (
        _lit_str(call.args[0], "calc() id"),
        _lit_str(call.args[1], "calc() output key"),
    )


def _parse_filters(filters_text: str, spec: dict[str, Any], pos: int) -> tuple[str, list[Any]]:
    """``'COL=value[,COL=value]'`` -> (WHERE fragment, bound params).

    Columns must be in the table's filter allowlist; values are always bound
    parameters (ints for int-typed columns), never interpolated into the SQL.
    """
    clauses: list[str] = []
    params: list[Any] = []
    for part in filters_text.split(","):
        part = part.strip()
        col, sep, val = part.partition("=")
        col, val = col.strip(), val.strip()
        if not part or not sep or not col or not val:
            raise ExprError(
                f"malformed filter {part!r} — filters look like 'GJAHR=2026,RBUKRS=1000'", pos
            )
        if col not in spec["filters"]:
            raise ExprError(
                f"unknown filter column {col!r} (allowed: {', '.join(sorted(spec['filters']))})",
                pos,
            )
        if spec["filters"][col] == "int":
            try:
                params.append(int(val))
            except ValueError:
                raise ExprError(f"filter {col} expects an integer, got {val!r}", pos)
        else:
            params.append(val)
        clauses.append(f"{col} = ?")
    return " AND ".join(clauses), params


def _resolve_measure(call: Call) -> dict[str, Any]:
    """Statically resolve measure() args against MEASURE_TABLES (no DB access)."""
    ref = _lit_str(call.args[0], "measure() reference")
    table, dot, column = ref.partition(".")
    if not dot or not column or "." in column:
        raise ExprError(
            f"measure() reference must look like 'table.column', got {ref!r}", call.args[0].pos
        )
    spec = MEASURE_TABLES.get(table)
    if spec is None:
        raise ExprError(
            f"unknown measure table {table!r} (known: {', '.join(sorted(MEASURE_TABLES))})",
            call.args[0].pos,
        )
    if column not in spec["measures"]:
        raise ExprError(
            f"unknown measure {column!r} on {table!r} (allowed: {', '.join(spec['measures'])})",
            call.args[0].pos,
        )
    grain = _lit_str(call.args[1], "measure() grain") if len(call.args) >= 2 else "group"
    if grain not in spec["grains"]:
        raise ExprError(
            f"unknown grain {grain!r} (allowed: {', '.join(spec['grains'])})",
            call.args[1].pos if len(call.args) >= 2 else call.pos,
        )
    filters_text: str | None = None
    where: str | None = None
    params: list[Any] | None = None
    if len(call.args) == 3:
        if not isinstance(call.args[2], Str):
            raise ExprError(
                "measure() filters must be a quoted string like 'GJAHR=2026'",
                call.args[2].pos,
            )
        filters_text = call.args[2].value
        where, params = _parse_filters(filters_text, spec, call.args[2].pos)
    return {
        "table": table,
        "column": column,
        "grain": grain,
        "group_cols": tuple(spec["grains"][grain]),
        "filters": filters_text,
        "where": where,
        "params": params,
        "catalog_id": spec["catalog_id"],
    }


def _walk_terms(node: Node, out: list[dict[str, Any]],
                errors: list[dict[str, Any]] | None) -> None:
    """Collect param/measure/calc terms. ``errors is None`` -> raise on a
    malformed term; otherwise collect the error and keep walking."""

    def fail(e: ExprError) -> None:
        if errors is None:
            raise e
        errors.append({"message": e.message, "pos": e.pos})

    if isinstance(node, Call) and node.func in ("param", "measure", "calc"):
        try:
            if node.func == "param":
                out.append({"kind": "param", "key": _resolve_param(node), "pos": node.pos})
            elif node.func == "measure":
                m = _resolve_measure(node)
                out.append({
                    "kind": "measure",
                    "ref": f"{m['table']}.{m['column']}",
                    "grain": m["grain"],
                    "filters": m["filters"],
                    "catalog_id": m["catalog_id"],
                    "pos": node.pos,
                })
            else:
                calc_id, output_key = _resolve_calc(node)
                out.append({"kind": "calc", "calc_id": calc_id,
                            "output_key": output_key, "pos": node.pos})
        except ExprError as e:
            fail(e)
        return
    if isinstance(node, Call):
        for a in node.args:
            _walk_terms(a, out, errors)
    elif isinstance(node, Bin):
        _walk_terms(node.left, out, errors)
        _walk_terms(node.right, out, errors)
    elif isinstance(node, Unary):
        _walk_terms(node.operand, out, errors)


def extract_terms(text: str) -> list[dict[str, Any]]:
    """The param/measure/calc terms referenced by ``text`` (parse + static
    resolution only — no store or warehouse access; raises on malformed terms)."""
    out: list[dict[str, Any]] = []
    _walk_terms(parse(text), out, errors=None)
    return out


def validate(text: str) -> dict[str, Any]:
    """Full validation report: ``{"ok", "errors": [{"message","pos"}], "terms"}``.

    Parse errors are fatal (one precise error); term errors are COLLECTED — the
    wizard shows them all at once. Beyond static shape checks, every param key
    must exist in the governed store and every calc id must be a composable
    registered system calculation (output keys are checked at evaluation).
    """
    try:
        node = parse(text)
    except ExprSyntaxError as e:
        return {"ok": False, "errors": [{"message": e.message, "pos": e.pos}], "terms": []}
    errors: list[dict[str, Any]] = []
    terms: list[dict[str, Any]] = []
    _walk_terms(node, terms, errors)
    for t in terms:
        if t["kind"] == "param" and parameters.get_param_row(t["key"]) is None:
            errors.append({"message": f"unknown parameter {t['key']!r}", "pos": t["pos"]})
        elif t["kind"] == "calc":
            import services.calc_registry as calc_registry  # deferred — no cycle

            if t["calc_id"] in _NON_COMPOSABLE:
                errors.append({
                    "message": f"calc({t['calc_id']!r}) is not composable — it writes the "
                               "allocation ledgers",
                    "pos": t["pos"],
                })
            elif calc_registry.get_def(t["calc_id"]) is None:
                errors.append({
                    "message": f"unknown calculation {t['calc_id']!r} — calc() can reference "
                               "registered system calculations only",
                    "pos": t["pos"],
                })
    return {"ok": not errors, "errors": errors, "terms": terms}


# --- Values ------------------------------------------------------------------------


@dataclass
class Series:
    """A grained vector of values keyed by the grain's group columns."""

    grain: str
    key_cols: tuple[str, ...]
    values: dict[tuple, Any]  # key tuple -> Decimal (or bool from comparisons)


Value = Union[Decimal, bool, str, Series]


def result_grain(value: Value) -> str:
    return value.grain if isinstance(value, Series) else "group"


def _scalar_jsonable(v: Any) -> dict[str, Any]:
    if isinstance(v, Decimal):
        return {"value": float(v), "value_exact": str(v)}
    return {"value": v}


def to_jsonable(value: Value) -> dict[str, Any]:
    """API shape: floats for display + ``*_exact`` decimal strings for tie-out."""
    if isinstance(value, Series):
        rows = []
        for key in sorted(value.values):
            row: dict[str, Any] = {col: key[i] for i, col in enumerate(value.key_cols)}
            row.update(_scalar_jsonable(value.values[key]))
            rows.append(row)
        out: dict[str, Any] = {"grain": value.grain, "rows": rows}
        if all(isinstance(v, Decimal) for v in value.values.values()):
            total = sum(value.values.values(), Decimal(0))
            out["total"] = float(total)
            out["total_exact"] = str(total)
        return out
    return {"grain": "group", **_scalar_jsonable(value)}


# --- Evaluator ----------------------------------------------------------------------

_MISSING = object()

_CMP: dict[str, Callable[[Any, Any], bool]] = {
    "<": operator.lt, "<=": operator.le, ">": operator.gt,
    ">=": operator.ge, "==": operator.eq, "!=": operator.ne,
}


def _num(v: Any, pos: int | None, ctx: str) -> Decimal:
    if isinstance(v, bool):
        raise ExprEvalError(f"cannot use a true/false comparison result in {ctx}", pos)
    if isinstance(v, Decimal):
        return v
    if isinstance(v, str):
        raise ExprEvalError(f"cannot use string {v!r} in {ctx}", pos)
    raise ExprEvalError(f"cannot use {type(v).__name__} in {ctx}", pos)


def _broadcast(fn: Callable[[Any, Any], Any], left: Value, right: Value,
               pos: int | None) -> Value:
    if isinstance(left, Series) and isinstance(right, Series):
        if left.key_cols != right.key_cols:
            raise ExprEvalError(
                f"grain mismatch: '{left.grain}' and '{right.grain}' series cannot be combined",
                pos,
            )
        if set(left.values) != set(right.values):
            diff = sorted(set(left.values) ^ set(right.values))[:3]
            raise ExprEvalError(
                f"series keys differ (e.g. {diff}) — filter both measures to the same population",
                pos,
            )
        return Series(left.grain, left.key_cols,
                      {k: fn(left.values[k], right.values[k]) for k in left.values})
    if isinstance(left, Series):
        return Series(left.grain, left.key_cols,
                      {k: fn(v, right) for k, v in left.values.items()})
    if isinstance(right, Series):
        return Series(right.grain, right.key_cols,
                      {k: fn(left, v) for k, v in right.values.items()})
    return fn(left, right)


def _map_series(fn: Callable[[Any], Any], v: Value) -> Value:
    if isinstance(v, Series):
        return Series(v.grain, v.key_cols, {k: fn(x) for k, x in v.values.items()})
    return fn(v)


def _arith_fn(op: str, pos: int | None) -> Callable[[Any, Any], Decimal]:
    def fn(a: Any, b: Any) -> Decimal:
        x, y = _num(a, pos, f"'{op}'"), _num(b, pos, f"'{op}'")
        if op == "+":
            return x + y
        if op == "-":
            return x - y
        if op == "*":
            return x * y
        if y == 0:
            raise ExprEvalError("division by zero", pos)
        return x / y
    return fn


def _compare_fn(op: str, pos: int | None) -> Callable[[Any, Any], bool]:
    def fn(a: Any, b: Any) -> bool:
        if isinstance(a, bool) or isinstance(b, bool):
            raise ExprEvalError("cannot compare comparison results", pos)
        if isinstance(a, Decimal) and isinstance(b, Decimal):
            return _CMP[op](a, b)
        if isinstance(a, str) and isinstance(b, str) and op in ("==", "!="):
            return _CMP[op](a, b)
        raise ExprEvalError(
            f"cannot compare {type(a).__name__} with {type(b).__name__}", pos
        )
    return fn


def _eval_param(call: Call) -> Value:
    key = _resolve_param(call)
    value = parameters.get_param(key, _MISSING)  # overlay-aware; emits "param"
    if value is _MISSING:
        raise ExprEvalError(f"unknown parameter {key!r}", call.pos)
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    if isinstance(value, Decimal):
        return value
    if isinstance(value, str):
        return value
    raise ExprEvalError(
        f"parameter {key!r} is not a scalar (got {type(value).__name__}) — "
        "only number/string/boolean parameters can be used",
        call.pos,
    )


def _eval_measure(call: Call) -> Value:
    m = _resolve_measure(call)
    group_cols = list(m["group_cols"])
    rows = warehouse.aggregate(
        m["table"], group_cols, [m["column"]], where=m["where"], params=m["params"]
    )
    trace.emit("measure", ref=f"{m['table']}.{m['column']}", grain=m["grain"],
               filters=m["filters"], rows=len(rows))
    ref = f"{m['table']}.{m['column']}"
    if m["grain"] == "group":
        if not rows or rows[0][m["column"]] is None:
            raise ExprEvalError(f"measure('{ref}') matched no data", call.pos)
        return Decimal(str(rows[0][m["column"]]))
    values: dict[tuple, Any] = {}
    for r in rows:
        key = tuple(str(r[c]) for c in group_cols)
        if r[m["column"]] is None:
            raise ExprEvalError(f"measure('{ref}') has no data for {key}", call.pos)
        values[key] = Decimal(str(r[m["column"]]))
    if not values:
        raise ExprEvalError(f"measure('{ref}') matched no data", call.pos)
    return Series(m["grain"], tuple(group_cols), values)


def _eval_calc(call: Call) -> Value:
    calc_id, output_key = _resolve_calc(call)
    import services.calc_registry as calc_registry  # deferred — no cycle

    if calc_id in _NON_COMPOSABLE:
        raise ExprEvalError(
            f"calc({calc_id!r}) is not composable — it writes the allocation ledgers",
            call.pos,
        )
    d = calc_registry.get_def(calc_id)
    if d is None:
        raise ExprEvalError(
            f"unknown calculation {calc_id!r} — calc() can reference registered "
            "system calculations only",
            call.pos,
        )
    handler, defaults = calc_registry._RUNNERS[calc_id]
    output = handler(**defaults)
    if not isinstance(output, dict) or output_key not in output:
        available = ", ".join(sorted(output)) if isinstance(output, dict) else "none"
        raise ExprEvalError(
            f"calculation {calc_id!r} has no output key {output_key!r} "
            f"(available: {available})",
            call.pos,
        )
    raw = output[output_key]
    if isinstance(raw, bool) or not isinstance(raw, (int, float, Decimal)):
        raise ExprEvalError(
            f"output {calc_id}.{output_key} is not numeric", call.pos
        )
    trace.emit("calc", calc_id=calc_id, output_key=output_key, value=raw)
    return Decimal(str(raw))


def _fn_sum(call: Call) -> Value:
    vals = [_eval_node(a) for a in call.args]
    if len(vals) == 1:
        v = vals[0]
        if isinstance(v, Series):
            total = Decimal(0)
            for x in v.values.values():
                total += _num(x, call.pos, "sum()")
            return total
        return _num(v, call.pos, "sum()")
    out: Value = vals[0]
    for v in vals[1:]:
        out = _broadcast(_arith_fn("+", call.pos), out, v, call.pos)
    return out


def _fn_minmax(call: Call) -> Value:
    pick = min if call.func == "min" else max
    vals = [_eval_node(a) for a in call.args]
    if len(vals) == 1 and isinstance(vals[0], Series):
        s = vals[0]
        return pick(_num(x, call.pos, f"{call.func}()") for x in s.values.values())
    if any(isinstance(v, Series) for v in vals):
        raise ExprEvalError(
            f"{call.func}() across multiple arguments requires scalars — "
            "pass a single series to reduce it",
            call.pos,
        )
    return pick(_num(v, call.pos, f"{call.func}()") for v in vals)


def _fn_if(call: Call) -> Value:
    cond = _eval_node(call.args[0])
    a = _eval_node(call.args[1])
    b = _eval_node(call.args[2])
    if isinstance(cond, Series):
        def at(v: Value, k: tuple) -> Any:
            if isinstance(v, Series):
                if v.key_cols != cond.key_cols or set(v.values) != set(cond.values):
                    raise ExprEvalError(
                        "if() branches must align with the condition's series keys",
                        call.pos,
                    )
                return v.values[k]
            return v

        out: dict[tuple, Any] = {}
        for k, c in cond.values.items():
            if not isinstance(c, bool):
                raise ExprEvalError(
                    "if() condition must be a comparison (e.g. param('x') > 0)",
                    call.args[0].pos,
                )
            out[k] = at(a, k) if c else at(b, k)
        return Series(cond.grain, cond.key_cols, out)
    if not isinstance(cond, bool):
        raise ExprEvalError(
            "if() condition must be a comparison (e.g. param('x') > 0)", call.args[0].pos
        )
    return a if cond else b


def _eval_node(node: Node) -> Value:
    if isinstance(node, Num):
        return node.value
    if isinstance(node, Str):
        return node.value
    if isinstance(node, Name):
        raise ExprEvalError(
            f"bare name {node.value!r} — did you mean param('{node.value}')?", node.pos
        )
    if isinstance(node, Unary):
        v = _eval_node(node.operand)
        if node.op == "-":
            return _map_series(lambda x: -_num(x, node.pos, "unary '-'"), v)
        return _map_series(lambda x: _num(x, node.pos, "unary '+'"), v)
    if isinstance(node, Bin):
        left = _eval_node(node.left)
        right = _eval_node(node.right)
        if node.op in ("+", "-", "*", "/"):
            return _broadcast(_arith_fn(node.op, node.pos), left, right, node.pos)
        return _broadcast(_compare_fn(node.op, node.pos), left, right, node.pos)
    # Call
    if node.func == "param":
        return _eval_param(node)
    if node.func == "measure":
        return _eval_measure(node)
    if node.func == "calc":
        return _eval_calc(node)
    if node.func == "sum":
        return _fn_sum(node)
    if node.func in ("min", "max"):
        return _fn_minmax(node)
    if node.func == "abs":
        v = _eval_node(node.args[0])
        return _map_series(lambda x: abs(_num(x, node.pos, "abs()")), v)
    return _fn_if(node)


def evaluate(text: str) -> Value:
    """Parse + evaluate ``text``. Term reads trace as they execute (param via
    ``get_param``, measure as "measure" + the kernel "aggregate", calc as
    "calc"), so a run wrapped in ``calc.trace.collect()`` explains itself."""
    return _eval_node(parse(text))
