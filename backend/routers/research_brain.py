"""Research Brain — process-aware assistance.

Phase 2 ships the agentic "prepare steps" hand-off as a scripted, shaped
response that logs the assisted work to the audit trail as a distinct actor
("research-brain"). Phase 3 swaps the body for the real Claude API + the
researchbrain HTTP service; the response shape and the audit boundary are the
same either way, so the UX hand-off renders regardless.
"""

from __future__ import annotations

from fastapi import APIRouter

import state.audit as audit
from schemas.state import PrepareIn

router = APIRouter()


@router.post("/api/research-brain/prepare")
def prepare(payload: PrepareIn):
    if payload.summary:
        summary = payload.summary
    else:
        lead = f"Pulled {payload.postings:,} SAP/ACDOCA lines" if payload.postings else "Pulled the entity’s SAP/ACDOCA postings"
        parts = [lead, "applied TP policy §4.2", "rebuilt the segmented P&L"]
        if payload.gap_pp is not None:
            parts.append(f"quantified the gap to range at {payload.gap_pp:+.1f}pp")
        summary = ", ".join(parts) + ". The remaining steps — judgment, review, and posting — are yours."

    event = audit.record(
        actor=audit.ASSISTANT_ACTOR,
        actor_kind="assistant",
        process_id=payload.process_id,
        record_ref=payload.record_ref,
        event_type="prepared",
        rationale=summary,
    )
    return {"summary": summary, "actor": audit.ASSISTANT_ACTOR, "event_id": event["id"]}
