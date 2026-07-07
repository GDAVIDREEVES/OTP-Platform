"""Waterfall apply/rollback requests — the maker-checker gate on the group P&L.

The waterfall (services/waterfall_runner.py) is the platform's highest-impact
write: it rewrites every entity's segmented P&L via the pl_overlays ledger.
Running or rolling one back therefore does NOT execute on a click — it creates
a PENDING request here and enqueues one maker-checker item at
record_ref="waterfall:{id}". The group P&L stays untouched until a DIFFERENT
reviewer approves that item in the /review queue, at which point
state/review.py:decide() calls ``apply_request()`` — which finally runs (or
rolls back) the waterfall. This is the exact execute-on-approve shape scenario
promotion uses (state/scenarios.py:apply_promotion).

Lifecycle: ``pending`` -> ``approved`` (executed) | ``rejected`` (never run).
Both decided states are terminal — a rejected request is not re-run; the P&L is
left exactly as it was. Every mutation is hash-chained at
record_ref="waterfall:{id}" (created/submitted via review.create_item, then
approved+posted or rejected via decide()), so each request's Audit tab and
/evidence/:ref packet light up with no extra wiring.

This module must NOT import state.review or services.waterfall_runner at module
level (review imports THIS module for its decide() hook): create_request defers
the review import, apply_request defers the runner import — the dependency
points one way only.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import state.audit as audit
import state.lineage as lineage
from state.engine import LOCK, get_conn

#: The waterfall's home process — segmented financials (the P&L it adjusts).
PROCESS_ID = "OTP-21"

_ACTIONS = ("run", "rollback")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_dict(row: Any) -> dict[str, Any]:
    """Row -> API dict: parse steps_json into `steps`, add the review ref."""
    d = {k: row[k] for k in row.keys()}
    d["steps"] = json.loads(d.pop("steps_json")) if d.get("steps_json") else None
    d["record_ref"] = f"waterfall:{d['id']}"
    return d


def _next_id(conn: Any) -> str:
    n = conn.execute("SELECT count(*) AS n FROM waterfall_requests").fetchone()["n"]
    return f"WFR-{n + 1}"


def get_request(request_id: str) -> dict[str, Any] | None:
    row = get_conn().execute(
        "SELECT * FROM waterfall_requests WHERE id = ?", (request_id,)
    ).fetchone()
    return _to_dict(row) if row else None


def list_requests(status: str | None = None) -> list[dict[str, Any]]:
    """Requests optionally filtered by status, newest first."""
    sql = "SELECT * FROM waterfall_requests"
    params: list[Any] = []
    if status is not None:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC, id DESC"
    rows = get_conn().execute(sql, params).fetchall()
    return [_to_dict(r) for r in rows]


def create_request(
    *,
    action: str,
    year: int,
    requested_by: str,
    target_run_id: str | None = None,
    steps: list[str] | None = None,
    rationale: str | None = None,
) -> dict[str, Any]:
    """Capture a pending run/rollback request and enqueue ONE maker-checker item.

    Nothing is executed — the P&L is untouched. ``create_item`` records the
    "submitted" audit event at record_ref="waterfall:{id}". Deferred import:
    review imports this module for its decide() hook, so the dependency points
    one way only.
    """
    if action not in _ACTIONS:
        raise ValueError(f"action must be one of {list(_ACTIONS)}, got {action!r}")
    if action == "rollback" and not target_run_id:
        raise ValueError("a rollback request requires target_run_id")

    import state.review as review

    now = _now()
    with LOCK:
        conn = get_conn()
        rid = _next_id(conn)
        conn.execute(
            "INSERT INTO waterfall_requests (id, action, year, target_run_id, "
            "steps_json, status, rationale, requested_by, created_at) "
            "VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
            (rid, action, year, target_run_id,
             json.dumps(steps) if steps else None, rationale, requested_by, now),
        )
        conn.commit()
        review.create_item(
            process_id=PROCESS_ID, record_ref=f"waterfall:{rid}", maker=requested_by
        )
        return get_request(rid)  # type: ignore[return-value]


def apply_request(request_id: str, checker: str) -> dict[str, Any]:
    """Execute an approved request (review.decide hook).

    Runs (or rolls back) the waterfall via services/waterfall_runner.py with the
    ORIGINAL requester as the run actor — the checker's approval is the
    countersign, recorded as the "approved" event decide() already wrote on this
    ref. Then the request is marked approved (executed_run_id set) with a
    "posted" audit event + ONE lineage handoff on its timeline/evidence packet.

    Deferred import: the runner pulls in the whole calc/allocation stack; keep it
    lazy so import order never bites and there is no cycle back through review.
    """
    import services.waterfall_runner as runner

    with LOCK:
        before = get_request(request_id)
        if before is None:
            raise ValueError(f"unknown waterfall request: {request_id}")
        if before["status"] != "pending":
            raise ValueError(
                f"waterfall request {request_id} is {before['status']} — only "
                "pending requests execute")

    # The run itself takes the LOCK internally (pl_overlays); run it OUTSIDE our
    # lock so we never re-enter it, exactly as the HTTP path did before.
    maker = before["requested_by"]
    if before["action"] == "run":
        run = runner.run_waterfall(
            actor=maker, year=before["year"], steps=before["steps"])
        executed_run_id = run["id"]
        summary = (f"Waterfall run {executed_run_id} {run['status']} on approval "
                   f"— requested by {maker}, approved by {checker}")
    else:  # rollback
        run = runner.rollback(before["target_run_id"], actor=maker)
        executed_run_id = before["target_run_id"]
        summary = (f"Waterfall run {executed_run_id} rolled back on approval "
                   f"— requested by {maker}, approved by {checker}")

    with LOCK:
        conn = get_conn()
        conn.execute(
            "UPDATE waterfall_requests SET status = 'approved', "
            "executed_run_id = ?, decided_at = ? WHERE id = ?",
            (executed_run_id, _now(), request_id),
        )
        conn.commit()
        after = get_request(request_id)
        audit.record(
            actor=checker, actor_kind="human",
            process_id=PROCESS_ID, record_ref=f"waterfall:{request_id}",
            event_type="posted", before=before, after=after, rationale=summary,
        )
        lineage.record_handoff(
            record_ref=f"waterfall:{request_id}",
            from_process=PROCESS_ID,
            to_process=PROCESS_ID,
            actor=checker,
            summary=summary,
        )
    return after  # type: ignore[return-value]


def mark_rejected(request_id: str) -> dict[str, Any]:
    """Mark a rejected request terminal (review.decide hook). NOTHING is
    executed — the group P&L is left exactly as it was. The "rejected" audit
    event + return-handoff are written by decide() itself; this records just the
    status flip."""
    with LOCK:
        conn = get_conn()
        before = get_request(request_id)
        if before is None:
            raise ValueError(f"unknown waterfall request: {request_id}")
        conn.execute(
            "UPDATE waterfall_requests SET status = 'rejected', decided_at = ? "
            "WHERE id = ?",
            (_now(), request_id),
        )
        conn.commit()
        return get_request(request_id)  # type: ignore[return-value]
