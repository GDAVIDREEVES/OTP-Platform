"""First-class authored datasets — mutable SQLite state (Phase 8 DS2).

An authored dataset is a user-built data-prep graph (``source / filter /
aggregate / join / union / derive / select`` nodes) that compiles to ONE safe
parameterized DuckDB query via ``calc/dataset.py`` — DuckDB stays the engine,
there is no new evaluator. The graph is the source of truth (stored as
``graph_json``); it is the dataset analogue of ``user_calculations.expression``
and ``authored_pools.definition``.

Lifecycle mirrors state/authored_pools.py / state/user_calcs.py exactly:

    draft ──test_run()──▶ tested ──submit_for_activation()──▶ in_review
                                            │ approve (review.decide hook)
                                            ▼
                                          active  ──edit──▶ draft (version+1)

* **Test gate** — only a draft whose CURRENT graph has passed a compile+run
  (``tested_graph_hash`` == sha256 of the canonical graph JSON) can be
  submitted, so an untested dataset can never reach activation. A graph edit
  always invalidates the gate.
* **Maker-checker** — activation rides the existing review queue: submitting
  enqueues one item at ``record_ref="dataset:{id}"``; ``state/review.py:decide``
  calls ``apply_activation``/``mark_rejected`` here (the exact ucalc:/allocpool:/
  scenario: promotion seam). A rejection returns the dataset to draft.
* **Versioned** — editing an active dataset bumps ``version`` and returns it to
  draft for re-test + re-approval; the audit trail at ``dataset:{id}`` is the
  append-only changelog.
* **Referenceable** — an ACTIVE authored dataset can be used as a SOURCE in
  another dataset (a ``dataset/{id}`` source node; ``calc/dataset.py`` resolves
  it as a compiled subquery, cycle-guarded). Only ``active`` datasets resolve.

Every mutation is hash-chained into the audit trail at
record_ref="dataset:{id}" — the same lock+audit discipline as
state/authored_pools.py — so each dataset's Audit tab and /evidence/:ref packet
light up with no extra wiring. This module must NOT import state.review at
module level (review imports it for the decide() hook); submit_for_activation
defers the import instead.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

import calc.dataset as dataset
import state.audit as audit
import state.lineage as lineage
from state.engine import LOCK, get_conn

PROCESS_ID = "OTP-49"  # default governance home: the data & calc console

_STATUSES = ("draft", "tested", "in_review", "active")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canonical(graph: dict[str, Any]) -> str:
    """Canonical JSON of a dataset graph (sorted keys, tight separators) — the
    hash gate's input, so semantically-identical graphs hash identically."""
    return json.dumps(graph, sort_keys=True, separators=(",", ":"), default=str)


def _graph_hash(graph: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(graph).encode("utf-8")).hexdigest()


def _to_dict(row: Any) -> dict[str, Any]:
    """Row -> API dict: parse graph_json into ``graph`` (the source of truth),
    drop the raw column so the API shape matches the frontend type directly."""
    d = {k: row[k] for k in row.keys()}
    d["graph"] = json.loads(d.pop("graph_json")) if d.get("graph_json") else {}
    return d


def _next_id(conn: Any) -> str:
    n = conn.execute("SELECT count(*) AS n FROM authored_datasets").fetchone()["n"]
    return f"DS-{n + 1}"


# ----------------------------------------------------------------- validation --


def validate_graph(graph: dict[str, Any]) -> list[str]:
    """Structural + allowlist validation of a dataset graph (compile only, no
    run). Returns EVERY problem found — empty list = valid. Delegates to the
    ``calc/dataset.py`` allowlist compiler (the single source of truth for graph
    shape); never silently defaults a missing/unknown column or op."""
    report = dataset.validate_dataset(graph)
    if report["ok"]:
        return []
    return [e["message"] for e in report["errors"]]


# -------------------------------------------------------------------- reads --


def list_authored_datasets(status: str | None = None) -> list[dict[str, Any]]:
    """Authored datasets optionally filtered by status, newest first."""
    sql = "SELECT * FROM authored_datasets"
    params: list[Any] = []
    if status is not None:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC, id DESC"
    rows = get_conn().execute(sql, params).fetchall()
    return [_to_dict(r) for r in rows]


def get_authored_dataset(dataset_id: str) -> dict[str, Any] | None:
    row = get_conn().execute(
        "SELECT * FROM authored_datasets WHERE id = ?", (dataset_id,)
    ).fetchone()
    return _to_dict(row) if row else None


# ------------------------------------------------------------------ writes --


