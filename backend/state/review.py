"""Maker-checker review queue.

decide() enforces segregation of duties in code, not just configuration:
a maker cannot approve their own work, the assistant can never be a checker,
and a rejection must carry a comment. Every decision writes an audit event,
so the control itself is part of the permanent record.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import state.audit as audit
from state.engine import LOCK, get_conn

# decision -> (stored status, audit event_type)
_DECISIONS = {"approve": "approved", "reject": "rejected"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_dict(row: Any) -> dict[str, Any]:
    return {k: row[k] for k in row.keys()}


def create_item(*, process_id: str, record_ref: str, maker: str) -> dict[str, Any]:
    now = _now()
    with LOCK:
        conn = get_conn()
        cur = conn.execute(
            "INSERT INTO review_items (process_id, record_ref, maker, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
            (process_id, record_ref, maker, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM review_items WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _to_dict(row)


def decide(
    item_id: int, checker: str, decision: str, comments: str | None = None
) -> dict[str, Any]:
    if decision not in _DECISIONS:
        raise ValueError(f"decision must be one of {sorted(_DECISIONS)}, got {decision!r}")
    if checker == audit.ASSISTANT_ACTOR:
        raise ValueError("the assistant can never be the checker; maker-checker requires two humans")
    if decision == "reject" and not comments:
        raise ValueError("a rejection requires a comment")

    status = _DECISIONS[decision]
    with LOCK:
        conn = get_conn()
        row = conn.execute("SELECT * FROM review_items WHERE id = ?", (item_id,)).fetchone()
        if row is None:
            raise ValueError(f"no review item {item_id}")
        if row["status"] != "pending":
            raise ValueError(f"review item {item_id} is already {row['status']}")
        if checker == row["maker"]:
            raise ValueError("a maker cannot approve their own work (segregation of duties)")
        now = _now()
        conn.execute(
            "UPDATE review_items SET checker = ?, status = ?, comments = ?, decided_at = ? WHERE id = ?",
            (checker, status, comments, now, item_id),
        )
        conn.commit()
        audit.record(
            actor=checker, actor_kind="human",
            process_id=row["process_id"], record_ref=row["record_ref"],
            event_type=status, rationale=comments,
        )
        updated = conn.execute("SELECT * FROM review_items WHERE id = ?", (item_id,)).fetchone()
    return _to_dict(updated)


def list_queue(status: str | None = "pending") -> list[dict[str, Any]]:
    if status is None:
        rows = get_conn().execute("SELECT * FROM review_items ORDER BY id").fetchall()
    else:
        rows = get_conn().execute(
            "SELECT * FROM review_items WHERE status = ? ORDER BY id", (status,)
        ).fetchall()
    return [_to_dict(r) for r in rows]
