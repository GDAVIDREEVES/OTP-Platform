"""Append-only, hash-chained audit stream.

Every state change anywhere in the platform is written here through the
single writer, record(). Each row's hash covers the previous row's hash plus
the canonical payload, so the stream is tamper-evident: editing any stored
field, or reordering/deleting a row, breaks verify_chain().

This is a shell primitive — modules call it, they never implement logging
themselves — so audit coverage is total by construction.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from state.engine import LOCK, get_conn

GENESIS = "0" * 64
_ACTOR_KINDS = ("human", "assistant")

# The assistant's named actor in the trail. The Research Brain may *prepare* a
# maker's work, but it can never be a checker (see state/review.py).
ASSISTANT_ACTOR = "research-brain"


def _canonical(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def _hash(prev_hash: str, payload: dict[str, Any]) -> str:
    return hashlib.sha256((prev_hash + _canonical(payload)).encode("utf-8")).hexdigest()


def _payload_from_row(row: Any) -> dict[str, Any]:
    """The hashed payload — every signed field except id/prev_hash/hash."""
    return {
        "ts": row["ts"],
        "actor": row["actor"],
        "actor_kind": row["actor_kind"],
        "process_id": row["process_id"],
        "record_ref": row["record_ref"],
        "event_type": row["event_type"],
        "before": json.loads(row["before_json"]) if row["before_json"] else None,
        "after": json.loads(row["after_json"]) if row["after_json"] else None,
        "rationale": row["rationale"],
    }


def record(
    *,
    actor: str,
    actor_kind: str,
    record_ref: str,
    event_type: str,
    process_id: str | None = None,
    before: Any = None,
    after: Any = None,
    rationale: str | None = None,
) -> dict[str, Any]:
    """Append one event to the chain and return it."""
    if actor_kind not in _ACTOR_KINDS:
        raise ValueError(f"actor_kind must be one of {_ACTOR_KINDS}, got {actor_kind!r}")

    ts = datetime.now(timezone.utc).isoformat()
    payload = {
        "ts": ts,
        "actor": actor,
        "actor_kind": actor_kind,
        "process_id": process_id,
        "record_ref": record_ref,
        "event_type": event_type,
        "before": before,
        "after": after,
        "rationale": rationale,
    }

    with LOCK:
        conn = get_conn()
        last = conn.execute(
            "SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1"
        ).fetchone()
        prev_hash = last["hash"] if last else GENESIS
        h = _hash(prev_hash, payload)
        cur = conn.execute(
            """
            INSERT INTO audit_events
              (ts, actor, actor_kind, process_id, record_ref, event_type,
               before_json, after_json, rationale, prev_hash, hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ts, actor, actor_kind, process_id, record_ref, event_type,
                json.dumps(before) if before is not None else None,
                json.dumps(after) if after is not None else None,
                rationale, prev_hash, h,
            ),
        )
        conn.commit()
        event_id = cur.lastrowid

    return {
        "id": event_id,
        "prev_hash": prev_hash,
        "hash": h,
        **payload,
    }


def list_events(
    record_ref: str | None = None, process_id: str | None = None
) -> list[dict[str, Any]]:
    """Events for a record and/or process, oldest first."""
    clauses: list[str] = []
    params: list[Any] = []
    if record_ref is not None:
        clauses.append("record_ref = ?")
        params.append(record_ref)
    if process_id is not None:
        clauses.append("process_id = ?")
        params.append(process_id)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = get_conn().execute(
        f"SELECT * FROM audit_events{where} ORDER BY id", params
    ).fetchall()
    return [
        {"id": r["id"], "prev_hash": r["prev_hash"], "hash": r["hash"], **_payload_from_row(r)}
        for r in rows
    ]


def verify_chain() -> dict[str, Any]:
    """Recompute the whole chain; report the first row that doesn't match.

    Catches both field tampering (recomputed hash != stored hash) and
    reorder/deletion (a row's prev_hash != the prior row's stored hash).
    """
    rows = get_conn().execute("SELECT * FROM audit_events ORDER BY id").fetchall()
    prev = GENESIS
    for r in rows:
        expected = _hash(prev, _payload_from_row(r))
        if r["prev_hash"] != prev or r["hash"] != expected:
            return {"ok": False, "broken_at": r["id"]}
        prev = r["hash"]
    return {"ok": True, "broken_at": None}