def create_authored_dataset(
    *, name: str, definition: dict[str, Any], actor: str,
    description: str | None = None, process_id: str | None = None,
) -> dict[str, Any]:
    """Create a draft authored dataset from a data-prep graph (``definition`` =
    the graph JSON — the source of truth). The graph is structurally validated
    up front (every allowlist error raised at once); the test gate is exercised
    by the compile+run at test time."""
    if not str(name or "").strip():
        raise ValueError("invalid authored dataset: name is required")
    errors = validate_graph(definition)
    if errors:
        raise ValueError("invalid authored dataset: " + "; ".join(errors))
    now = _now()
    with LOCK:
        conn = get_conn()
        did = _next_id(conn)
        conn.execute(
            "INSERT INTO authored_datasets (id, name, description, graph_json, "
            "process_id, status, version, created_by, created_at) "
            "VALUES (?, ?, ?, ?, ?, 'draft', 1, ?, ?)",
            (did, name, description, json.dumps(definition), process_id, actor, now),
        )
        conn.commit()
        record = get_authored_dataset(did)
        audit.record(
            actor=actor, actor_kind="human",
            process_id=process_id or PROCESS_ID, record_ref=f"dataset:{did}",
            event_type="created", after=record,
        )
    return record


def update_authored_dataset(
    dataset_id: str, *, actor: str, name: str | None = None,
    description: str | None = None, definition: dict[str, Any] | None = None,
    process_id: str | None = None,
) -> dict[str, Any]:
    """Edit a dataset. Drafts/tested edit in place; editing an ACTIVE dataset
    bumps the version and returns it to draft (re-test + re-approval required).
    Any graph change invalidates the test gate. In-review datasets are frozen
    until the checker decides."""
    if definition is not None:
        errors = validate_graph(definition)
        if errors:
            raise ValueError("invalid authored dataset: " + "; ".join(errors))
    with LOCK:
        conn = get_conn()
        before = get_authored_dataset(dataset_id)
        if before is None:
            raise ValueError(f"unknown authored dataset: {dataset_id}")
        if before["status"] == "in_review":
            raise ValueError(
                f"authored dataset {dataset_id} is in_review — wait for the decision")
        new_graph = definition if definition is not None else before["graph"]
        graph_changed = _canonical(new_graph) != _canonical(before["graph"])
        version = before["version"]
        status = before["status"]
        tested_hash, tested_at = before["tested_graph_hash"], before["tested_at"]
        if before["status"] == "active":
            version += 1
            status = "draft"
            tested_hash = tested_at = None
        elif graph_changed:
            status = "draft"
            tested_hash = tested_at = None
        conn.execute(
            "UPDATE authored_datasets SET name = ?, description = ?, "
            "graph_json = ?, process_id = ?, status = ?, version = ?, "
            "tested_graph_hash = ?, tested_at = ?, updated_at = ? WHERE id = ?",
            (
                name if name is not None else before["name"],
                description if description is not None else before["description"],
                json.dumps(new_graph),
                process_id if process_id is not None else before["process_id"],
                status, version, tested_hash, tested_at, _now(), dataset_id,
            ),
        )
        conn.commit()
        after = get_authored_dataset(dataset_id)
        audit.record(
            actor=actor, actor_kind="human",
            process_id=after["process_id"] or PROCESS_ID,
            record_ref=f"dataset:{dataset_id}", event_type="edited",
            before=before, after=after,
            rationale=f"v{before['version']} -> v{version} (new draft)"
            if version != before["version"] else None,
        )
    return after


def delete_authored_dataset(dataset_id: str, actor: str) -> dict[str, Any]:
    """Delete a draft/tested dataset (an in_review or active dataset cannot be
    deleted — it would orphan a review item or a dataset another graph
    references). The deletion is itself audited at dataset:{id}."""
    with LOCK:
        conn = get_conn()
        before = get_authored_dataset(dataset_id)
        if before is None:
            raise ValueError(f"unknown authored dataset: {dataset_id}")
        if before["status"] in ("in_review", "active"):
            raise ValueError(
                f"authored dataset {dataset_id} is {before['status']} — only "
                "draft/tested datasets can be deleted")
        conn.execute("DELETE FROM authored_datasets WHERE id = ?", (dataset_id,))
        conn.commit()
        audit.record(
            actor=actor, actor_kind="human",
            process_id=before["process_id"] or PROCESS_ID,
            record_ref=f"dataset:{dataset_id}", event_type="reversed",
            before=before, rationale="authored dataset deleted",
        )
    return before


