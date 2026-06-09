"""Cross-process lineage primitive.

Everything that "loops back" between processes — a monitored exception handed to
adjustment, a rejected item returned to its maker, a benchmark refresh flagging
downstream prices — is physically one more audit event on the *same* record_ref.
Because it rides the single hash-chained writer (state/audit.py:record), each
handoff surfaces automatically in the per-process Audit tab and the evidence
packet; no new store, no separate timeline table.

record_handoff() writes one "handoff" event; list_handoffs() reads back the
lineage/timeline feed for a record_ref (the chronological story of who passed
what to whom).
"""

from __future__ import annotations

from typing import Any

import state.audit as audit

# The event types that make up a record's lineage/timeline feed: the lifecycle
# milestones plus the cross-process "handoff" hops. Anything else (e.g. noise)
# is excluded from the timeline view.
_TIMELINE_EVENTS = (
    "created",
    "submitted",
    "approved",
    "rejected",
    "handoff",
    "posted",
    "reversed",
    "prepared",
    "edited",
)


def record_handoff(
    *,
    record_ref: str,
    from_process: str,
    to_process: str,
    actor: str,
    summary: str,
    actor_kind: str = "human",
) -> dict[str, Any]:
    """Record one cross-process handoff against a record_ref.

    Writes a single "handoff" audit event attributed to the *receiving* process
    (process_id=to_process), carrying the from/to pair in `after` and the
    human-readable summary as the rationale. event_type is free TEXT in
    schema.sql, so "handoff" is additive and chain-safe.
    """
    return audit.record(
        actor=actor,
        actor_kind=actor_kind,
        process_id=to_process,
        record_ref=record_ref,
        event_type="handoff",
        rationale=summary,
        after={"from": from_process, "to": to_process},
    )


def list_handoffs(record_ref: str) -> list[dict[str, Any]]:
    """The lineage/timeline feed for a record_ref, oldest first.

    audit.list_events already returns chronological order; we filter to the
    timeline-relevant event types (lifecycle milestones + handoff hops).
    """
    return [
        e
        for e in audit.list_events(record_ref=record_ref)
        if e["event_type"] in _TIMELINE_EVENTS
    ]
