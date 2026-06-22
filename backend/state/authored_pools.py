"""User-authored allocation pools — mutable SQLite state (Phase 6 PB2).

An authored pool is a user-built cost-to-charge pool (OECD Ch.VII /
§1.482-9 cost-pool authoring) layered on top of the existing allocation engine:
a cost-capture rule (predicates over cost_center / profit_center / cost_element,
optional split %), a beneficiary set, an allocation key factor (Equal | Revenue
| Cost — factor values computed from the warehouse per beneficiary, total
recomputed by the engine — V-K3), exclusions and per-jurisdiction markup
policies. It is a governed EXPERIMENT — run through the REAL Stages 1-7 in
ISOLATION (services/allocation_runner.py) and flagged ``authored`` — and NEVER
touches the governed seeded allocation (cent-exact to the warehouse).

Lifecycle mirrors state/user_calcs.py exactly:

    draft ──test_run()──▶ tested ──submit_for_activation()──▶ in_review
                                            │ approve (review.decide hook)
                                            ▼
                                          active  ──edit──▶ draft (version+1)

* **Test gate** — only a draft whose CURRENT definition has passed a dry-run
  (``tested_def_hash`` == sha256 of the canonical definition JSON) can be
  submitted, so an untested pool can never reach activation. A definition edit
  always invalidates the gate.
* **Maker-checker** — activation rides the existing review queue: submitting
  enqueues one item at ``record_ref="allocpool:{id}"``; ``state/review.py:
  decide`` calls ``apply_activation``/``mark_rejected`` here (the exact
  ucalc:/scenario: promotion seam). A rejection returns the pool to draft.
* **Versioned** — editing an active pool bumps ``version`` and returns it to
  draft for re-test + re-approval; the audit trail at ``allocpool:{id}`` is
  the append-only changelog.

Every mutation is hash-chained into the audit trail at
record_ref="allocpool:{id}" — the same lock+audit discipline as
state/user_calcs.py — so each pool's Audit tab and /evidence/:ref packet light
up with no extra wiring. This module must NOT import state.review at module
level (review imports it for the decide() hook); submit_for_activation defers
the import instead.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

import state.audit as audit
import state.lineage as lineage
from state.engine import LOCK, get_conn

PROCESS_ID = "OTP-10"  # the service charge batch — the allocation engine's home

_STATUSES = ("draft", "tested", "in_review", "active")

#: Recognised allocation key factors (authoring object ``key.key_factor``).
KEY_FACTORS = ("Equal", "Revenue", "Cost")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canonical(definition: dict[str, Any]) -> str:
    """Canonical JSON of a definition (sorted keys, tight separators) — the
    hash gate's input, so semantically-identical definitions hash identically."""
    return json.dumps(definition, sort_keys=True, separators=(",", ":"),
                      default=str)


def _def_hash(definition: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(definition).encode("utf-8")).hexdigest()


def _to_dict(row: Any) -> dict[str, Any]:
    """Row -> API dict: parse definition_json into ``definition``, drop the raw
    column so the API shape matches the frontend type directly. ``graph_json``
    (the canvas stage graph, MC3) is parsed too when present (else ``None``)."""
    d = {k: row[k] for k in row.keys()}
    d["definition"] = json.loads(d.pop("definition_json")) if d.get("definition_json") else {}
    if "graph_json" in d:
        d["graph_json"] = json.loads(d["graph_json"]) if d["graph_json"] else None
    return d