def test_run(dataset_id: str, actor: str) -> dict[str, Any]:
    """Compile + run the draft's graph (no persist) and, on success, mark it
    ``tested`` — the gate submit_for_activation() requires. The preview result
    (columns / sample rows / row count) is returned but NOT persisted.

    A graph that fails to compile or run (an allowlist/structure problem)
    raises — the maker fixes the graph and re-tests."""
    before = get_authored_dataset(dataset_id)
    if before is None:
        raise ValueError(f"unknown authored dataset: {dataset_id}")
    if before["status"] not in ("draft", "tested"):
        raise ValueError(
            f"authored dataset {dataset_id} is {before['status']} — only drafts "
            "test (active datasets are referenced as sources)")
    try:
        result = dataset.run_dataset(before["graph"])
    except dataset.DatasetError as e:
        raise ValueError(f"dataset test run failed: {e.message}")
    with LOCK:
        conn = get_conn()
        conn.execute(
            "UPDATE authored_datasets SET status = 'tested', "
            "tested_graph_hash = ?, tested_at = ?, updated_at = ? WHERE id = ?",
            (_graph_hash(before["graph"]), _now(), _now(), dataset_id),
        )
        conn.commit()
        after = get_authored_dataset(dataset_id)
        audit.record(
            actor=actor, actor_kind="human",
            process_id=after["process_id"] or PROCESS_ID,
            record_ref=f"dataset:{dataset_id}", event_type="tested",
            before=before, after=after, rationale="compile + run passed",
        )
    return {"dataset": after, "result": result, "tested": True}


def submit_for_activation(dataset_id: str, maker: str) -> dict[str, Any]:
    """Queue a TESTED dataset for activation: status -> in_review plus one
    pending maker-checker item at record_ref="dataset:{id}" (create_item records
    the "submitted" audit event). Deferred import: review imports this module for
    its decide() hook, so the dependency must point one way only."""
    import state.review as review

    with LOCK:
        conn = get_conn()
        before = get_authored_dataset(dataset_id)
        if before is None:
            raise ValueError(f"unknown authored dataset: {dataset_id}")
        if before["status"] != "tested":
            raise ValueError(
                f"authored dataset {dataset_id} is {before['status']} — it must "
                "pass a test run before activation")
        if before["tested_graph_hash"] != _graph_hash(before["graph"]):
            # Defense in depth: edits already reset the status, but the gate is
            # the hash, not the flag.
            raise ValueError(
                f"authored dataset {dataset_id} changed since its last test — "
                "re-test first")
        conn.execute(
            "UPDATE authored_datasets SET status = 'in_review', updated_at = ? "
            "WHERE id = ?", (_now(), dataset_id),
        )
        conn.commit()
        review.create_item(
            process_id=before["process_id"] or PROCESS_ID,
            record_ref=f"dataset:{dataset_id}", maker=maker,
        )
        return get_authored_dataset(dataset_id)


def apply_activation(dataset_id: str, checker: str) -> dict[str, Any]:
    """Activate an approved dataset (review.decide hook): it now lists as an
    ACTIVE source other datasets (and, in DS3, calcs / pool cost bases) can
    reference via a ``dataset/{id}`` source node."""
    with LOCK:
        conn = get_conn()
        before = get_authored_dataset(dataset_id)
        if before is None:
            raise ValueError(f"unknown authored dataset: {dataset_id}")
        if before["status"] != "in_review":
            raise ValueError(
                f"authored dataset {dataset_id} is {before['status']} — only "
                "in_review datasets activate")
        now = _now()
        conn.execute(
            "UPDATE authored_datasets SET status = 'active', activated_at = ?, "
            "activated_by = ?, updated_at = ? WHERE id = ?",
            (now, checker, now, dataset_id),
        )
        conn.commit()
        after = get_authored_dataset(dataset_id)
        audit.record(
            actor=checker, actor_kind="human",
            process_id=after["process_id"] or PROCESS_ID,
            record_ref=f"dataset:{dataset_id}", event_type="posted",
            before=before, after=after,
            rationale=f"Authored dataset activated (v{after['version']}) — "
                      "now referenceable as a source",
        )
        lineage.record_handoff(
            record_ref=f"dataset:{dataset_id}",
            from_process=after["process_id"] or PROCESS_ID,
            to_process=after["process_id"] or PROCESS_ID,
            actor=checker,
            summary=f"Authored dataset activated (v{after['version']})",
        )
    return after


def mark_rejected(dataset_id: str) -> dict[str, Any]:
    """Return a rejected dataset to draft (review.decide hook): the maker
    reworks, re-tests and resubmits. The "rejected" audit event + return-handoff
    are written by decide() itself; this records just the status flip."""
    with LOCK:
        conn = get_conn()
        before = get_authored_dataset(dataset_id)
        if before is None:
            raise ValueError(f"unknown authored dataset: {dataset_id}")
        conn.execute(
            "UPDATE authored_datasets SET status = 'draft', updated_at = ? "
            "WHERE id = ?", (_now(), dataset_id),
        )
        conn.commit()
        return get_authored_dataset(dataset_id)
