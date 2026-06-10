"""What-if scenarios — mutable SQLite state for Calc Studio (CS-c).

A scenario is a named bundle of parameter overrides ({param_key: value}) that
``services/calc_registry.py:run()`` overlays over the governed store via
``state/parameters.py:overrides()`` — the store itself is never written by a
scenario run. Promotion rides the existing maker-checker queue: submitting
sets ``in_review`` and enqueues a ``scenario:{id}`` review item; on approval
``state/review.py:decide()`` calls ``apply_promotion()`` here, which applies
each override through ``set_param`` (individually audited at ``param:{key}``);
on rejection ``mark_rejected()`` returns the scenario to draft.

Every mutation is hash-chained into the audit trail at
record_ref="scenario:{id}" — exactly the lock+audit discipline used in
state/cases.py — so each scenario's Audit tab and /evidence/:ref packet light
up with no extra wiring. This module must NOT import state.review at module
level (review imports it for the decide() hook); submit_for_review defers the
import instead.

State dicts expose `overrides` parsed (json.loads of overrides_json) and drop
the raw column, so the API shape matches the frontend `Scenario` type directly.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import state.audit as audit
import state.lineage as lineage
import state.parameters as parameters
from state.engine import LOCK, get_conn

PROCESS_ID = "OTP-49"  # scenarios are governed by the data & calc console

_STATUSES = ("draft", "in_review", "promoted", "discarded")
# Terminal states: no further mutation of any kind.
_TERMINAL = ("promoted", "discarded")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_dict(row: Any) -> dict[str, Any]:
    """Row -> API dict: parse overrides_json into `overrides`, drop the raw key."""
    d = {k: row[k] for k in row.keys()}
    d["overrides"] = json.loads(d.pop("overrides_json")) if d.get("overrides_json") else {}
    return d


def _next_id(conn: Any) -> str:
    n = conn.execute("SELECT count(*) AS n FROM scenarios").fetchone()["n"]
    return f"SC-{n + 1}"


def _validate_overrides(overrides: dict[str, Any]) -> None:
    """Every override key must be a governed parameter — a scenario can only
    what-if what the store governs (and promotion can therefore never fail
    on an unknown key)."""
    for key in overrides:
        if parameters.get_param_row(key) is None:
            raise ValueError(f"unknown parameter: {key}")


def list_scenarios(status: str | None = None) -> list[dict[str, Any]]:
    """Scenarios optionally filtered by status, newest first."""
    sql = "SELECT * FROM scenarios"
    params: list[Any] = []
    if status is not None:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC, id DESC"
    rows = get_conn().execute(sql, params).fetchall()
    return [_to_dict(r) for r in rows]


def get_scenario(scenario_id: str) -> dict[str, Any] | None:
    row = get_conn().execute(
        "SELECT * FROM scenarios WHERE id = ?", (scenario_id,)
    ).fetchone()
    return _to_dict(row) if row else None


def create_scenario(
    *,
    name: str,
    description: str | None = None,
    overrides: dict[str, Any] | None = None,
    actor: str,
) -> dict[str, Any]:
    overrides = overrides or {}
    _validate_overrides(overrides)
    now = _now()
    with LOCK:
        conn = get_conn()
        sid = _next_id(conn)
        conn.execute(
            "INSERT INTO scenarios (id, name, description, overrides_json, status, "
            "created_by, created_at) VALUES (?, ?, ?, ?, 'draft', ?, ?)",
            (sid, name, description, json.dumps(overrides), actor, now),
        )
        conn.commit()
        record = get_scenario(sid)
        audit.record(
            actor=actor, actor_kind="human",
            process_id=PROCESS_ID, record_ref=f"scenario:{sid}",
            event_type="created", after=record,
        )
    return record


def update_scenario(
    scenario_id: str,
    *,
    actor: str,
    name: str | None = None,
    description: str | None = None,
    overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Edit name/description/overrides — only while the scenario is a draft."""
    if overrides is not None:
        _validate_overrides(overrides)
    with LOCK:
        conn = get_conn()
        before = get_scenario(scenario_id)
        if before is None:
            raise ValueError(f"unknown scenario: {scenario_id}")
        if before["status"] != "draft":
            raise ValueError(
                f"scenario {scenario_id} is {before['status']} — only drafts are editable"
            )
        conn.execute(
            "UPDATE scenarios SET name = ?, description = ?, overrides_json = ?, "
            "updated_at = ? WHERE id = ?",
            (
                name if name is not None else before["name"],
                description if description is not None else before["description"],
                json.dumps(overrides if overrides is not None else before["overrides"]),
                _now(), scenario_id,
            ),
        )
        conn.commit()
        after = get_scenario(scenario_id)
        audit.record(
            actor=actor, actor_kind="human",
            process_id=PROCESS_ID, record_ref=f"scenario:{scenario_id}",
            event_type="edited", before=before, after=after,
        )
    return after