def _compile_source(
    definition: dict[str, Any] | None, graph_json: dict[str, Any] | None
) -> tuple[dict[str, Any], str | None]:
    """Resolve the (definition, graph_json text) an author supplied EITHER way
    (Phase 7 MC3). The canvas is a visual layer: when a stage graph is given it
    compiles to the SAME authoring object (``calc.graph.stage_graph_to_pool_
    definition``) the hand-built Pool Builder produces, so everything downstream
    (validate / preview / test / run / maker-checker) is the one PB2 path. Both
    the compiled definition and the graph JSON persist (the definition stays the
    source of truth). Supplying neither, or both, is an explicit error."""
    if (definition is None) == (graph_json is None):
        raise ValueError("supply exactly one of definition or graph")
    if graph_json is not None:
        import calc.graph as graph  # local: keep graph off the module import path
        try:
            compiled = graph.stage_graph_to_pool_definition(graph_json)
        except graph.GraphError as e:
            raise ValueError(f"invalid stage graph: {e.message}")
        return compiled, json.dumps(graph_json)
    return definition, None  # type: ignore[return-value]


def get_authored_pool_graph(pool_id: str) -> dict[str, Any] | None:
    """The canvas stage graph for an authored pool: the stored ``graph_json`` when
    it was authored on the canvas, else ``None`` (a hand-authored pool has no
    canonical stage layout — the definition stays the source of truth). Returns
    ``None`` for an unknown pool too."""
    row = get_conn().execute(
        "SELECT graph_json FROM authored_pools WHERE id = ?", (pool_id,)
    ).fetchone()
    if row is None or not row["graph_json"]:
        return None
    return json.loads(row["graph_json"])


def _next_id(conn: Any) -> str:
    n = conn.execute("SELECT count(*) AS n FROM authored_pools").fetchone()["n"]
    return f"AP-{n + 1}"


# ----------------------------------------------------------------- validation --


def validate_definition(definition: dict[str, Any]) -> list[str]:
    """Structural validation of an authoring object (no engine run). Returns
    EVERY problem found — empty list = structurally valid. NEVER silently
    defaults a missing mandatory field; a missing markup/key is surfaced here
    AND blocks at engine time (V-M1 / V-K1)."""
    errors: list[str] = []
    if not str(definition.get("name") or "").strip():
        errors.append("name is required")
    if not definition.get("provider_entity_id"):
        errors.append("provider_entity_id is required")
    if not definition.get("service_line"):
        errors.append("service_line is required")
    if not definition.get("characterization"):
        errors.append("characterization is required")
    if not definition.get("cost_base_definition"):
        errors.append("cost_base_definition is required")

    capture = definition.get("cost_capture_rule") or {}
    # The dataset->allocation BRIDGE (Phase 8 DS3): a capture rule may instead
    # name an authored ``dataset_id`` whose ACTIVE, cost-line-shaped dataset
    # supplies the Source-stage cost base (the user built a cost pool by
    # joining/filtering the ACDOCA journal). When a dataset is the source the
    # CC/PC/element predicates become an OPTIONAL further filter over it, so they
    # are no longer required — the dataset IS the deliberate capture.
    if not (capture.get("dataset_id") or capture.get("cost_centers")
            or capture.get("profit_centers") or capture.get("cost_elements")):
        errors.append("cost_capture_rule must constrain at least one of "
                      "cost_centers / profit_centers / cost_elements, or name a "
                      "dataset_id (an active authored dataset as the cost base)")
    split = capture.get("split_pct")
    if split is not None:
        try:
            from decimal import Decimal
            s = Decimal(str(split))
            if not (Decimal("0") < s <= Decimal("1")):
                errors.append("cost_capture_rule.split_pct must be in (0, 1]")
        except Exception:  # noqa: BLE001
            errors.append(f"cost_capture_rule.split_pct malformed: {split!r}")

    if not definition.get("beneficiaries"):
        errors.append("at least one beneficiary is required")

    key = definition.get("key") or {}
    if key.get("key_factor") not in KEY_FACTORS:
        errors.append(f"key.key_factor must be one of {KEY_FACTORS}, got "
                      f"{key.get('key_factor')!r}")

    for i, mp in enumerate(definition.get("markup_policies") or []):
        if mp.get("jurisdiction") is None or mp.get("regime") is None \
                or mp.get("markup_pct") is None:
            errors.append(f"markup_policies[{i}] needs jurisdiction, regime and "
                          "markup_pct")
    for i, ex in enumerate(definition.get("exclusions") or []):
        has_amt = ex.get("amount") is not None
        has_pct = ex.get("pct") is not None
        if has_amt == has_pct:
            errors.append(f"exclusions[{i}] needs exactly one of amount / pct")
        if not str(ex.get("basis_rationale") or "").strip():
            errors.append(f"exclusions[{i}] needs a basis_rationale")
    return errors


