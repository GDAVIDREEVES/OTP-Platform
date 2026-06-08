"""Governance Case Workspace — mutable SQLite state for OTP-30/31/40/50.

A case is a governance object (controversy / restructuring / integration matter)
with status, owner, due date, exposure, and an interactive checklist. Every
mutation is hash-chained into the audit trail at record_ref="case:{id}" — exactly
the lock+audit discipline used in state/review.py — so each case's Audit tab and
/evidence/:ref packet light up with no extra wiring.

State dicts expose `checklist` parsed (json.loads of checklist_json) and drop the
raw column, so the API shape matches the frontend `Case` type directly.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import state.audit as audit
from state.engine import LOCK, get_conn

_DIR = Path(__file__).parent.parent / "seeds" / "cases"

_STATUSES = ("open", "in_progress", "submitted", "closed")
# Sort urgency: active work first, resolved last.
_STATUS_RANK = {"in_progress": 0, "open": 1, "submitted": 2, "closed": 3}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@lru_cache(maxsize=None)
def _doc(name: str) -> dict[str, Any]:
    return json.loads((_DIR / name).read_text(encoding="utf-8"))


def _to_dict(row: Any) -> dict[str, Any]:
    """Row -> API dict: parse checklist_json into `checklist`, drop the raw key."""
    d = {k: row[k] for k in row.keys()}
    d["checklist"] = json.loads(d.pop("checklist_json")) if d.get("checklist_json") else []
    return d


def _next_id(conn: Any) -> str:
    n = conn.execute("SELECT count(*) AS n FROM cases").fetchone()["n"]
    return f"CASE-{n + 1}"


def list_cases(process_id: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
    """Cases optionally filtered by process and/or status, ordered status-urgency then due_at."""
    sql = "SELECT * FROM cases"
    clauses: list[str] = []
    params: list[Any] = []
    if process_id is not None:
        clauses.append("process_id = ?")
        params.append(process_id)
    if status is not None:
        clauses.append("status = ?")
        params.append(status)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    rows = get_conn().execute(sql, params).fetchall()
    cases = [_to_dict(r) for r in rows]
    cases.sort(key=lambda c: (_STATUS_RANK.get(c["status"], 99), c["due_at"] or "9999"))
    return cases


def get_case(case_id: str) -> dict[str, Any] | None:
    row = get_conn().execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
    return _to_dict(row) if row else None


def create_case(
    *,
    process_id: str,
    kind: str,
    title: str,
    owner: str,
    counterparty: str | None = None,
    jurisdiction: str | None = None,
    exposure: float | None = None,
    due_at: str | None = None,
    checklist: list[dict] | None = None,
    actor: str,
    case_id: str | None = None,
    opened_at: str | None = None,
) -> dict[str, Any]:
    now = _now()
    checklist = checklist or []
    with LOCK:
        conn = get_conn()
        cid = case_id or _next_id(conn)
        conn.execute(
            "INSERT INTO cases (id, process_id, kind, title, status, owner, counterparty, "
            "jurisdiction, exposure, opened_at, due_at, checklist_json, notes, created_at) "
            "VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (cid, process_id, kind, title, owner, counterparty, jurisdiction, exposure,
             opened_at or now, due_at, json.dumps(checklist), None, now),
        )
        conn.commit()
        record = get_case(cid)
        audit.record(
            actor=actor, actor_kind="human",
            process_id=process_id, record_ref=f"case:{cid}",
            event_type="created", after=record,
        )
    return record


def set_status(case_id: str, status: str, actor: str) -> dict[str, Any]:
    if status not in _STATUSES:
        raise ValueError(f"invalid status: {status}")
    with LOCK:
        conn = get_conn()
        before = get_case(case_id)
        if before is None:
            raise ValueError(f"unknown case: {case_id}")
        conn.execute(
            "UPDATE cases SET status = ?, updated_at = ? WHERE id = ?",
            (status, _now(), case_id),
        )
        conn.commit()
        after = get_case(case_id)
        event_type = (
            "submitted" if status == "submitted"
            else "posted" if status == "closed"
            else "edited"
        )
        audit.record(
            actor=actor, actor_kind="human",
            process_id=after["process_id"], record_ref=f"case:{case_id}",
            event_type=event_type, before=before, after=after,
        )
    return after


def set_checklist_step(case_id: str, step_key: str, done: bool, actor: str) -> dict[str, Any]:
    with LOCK:
        conn = get_conn()
        before = get_case(case_id)
        if before is None:
            raise ValueError(f"unknown case: {case_id}")
        if not any(s.get("key") == step_key for s in before["checklist"]):
            raise ValueError(f"unknown step: {step_key}")
        # Build a new list so `before` stays the pre-edit snapshot for the audit diff.
        new_checklist = [
            {**s, "done": done} if s.get("key") == step_key else s
            for s in before["checklist"]
        ]
        conn.execute(
            "UPDATE cases SET checklist_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(new_checklist), _now(), case_id),
        )
        conn.commit()
        after = get_case(case_id)
        audit.record(
            actor=actor, actor_kind="human",
            process_id=after["process_id"], record_ref=f"case:{case_id}",
            event_type="edited", before=before, after=after,
        )
    return after


def seed_if_empty() -> None:
    """Populate cases from the seed on first run (idempotent)."""
    with LOCK:
        conn = get_conn()
        if conn.execute("SELECT count(*) AS n FROM cases").fetchone()["n"] != 0:
            return
        for c in _doc("cases.v1.json")["cases"]:
            conn.execute(
                "INSERT INTO cases (id, process_id, kind, title, status, owner, counterparty, "
                "jurisdiction, exposure, opened_at, due_at, checklist_json, notes, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (c["id"], c["process_id"], c["kind"], c["title"], c.get("status", "open"),
                 c["owner"], c.get("counterparty"), c.get("jurisdiction"), c.get("exposure"),
                 c["opened_at"], c.get("due_at"), json.dumps(c.get("checklist", [])),
                 c.get("notes"), _now()),
            )
        conn.commit()