def discard(scenario_id: str, actor: str) -> dict[str, Any]:
    """Discard a scenario (terminal). Promoted scenarios cannot be discarded."""
    with LOCK:
        conn = get_conn()
        before = get_scenario(scenario_id)
        if before is None:
            raise ValueError(f"unknown scenario: {scenario_id}")
        if before["status"] in _TERMINAL:
            raise ValueError(f"scenario {scenario_id} is already {before['status']}")
        conn.execute(
            "UPDATE scenarios SET status = 'discarded', updated_at = ? WHERE id = ?",
            (_now(), scenario_id),
        )
        conn.commit()
        after = get_scenario(scenario_id)
        audit.record(
            actor=actor, actor_kind="human",
            process_id=PROCESS_ID, record_ref=f"scenario:{scenario_id}",
            event_type="edited", before=before, after=after, rationale="discarded",
        )
    return after


def submit_for_review(scenario_id: str, maker: str) -> dict[str, Any]:
    """Queue a draft scenario for promotion: status -> in_review plus one
    pending maker-checker item at record_ref="scenario:{id}" (create_item
    records the "submitted" audit event). Deferred import: review imports this
    module for its decide() hook, so the dependency must point one way only."""
    import state.review as review

    with LOCK:
        conn = get_conn()
        before = get_scenario(scenario_id)
        if before is None:
            raise ValueError(f"unknown scenario: {scenario_id}")
        if before["status"] != "draft":
            raise ValueError(
                f"scenario {scenario_id} is {before['status']} — only drafts can be submitted"
            )
        if not before["overrides"]:
            raise ValueError(f"scenario {scenario_id} has no overrides to promote")
        conn.execute(
            "UPDATE scenarios SET status = 'in_review', updated_at = ? WHERE id = ?",
            (_now(), scenario_id),
        )
        conn.commit()
        review.create_item(
            process_id=PROCESS_ID, record_ref=f"scenario:{scenario_id}", maker=maker
        )
        return get_scenario(scenario_id)


def apply_promotion(scenario_id: str, checker: str) -> dict[str, Any]:
    """Apply an approved scenario to the governed store (review.decide hook).

    Each override goes through ``parameters.set_param`` — individually
    hash-chained at param:{key} with the promotion rationale — then the
    scenario is marked promoted ("posted" audit event) and ONE lineage handoff
    records the application on the scenario's timeline/evidence packet.
    """
    with LOCK:
        before = get_scenario(scenario_id)
        if before is None:
            raise ValueError(f"unknown scenario: {scenario_id}")
        if before["status"] != "in_review":
            raise ValueError(
                f"scenario {scenario_id} is {before['status']} — only in_review scenarios promote"
            )
        for key, value in before["overrides"].items():
            parameters.set_param(
                key, value, actor=checker,
                rationale=f"Promoted from scenario {scenario_id} ({before['name']})",
            )
        conn = get_conn()
        conn.execute(
            "UPDATE scenarios SET status = 'promoted', updated_at = ? WHERE id = ?",
            (_now(), scenario_id),
        )
        conn.commit()
        after = get_scenario(scenario_id)
        audit.record(
            actor=checker, actor_kind="human",
            process_id=PROCESS_ID, record_ref=f"scenario:{scenario_id}",
            event_type="posted", before=before, after=after,
            rationale=f"Scenario promoted — {len(before['overrides'])} parameter(s) applied",
        )
        lineage.record_handoff(
            record_ref=f"scenario:{scenario_id}",
            from_process=PROCESS_ID,
            to_process=PROCESS_ID,
            actor=checker,
            summary=f"Scenario promoted — {len(before['overrides'])} parameter(s) applied",
        )
    return after


def mark_rejected(scenario_id: str) -> dict[str, Any]:
    """Return a rejected scenario to draft (review.decide hook). The "rejected"
    audit event + return-handoff are written by decide() itself; this records
    just the status flip."""
    with LOCK:
        conn = get_conn()
        before = get_scenario(scenario_id)
        if before is None:
            raise ValueError(f"unknown scenario: {scenario_id}")
        conn.execute(
            "UPDATE scenarios SET status = 'draft', updated_at = ? WHERE id = ?",
            (_now(), scenario_id),
        )
        conn.commit()
        return get_scenario(scenario_id)
