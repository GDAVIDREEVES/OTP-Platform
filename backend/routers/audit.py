"""Audit stream — read + integrity check."""

from __future__ import annotations

from fastapi import APIRouter

import state.audit as audit

router = APIRouter()


@router.get("/api/audit")
def list_audit(record_ref: str | None = None, process_id: str | None = None):
    return audit.list_events(record_ref=record_ref, process_id=process_id)


@router.get("/api/audit/verify")
def verify_audit():
    return audit.verify_chain()
