"""User-authored calculations — mutable SQLite state (Phase 5 W3).

A user calculation is a named expression in the safe ``calc/expr.py`` grammar
(``param``/``measure``/``calc`` terms, Decimal arithmetic — no eval/exec) with
a declared output grain and a governed lifecycle:

    draft ──test_run()──▶ tested ──submit_for_activation()──▶ in_review
                                            │ approve (review.decide hook)
                                            ▼
                                          active  ──edit──▶ draft (version+1)

* **Test gate** — only a draft whose CURRENT expression has passed a test run
  (``tested_expr_hash`` == sha256 of the expression) can be submitted, so an
  untested formula can never reach the registry.
* **Maker-checker** — activation rides the existing review queue: submitting
  enqueues one item at ``record_ref="ucalc:{id}"``; ``state/review.py:decide``
  calls ``apply_activation``/``mark_rejected`` here (exactly the scenario
  promotion seam). A rejection returns the calculation to draft for rework.
* **Versioned** — editing an active calculation bumps ``version`` and returns
  it to draft for re-test + re-approval; the audit trail at ``ucalc:{id}`` is
  the append-only changelog.

Every mutation is hash-chained into the audit trail at record_ref="ucalc:{id}"
— the same lock+audit discipline as state/cases.py — so each calculation's
Audit tab and /evidence/:ref packet light up with no extra wiring. This module
must NOT import state.review at module level (review imports it for the
decide() hook); submit_for_activation defers the import instead.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

import calc.expr as expr
import calc.graph as graph
import calc.trace as trace
import state.audit as audit
import state.lineage as lineage
from state.engine import LOCK, get_conn

PROCESS_ID = "OTP-49"  # default governance home: the data & calc console

_STATUSES = ("draft", "tested", "in_review", "active")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expr_hash(expression: str) -> str:
    return hashlib.sha256(expression.encode("utf-8")).hexdigest()


def _to_dict(row: Any) -> dict[str, Any]:
    return {k: row[k] for k in row.keys()}


def _next_id(conn: Any) -> str:
    n = conn.execute("SELECT count(*) AS n FROM user_calculations").fetchone()["n"]
    return f"UC-{n + 1}"


def _validate_expression(expression: str) -> dict[str, Any]:
    """Raise ValueError with EVERY validation message if the expression is bad."""
    report = expr.validate(expression)
    if not report["ok"]:
        msgs = "; ".join(e["message"] for e in report["errors"])
        raise ValueError(f"invalid expression: {msgs}")
    return report


def _compile_source(
    expression: str | None, graph_def: dict[str, Any] | None
) -> tuple[str, str | None]:
    """Resolve the (expression, graph_json) pair an author supplied EITHER way.

    The canvas is a visual layer: when a graph is given it is compiled to an
    ``expr.py`` expression FIRST (``graph.graph_to_expr``), so everything
    downstream — validate / evaluate / test / scenario — runs the single,
    existing expression path. Both the compiled expression and the graph JSON
    are persisted (the expression stays the source of truth). Supplying neither,
    or both, is an explicit error (no silent default)."""
    if (expression is None) == (graph_def is None):
        raise ValueError(
            "supply exactly one of expression or graph"
        )
    if graph_def is not None:
        try:
            compiled = graph.graph_to_expr(graph_def)
        except graph.GraphError as e:
            raise ValueError(f"invalid graph: {e.message}")
        return compiled, json.dumps(graph_def)
    return expression, None  # type: ignore[return-value]


def get_user_calc_graph(ucalc_id: str) -> dict[str, Any] | None:
    """The canvas graph for a calculation: the stored ``graph_json`` when it was
    authored on the canvas, else ``expr_to_graph(expression)`` so a formula calc
    still visualises (the expression is the source of truth, so the graph can
    always be regenerated). ``None`` if the calculation is unknown."""
    row = get_user_calc(ucalc_id)
    if row is None:
        return None
    stored = row.get("graph_json")
    if stored:
        return json.loads(stored)
    return graph.expr_to_graph(row["expression"])


def list_user_calcs(status: str | None = None) -> list[dict[str, Any]]:
    """User calculations optionally filtered by status, newest first."""
    sql = "SELECT * FROM user_calculations"
    params: list[Any] = []
    if status is not None:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC, id DESC"
    rows = get_conn().execute(sql, params).fetchall()
    return [_to_dict(r) for r in rows]


def get_user_calc(ucalc_id: str) -> dict[str, Any] | None:
    row = get_conn().execute(
        "SELECT * FROM user_calculations WHERE id = ?", (ucalc_id,)
    ).fetchone()
    return _to_dict(row) if row else None


def create_user_calc(
    *,
    name: str,
    actor: str,
    expression: str | None = None,
    graph_json: dict[str, Any] | None = None,
    description: str | None = None,
    process_id: str | None = None,
    output_grain: str = "group",
) -> dict[str, Any]:
    """Create a draft calculation from EITHER an expression OR a canvas graph
    (the graph compiles to an expression first; both are persisted, the
    expression is the source of truth)."""
    if output_grain not in expr.GRAINS:
        raise ValueError(
            f"invalid output_grain: {output_grain!r} (allowed: {', '.join(expr.GRAINS)})"
        )
    expression, graph_text = _compile_source(expression, graph_json)
    _validate_expression(expression)
    now = _now()
    with LOCK:
        conn = get_conn()
        uid = _next_id(conn)
        conn.execute(
            "INSERT INTO user_calculations (id, name, description, process_id, "
            "output_grain, expression, graph_json, status, version, created_by, "
            "created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?)",
            (uid, name, description, process_id, output_grain, expression,
             graph_text, actor, now),
        )
        conn.commit()
        record = get_user_calc(uid)
        audit.record(
            actor=actor, actor_kind="human",
            process_id=process_id or PROCESS_ID, record_ref=f"ucalc:{uid}",
            event_type="created", after=record,
        )
    return record


def update_user_calc(
    ucalc_id: str,
    *,
    actor: str,
    name: str | None = None,
    description: str | None = None,
    expression: str | None = None,
    graph_json: dict[str, Any] | None = None,
    output_grain: str | None = None,
    process_id: str | None = None,
) -> dict[str, Any]:
    """Edit a calculation. Drafts/tested edit in place; editing an ACTIVE
    calculation bumps the version and returns it to draft (re-test +
    re-approval required). A formula or grain change always invalidates the
    test gate. In-review calculations are frozen until the checker decides.

    The formula may be edited via EITHER ``expression`` OR ``graph_json`` (the
    graph compiles to an expression first — one downstream path; supplying both
    is rejected). An expression-only edit clears any stored graph (they would
    otherwise drift)."""
    if output_grain is not None and output_grain not in expr.GRAINS:
        raise ValueError(
            f"invalid output_grain: {output_grain!r} (allowed: {', '.join(expr.GRAINS)})"
        )
    if expression is not None and graph_json is not None:
        raise ValueError("supply at most one of expression or graph")
    new_expression: str | None = expression
    new_graph_text: str | None = None
    formula_supplied = expression is not None or graph_json is not None
    if formula_supplied:
        new_expression, new_graph_text = _compile_source(expression, graph_json)
        _validate_expression(new_expression)
    with LOCK:
        conn = get_conn()
        before = get_user_calc(ucalc_id)
        if before is None:
            raise ValueError(f"unknown user calculation: {ucalc_id}")
        if before["status"] == "in_review":
            raise ValueError(
                f"user calculation {ucalc_id} is in_review — wait for the decision"
            )
        new_expression = new_expression if formula_supplied else before["expression"]
        graph_text = new_graph_text if formula_supplied else before.get("graph_json")
        new_grain = output_grain if output_grain is not None else before["output_grain"]
        formula_changed = (
            new_expression != before["expression"] or new_grain != before["output_grain"]
        )
        version = before["version"]
        status = before["status"]
        tested_hash, tested_at = before["tested_expr_hash"], before["tested_at"]
        if before["status"] == "active":
            version += 1
            status = "draft"
            tested_hash = tested_at = None
        elif formula_changed:
            status = "draft"
            tested_hash = tested_at = None
        conn.execute(
            "UPDATE user_calculations SET name = ?, description = ?, process_id = ?, "
            "output_grain = ?, expression = ?, graph_json = ?, status = ?, version = ?, "
            "tested_expr_hash = ?, tested_at = ?, updated_at = ? WHERE id = ?",
            (
                name if name is not None else before["name"],
                description if description is not None else before["description"],
                process_id if process_id is not None else before["process_id"],
                new_grain, new_expression, graph_text, status, version,
                tested_hash, tested_at, _now(), ucalc_id,
            ),
        )
        conn.commit()
        after = get_user_calc(ucalc_id)
        audit.record(
            actor=actor, actor_kind="human",
            process_id=after["process_id"] or PROCESS_ID, record_ref=f"ucalc:{ucalc_id}",
            event_type="edited", before=before, after=after,
            rationale=f"v{before['version']} -> v{version} (new draft)"
            if version != before["version"] else None,
        )
    return after


def test_run(ucalc_id: str, actor: str) -> dict[str, Any]:
    """Evaluate the draft's expression (traced) and, on success, mark it
    ``tested`` — the gate submit_for_activation() requires. The evaluated
    result + trace are returned but NOT persisted (registry runs of the
    activated calc land in calc_runs; this is the pre-flight)."""
    before = get_user_calc(ucalc_id)
    if before is None:
        raise ValueError(f"unknown user calculation: {ucalc_id}")
    if before["status"] not in ("draft", "tested"):
        raise ValueError(
            f"user calculation {ucalc_id} is {before['status']} — only drafts test "
            "(active calculations run via the registry)"
        )
    with trace.collect() as steps:
        value = expr.evaluate(before["expression"])  # ExprError -> ValueError
    grain = expr.result_grain(value)
    if grain != before["output_grain"]:
        raise ValueError(
            f"expression evaluates at '{grain}' grain but the calculation declares "
            f"'{before['output_grain']}'"
        )
    result = expr.to_jsonable(value)
    with LOCK:
        conn = get_conn()
        conn.execute(
            "UPDATE user_calculations SET status = 'tested', tested_expr_hash = ?, "
            "tested_at = ?, updated_at = ? WHERE id = ?",
            (_expr_hash(before["expression"]), _now(), _now(), ucalc_id),
        )
        conn.commit()
        after = get_user_calc(ucalc_id)
        audit.record(
            actor=actor, actor_kind="human",
            process_id=after["process_id"] or PROCESS_ID, record_ref=f"ucalc:{ucalc_id}",
            event_type="tested", before=before, after=after,
            rationale="test run passed",
        )
    return {"calc": after, "result": result, "trace": list(steps)}


def submit_for_activation(ucalc_id: str, maker: str) -> dict[str, Any]:
    """Queue a TESTED calculation for activation: status -> in_review plus one
    pending maker-checker item at record_ref="ucalc:{id}" (create_item records
    the "submitted" audit event). Deferred import: review imports this module
    for its decide() hook, so the dependency must point one way only."""
    import state.review as review

    with LOCK:
        conn = get_conn()
        before = get_user_calc(ucalc_id)
        if before is None:
            raise ValueError(f"unknown user calculation: {ucalc_id}")
        if before["status"] != "tested":
            raise ValueError(
                f"user calculation {ucalc_id} is {before['status']} — it must pass a "
                "test run before activation"
            )
        if before["tested_expr_hash"] != _expr_hash(before["expression"]):
            # Defense in depth: edits already reset the status, but the gate is
            # the hash, not the flag.
            raise ValueError(
                f"user calculation {ucalc_id} changed since its last test run — re-test first"
            )
        conn.execute(
            "UPDATE user_calculations SET status = 'in_review', updated_at = ? WHERE id = ?",
            (_now(), ucalc_id),
        )
        conn.commit()
        review.create_item(
            process_id=before["process_id"] or PROCESS_ID,
            record_ref=f"ucalc:{ucalc_id}", maker=maker,
        )
        return get_user_calc(ucalc_id)


def apply_activation(ucalc_id: str, checker: str) -> dict[str, Any]:
    """Activate an approved calculation (review.decide hook): it now lists in
    the registry (kind "user-defined") and runs/traces like a system calc."""
    with LOCK:
        conn = get_conn()
        before = get_user_calc(ucalc_id)
        if before is None:
            raise ValueError(f"unknown user calculation: {ucalc_id}")
        if before["status"] != "in_review":
            raise ValueError(
                f"user calculation {ucalc_id} is {before['status']} — only in_review "
                "calculations activate"
            )
        now = _now()
        conn.execute(
            "UPDATE user_calculations SET status = 'active', activated_at = ?, "
            "activated_by = ?, updated_at = ? WHERE id = ?",
            (now, checker, now, ucalc_id),
        )
        conn.commit()
        after = get_user_calc(ucalc_id)
        audit.record(
            actor=checker, actor_kind="human",
            process_id=after["process_id"] or PROCESS_ID, record_ref=f"ucalc:{ucalc_id}",
            event_type="posted", before=before, after=after,
            rationale=f"Calculation activated (v{after['version']}) — live in the registry",
        )
        lineage.record_handoff(
            record_ref=f"ucalc:{ucalc_id}",
            from_process=after["process_id"] or PROCESS_ID,
            to_process=after["process_id"] or PROCESS_ID,
            actor=checker,
            summary=f"Calculation activated (v{after['version']}) — live in the registry",
        )
    return after


def mark_rejected(ucalc_id: str) -> dict[str, Any]:
    """Return a rejected calculation to draft (review.decide hook): the maker
    reworks, re-tests and resubmits. The "rejected" audit event +
    return-handoff are written by decide() itself; this records just the
    status flip."""
    with LOCK:
        conn = get_conn()
        before = get_user_calc(ucalc_id)
        if before is None:
            raise ValueError(f"unknown user calculation: {ucalc_id}")
        conn.execute(
            "UPDATE user_calculations SET status = 'draft', updated_at = ? WHERE id = ?",
            (_now(), ucalc_id),
        )
        conn.commit()
        return get_user_calc(ucalc_id)