# -------------------------------------------------------------------- reads --


def list_authored_pools(status: str | None = None) -> list[dict[str, Any]]:
    """Authored pools optionally filtered by status, newest first."""
    sql = "SELECT * FROM authored_pools"
    params: list[Any] = []
    if status is not None:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC, id DESC"
    rows = get_conn().execute(sql, params).fetchall()
    return [_to_dict(r) for r in rows]


def get_authored_pool(pool_id: str) -> dict[str, Any] | None:
    row = get_conn().execute(
        "SELECT * FROM authored_pools WHERE id = ?", (pool_id,)
    ).fetchone()
    return _to_dict(row) if row else None


# ------------------------------------------------------------------ writes --


def create_authored_pool(
    *, definition: dict[str, Any] | None = None, actor: str,
    process_id: str | None = None, graph_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a draft authored pool from EITHER an authoring object OR a canvas
    stage graph (MC3 — the graph compiles to a definition first; both persist,
    the definition is the source of truth). The definition is structurally
    validated up front (every error raised at once); the engine-level gates
    (V-M1/V-K1/V-X1) are exercised by the dry-run at test time."""
    definition, graph_text = _compile_source(definition, graph_json)
    errors = validate_definition(definition)
    if errors:
        raise ValueError("invalid authored pool: " + "; ".join(errors))
    name = definition["name"]
    now = _now()
    with LOCK:
        conn = get_conn()
        pid = _next_id(conn)
        conn.execute(
            "INSERT INTO authored_pools (id, name, definition_json, graph_json, "
            "process_id, status, version, created_by, created_at) "
            "VALUES (?, ?, ?, ?, ?, 'draft', 1, ?, ?)",
            (pid, name, json.dumps(definition), graph_text, process_id, actor, now),
        )
        conn.commit()
        record = get_authored_pool(pid)
        audit.record(
            actor=actor, actor_kind="human",
            process_id=process_id or PROCESS_ID, record_ref=f"allocpool:{pid}",
            event_type="created", after=record,
        )
    return record


def update_authored_pool(
    pool_id: str, *, actor: str, definition: dict[str, Any] | None = None,
    process_id: str | None = None, graph_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Edit a pool from EITHER an authoring object OR a canvas stage graph (MC3).
    Drafts/tested edit in place; editing an ACTIVE pool bumps the version and
    returns it to draft (re-test + re-approval required). Any definition change
    invalidates the test gate. In-review pools are frozen until the checker
    decides. When a graph is supplied it recompiles to the definition and the
    stored graph is refreshed; a definition-only edit nulls a stale stored graph
    (the canvas view is no longer authoritative)."""
    formula_supplied = definition is not None or graph_json is not None
    new_graph_text: str | None = None
    if formula_supplied:
        definition, new_graph_text = _compile_source(
            definition if graph_json is None else None, graph_json)
        errors = validate_definition(definition)
        if errors:
            raise ValueError("invalid authored pool: " + "; ".join(errors))
    with LOCK:
        conn = get_conn()
        before = get_authored_pool(pool_id)
        if before is None:
            raise ValueError(f"unknown authored pool: {pool_id}")
        if before["status"] == "in_review":
            raise ValueError(
                f"authored pool {pool_id} is in_review — wait for the decision")
        new_def = definition if definition is not None else before["definition"]
        def_changed = _canonical(new_def) != _canonical(before["definition"])
        # Graph storage: a graph edit stores the new graph; a definition-only edit
        # that changed the definition invalidates a stale stored graph (else keep).
        if graph_json is not None:
            graph_text = new_graph_text
        elif def_changed:
            graph_text = None
        else:
            graph_text = json.dumps(before["graph_json"]) if before.get("graph_json") else None
        version = before["version"]
        status = before["status"]
        tested_hash, tested_at = before["tested_def_hash"], before["tested_at"]
        if before["status"] == "active":
            version += 1
            status = "draft"
            tested_hash = tested_at = None
        elif def_changed:
            status = "draft"
            tested_hash = tested_at = None
        conn.execute(
            "UPDATE authored_pools SET name = ?, definition_json = ?, "
            "graph_json = ?, process_id = ?, status = ?, version = ?, "
            "tested_def_hash = ?, tested_at = ?, updated_at = ? WHERE id = ?",
            (
                new_def.get("name") or before["name"], json.dumps(new_def),
                graph_text,
                process_id if process_id is not None else before["process_id"],
                status, version, tested_hash, tested_at, _now(), pool_id,
            ),
        )
        conn.commit()
        after = get_authored_pool(pool_id)
        audit.record(
            actor=actor, actor_kind="human",
            process_id=after["process_id"] or PROCESS_ID,
            record_ref=f"allocpool:{pool_id}", event_type="edited",
            before=before, after=after,
            rationale=f"v{before['version']} -> v{version} (new draft)"
            if version != before["version"] else None,
        )
    return after


def delete_authored_pool(pool_id: str, actor: str) -> dict[str, Any]:
    """Delete a draft/tested pool (an in_review or active pool cannot be
    deleted — it would orphan a review item / a referenced active overlay).
    The deletion is itself audited at allocpool:{id}."""
    with LOCK:
        conn = get_conn()
        before = get_authored_pool(pool_id)
        if before is None:
            raise ValueError(f"unknown authored pool: {pool_id}")
        if before["status"] in ("in_review", "active"):
            raise ValueError(
                f"authored pool {pool_id} is {before['status']} — only "
                "draft/tested pools can be deleted")
        conn.execute("DELETE FROM authored_pools WHERE id = ?", (pool_id,))
        conn.commit()
        audit.record(
            actor=actor, actor_kind="human",
            process_id=before["process_id"] or PROCESS_ID,
            record_ref=f"allocpool:{pool_id}", event_type="reversed",
            before=before, rationale="authored pool deleted",
        )
    return before


def test_run(pool_id: str, actor: str) -> dict[str, Any]:
    """Dry-run the draft's definition through Stages 1-7 in isolation (no
    persist) and, on a SOUND result (recon Balanced, no BLOCK exceptions), mark
    it ``tested`` — the gate submit_for_activation() requires. The dry-run
    result (charges / recon / exceptions / trace) is returned but NOT persisted.

    A pool that fires a BLOCK (e.g. a beneficiary jurisdiction with no markup
    policy -> V-M1, or an empty capture rule -> V-P1) is reported but stays a
    draft: the maker fixes the definition and re-tests."""
    import services.allocation_runner as runner  # deferred: runner is heavy

    before = get_authored_pool(pool_id)
    if before is None:
        raise ValueError(f"unknown authored pool: {pool_id}")
    if before["status"] not in ("draft", "tested"):
        raise ValueError(
            f"authored pool {pool_id} is {before['status']} — only drafts test "
            "(active pools run via the authored allocation run)")
    dry = runner.dry_run_authored_pool(
        before["definition"], pool_id=pool_id, name=before["name"])
    blocks = [e for e in dry["exceptions"] if e.get("severity") == "BLOCK"]
    tested = bool(dry["balanced"]) and not blocks
    if tested:
        with LOCK:
            conn = get_conn()
            conn.execute(
                "UPDATE authored_pools SET status = 'tested', "
                "tested_def_hash = ?, tested_at = ?, updated_at = ? WHERE id = ?",
                (_def_hash(before["definition"]), _now(), _now(), pool_id),
            )
            conn.commit()
            after = get_authored_pool(pool_id)
            audit.record(
                actor=actor, actor_kind="human",
                process_id=after["process_id"] or PROCESS_ID,
                record_ref=f"allocpool:{pool_id}", event_type="tested",
                before=before, after=after, rationale="dry-run passed",
            )
    else:
        after = before
    return {"pool": after, "dry_run": dry, "tested": tested}


def submit_for_activation(pool_id: str, maker: str) -> dict[str, Any]:
    """Queue a TESTED pool for activation: status -> in_review plus one pending
    maker-checker item at record_ref="allocpool:{id}" (create_item records the
    "submitted" audit event). Deferred import: review imports this module for
    its decide() hook, so the dependency must point one way only."""
    import state.review as review

    with LOCK:
        conn = get_conn()
        before = get_authored_pool(pool_id)
        if before is None:
            raise ValueError(f"unknown authored pool: {pool_id}")
        if before["status"] != "tested":
            raise ValueError(
                f"authored pool {pool_id} is {before['status']} — it must pass "
                "a dry-run test before activation")
        if before["tested_def_hash"] != _def_hash(before["definition"]):
            # Defense in depth: edits already reset the status, but the gate is
            # the hash, not the flag.
            raise ValueError(
                f"authored pool {pool_id} changed since its last test — re-test first")
        conn.execute(
            "UPDATE authored_pools SET status = 'in_review', updated_at = ? "
            "WHERE id = ?", (_now(), pool_id),
        )
        conn.commit()
        review.create_item(
            process_id=before["process_id"] or PROCESS_ID,
            record_ref=f"allocpool:{pool_id}", maker=maker,
        )
        return get_authored_pool(pool_id)


def apply_activation(pool_id: str, checker: str) -> dict[str, Any]:
    """Activate an approved pool (review.decide hook): it now overlays the
    engine in an authored allocation run (flagged authored — the governed run
    is untouched)."""
    with LOCK:
        conn = get_conn()
        before = get_authored_pool(pool_id)
        if before is None:
            raise ValueError(f"unknown authored pool: {pool_id}")
        if before["status"] != "in_review":
            raise ValueError(
                f"authored pool {pool_id} is {before['status']} — only in_review "
                "pools activate")
        now = _now()
        conn.execute(
            "UPDATE authored_pools SET status = 'active', activated_at = ?, "
            "activated_by = ?, updated_at = ? WHERE id = ?",
            (now, checker, now, pool_id),
        )
        conn.commit()
        after = get_authored_pool(pool_id)
        audit.record(
            actor=checker, actor_kind="human",
            process_id=after["process_id"] or PROCESS_ID,
            record_ref=f"allocpool:{pool_id}", event_type="posted",
            before=before, after=after,
            rationale=f"Authored pool activated (v{after['version']}) — overlays "
                      "the engine as a flagged authored run",
        )
        lineage.record_handoff(
            record_ref=f"allocpool:{pool_id}",
            from_process=after["process_id"] or PROCESS_ID,
            to_process=after["process_id"] or PROCESS_ID,
            actor=checker,
            summary=f"Authored pool activated (v{after['version']})",
        )
    return after


def mark_rejected(pool_id: str) -> dict[str, Any]:
    """Return a rejected pool to draft (review.decide hook): the maker reworks,
    re-tests and resubmits. The "rejected" audit event + return-handoff are
    written by decide() itself; this records just the status flip."""
    with LOCK:
        conn = get_conn()
        before = get_authored_pool(pool_id)
        if before is None:
            raise ValueError(f"unknown authored pool: {pool_id}")
        conn.execute(
            "UPDATE authored_pools SET status = 'draft', updated_at = ? "
            "WHERE id = ?", (_now(), pool_id),
        )
        conn.commit()
        return get_authored_pool(pool_id)
