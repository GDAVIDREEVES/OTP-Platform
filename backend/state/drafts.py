"""Workflow drafts — autosave and leave-and-return.

One draft per (user, process, record). upsert() is what the workflow path
calls on every step change; list_for_user() feeds the home's "pick up where
you left off" surface; get() restores a returning user to their exact step.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from state.engine import LOCK, get_conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "process_id": row["process_id"],
        "record_ref": row["record_ref"],
        "step": row["step"],
        "step_index": row["step_index"],
        "payload": json.loads(row["payload"]),
        "status": row["status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def upsert(
    *,
    user_id: str,
    process_id: str,
    record_ref: str,
    step: str,
    step_index: int = 0,
    payload: dict[str, Any] | None = None,
    status: str = "in_progress",
) -> dict[str, Any]:
    payload = payload or {}
    now = _now()
    with LOCK:
        conn = get_conn()
        existing = conn.execute(
            "SELECT id FROM process_drafts WHERE user_id = ? AND process_id = ? AND record_ref = ?",
            (user_id, process_id, record_ref),
        ).fetchone()
        if existing:
            draft_id = existing["id"]
            conn.execute(
                "UPDATE process_drafts SET step = ?, step_index = ?, payload = ?, status = ?, updated_at = ? WHERE id = ?",
                (step, step_index, json.dumps(payload), status, now, draft_id),
            )
        else:
            cur = conn.execute(
                """
                INSERT INTO process_drafts
                  (user_id, process_id, record_ref, step, step_index, payload, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, process_id, record_ref, step, step_index, json.dumps(payload), status, now, now),
            )
            draft_id = cur.lastrowid
        conn.commit()
        row = conn.execute("SELECT * FROM process_drafts WHERE id = ?", (draft_id,)).fetchone()
    return _to_dict(row)


def get(*, user_id: str, process_id: str, record_ref: str) -> dict[str, Any] | None:
    row = get_conn().execute(
        "SELECT * FROM process_drafts WHERE user_id = ? AND process_id = ? AND record_ref = ?",
        (user_id, process_id, record_ref),
    ).fetchone()
    return _to_dict(row) if row else None


def list_for_user(user_id: str, status: str | None = "in_progress") -> list[dict[str, Any]]:
    if status is None:
        rows = get_conn().execute(
            "SELECT * FROM process_drafts WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
    else:
        rows = get_conn().execute(
            "SELECT * FROM process_drafts WHERE user_id = ? AND status = ? ORDER BY updated_at DESC",
            (user_id, status),
        ).fetchall()
    return [_to_dict(r) for r in rows]


def delete(draft_id: int) -> bool:
    with LOCK:
        conn = get_conn()
        cur = conn.execute("DELETE FROM process_drafts WHERE id = ?", (draft_id,))
        conn.commit()
        return cur.rowcount > 0
