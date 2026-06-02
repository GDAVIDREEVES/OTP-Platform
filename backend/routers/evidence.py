"""Evidence packet — the full audit story for a record, assembled in one call:
the append-only event history, before/after diffs, the linked ACDOCA postings,
and a chain-integrity check. An IDR / §6662 export without weeks of assembly.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

import state.audit as audit
from db import q
from persistence import overrides as store

router = APIRouter()


@router.get("/api/evidence/{record_ref:path}")
def evidence(record_ref: str):
    events = audit.list_events(record_ref=record_ref)
    entity_id, adj = _resolve_entity(record_ref)
    postings = []
    if entity_id:
        postings = q(
            """
            SELECT RBUKRS, GJAHR, POPER, BUDAT, BELNR, RACCT, MATNR, HSL, RHCUR, SGTXT
            FROM journal WHERE RBUKRS = ? ORDER BY BUDAT DESC LIMIT 25
            """,
            [entity_id],
        )
    subject = None
    if adj:
        subject = f"{adj.get('entityName') or entity_id} · {adj.get('id')}"
    elif entity_id:
        subject = entity_id

    return {
        "record_ref": record_ref,
        "subject": subject,
        "events": events,
        "diffs": _diffs(events),
        "postings": postings,
        "verify": audit.verify_chain(),
    }


def _diffs(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-event field-level before/after changes."""
    out = []
    for e in events:
        before = e.get("before") or {}
        after = e.get("after") or {}
        changes = []
        for k in sorted(set([*before.keys(), *after.keys()])):
            b, a = before.get(k), after.get(k)
            if b != a:
                changes.append({"field": k, "from": b, "to": a})
        if changes:
            out.append({
                "event_id": e["id"], "event_type": e["event_type"],
                "ts": e["ts"], "actor": e["actor"], "changes": changes,
            })
    return out


def _resolve_entity(record_ref: str):
    """Map a record_ref to its subject entity (and adjustment, if any)."""
    if record_ref.startswith("adj:"):
        adj_id = record_ref[4:]
        for a in store.list_adjustments():
            if a.get("id") == adj_id:
                return a.get("entityId"), a
        return None, None
    if record_ref.startswith("OTP16-"):
        return record_ref[6:], None
    if ":" in record_ref:
        return record_ref.split(":", 1)[1], None
    return None, None
