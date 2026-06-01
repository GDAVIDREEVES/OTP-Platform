"""Evidence packet — the audit history for a record, plus chain integrity.

Each event already carries its before/after snapshot and rationale, so the
packet is assembled directly from the stream — an IDR/§6662 export in one call.
"""

from __future__ import annotations

from fastapi import APIRouter

import state.audit as audit

router = APIRouter()


@router.get("/api/evidence/{record_ref:path}")
def evidence(record_ref: str):
    events = audit.list_events(record_ref=record_ref)
    return {"record_ref": record_ref, "events": events, "verify": audit.verify_chain()}
