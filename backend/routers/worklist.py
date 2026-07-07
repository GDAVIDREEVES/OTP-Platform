"""Unified worklist ("My work" on /home) — one cross-process "what's on my plate" hub.

This is a *read-only aggregator*. It owns no store of its own; it composes four
existing sources into a single sorted feed:

  (a) the user's in-progress drafts   — state.drafts.list_for_user  (kind="draft")
  (b) the maker-checker review queue  — state.review.list_queue     (kind="review")
  (c) OTP-20 margin exceptions        — services.entities (same source the KPIs
      use), kept where status is "out-of-range" (high) or "watch"
      (medium — the early-warning band)                             (kind="exception")
  (d) open governance cases           — state.cases.list_cases      (kind="case")

Each item carries the deep-link `route` back to the process that owns it, so the
worklist is purely a launcher: every row routes to the real work surface.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

import state.cases as cases
import state.drafts as drafts
import state.review as review
from period_filter import PeriodFilter
from services.entities import list_entities

router = APIRouter()

# Sort priority: lower number = more urgent. Overdue work always rises first
# (handled before this), then we tie-break on the item's inherent priority.
_PRIORITY = {"high": 0, "medium": 1, "low": 2}


def _process_from_ref(record_ref: str, fallback: str | None) -> str | None:
    """Best-effort process id for a draft/review ref.

    Drafts and review items already carry their process_id, so the fallback is
    almost always what we want; the prefix sniff only helps for bare refs.
    """
    if fallback:
        return fallback
    if record_ref.startswith("adj:") or record_ref.startswith("OTP16-"):
        return "OTP-16"
    if record_ref.startswith("case:"):
        return "OTP-40"
    return None


def _route_for_process(process_id: str | None) -> str | None:
    return f"/process/{process_id}/overview" if process_id else None


def _draft_items(user: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for d in drafts.list_for_user(user):
        process_id = _process_from_ref(d["record_ref"], d["process_id"])
        route = _route_for_process(process_id)
        # Adjustment drafts encode their entity in the ref (OTP16-{entity_id});
        # deep-link straight to that entity's wizard so "resume" lands where the
        # user left off (same derivation the old home Resume surface used).
        if route and d["record_ref"].startswith("OTP16-"):
            route = f"{route}?entity={d['record_ref'][len('OTP16-'):]}"
        out.append(
            {
                "kind": "draft",
                "title": f"Resume {d['step']}",
                "ref": d["record_ref"],
                "process_id": process_id,
                "route": route,
                "due_at": None,
                "priority": "medium",
                "status": d["status"],
            }
        )
    return out


def _review_items(user: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for it in review.list_queue("pending"):
        mine = it["maker"] == user
        # Segregation of duties: you wait on your own submissions; you act on others'.
        status = "awaiting checker" if mine else "to approve"
        process_id = _process_from_ref(it["record_ref"], it["process_id"])
        out.append(
            {
                "kind": "review",
                "title": f"{it['record_ref']} — {status}",
                "ref": it["record_ref"],
                "process_id": process_id,
                # Approvals happen on /review (the process overview has no
                # approve buttons); your own pending submission has nowhere
                # useful to go, so it carries no route.
                "route": None if mine else "/review",
                "due_at": None,
                # Approvals you can act on outrank submissions you're only watching.
                "priority": "medium" if mine else "high",
                "status": status,
            }
        )
    return out


def _exception_items() -> list[dict[str, Any]]:
    """OTP-20 margin exceptions, computed from the same source the KPIs use.

    Out-of-range entities are act-now (high); watch entities are the
    early-warning band (medium) — surfaced so home shows trouble *before* it
    breaches the arm's-length range. Both carry margin-vs-target context.
    """
    entities = list_entities(PeriodFilter())
    out: list[dict[str, Any]] = []
    for e in entities:
        if e["status"] not in ("out-of-range", "watch"):
            continue
        out_of_range = e["status"] == "out-of-range"
        label = "out of range" if out_of_range else "on watch"
        margin = e["actualMargin"]
        context = f" — {margin}% vs {e['targetMarginLabel']}" if margin is not None else ""
        out.append(
            {
                "kind": "exception",
                "title": f"{e['name']} {label}{context}",
                "ref": f"OTP16-{e['id']}",
                "process_id": "OTP-16",
                "route": f"/process/OTP-16/overview?entity={e['id']}",
                "due_at": None,
                "priority": "high" if out_of_range else "medium",
                "status": e["status"],
            }
        )
    return out


def _case_items() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for c in cases.list_cases():
        if c["status"] == "closed":
            continue
        out.append(
            {
                "kind": "case",
                "title": c["title"],
                "ref": f"case:{c['id']}",
                "process_id": c["process_id"],
                "route": f"/process/{c['process_id']}/worklist",
                "due_at": c["due_at"],
                "priority": "high" if c["status"] == "in_progress" else "medium",
                "status": c["status"],
            }
        )
    return out


def _sort_key(item: dict[str, Any], now: str) -> tuple[Any, ...]:
    """Overdue-first, then by due date, then by inherent priority.

    Mirrors caseWorkspace.tsx's urgency idea: an item past its due date is the
    most urgent; otherwise the soonest due date wins; undated items sink to the
    bottom of their priority band.
    """
    due = item["due_at"]
    overdue = bool(due) and due < now
    return (
        0 if overdue else 1,
        due or "9999",
        _PRIORITY.get(item["priority"], 9),
    )


def build_worklist(user: str) -> list[dict[str, Any]]:
    from datetime import datetime, timezone

    items = (
        _draft_items(user)
        + _review_items(user)
        + _exception_items()
        + _case_items()
    )
    now = datetime.now(timezone.utc).isoformat()
    items.sort(key=lambda it: _sort_key(it, now))
    return items


@router.get("/api/worklist")
def get_worklist(user: str):
    return build_worklist(user)
