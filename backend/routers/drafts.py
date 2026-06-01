"""Workflow drafts — autosave and leave-and-return."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

import state.drafts as drafts
from schemas.state import DraftIn

router = APIRouter()


@router.get("/api/drafts")
def list_drafts(user_id: str, status: str | None = "in_progress"):
    return drafts.list_for_user(user_id, status=status)


@router.put("/api/drafts")
def put_draft(payload: DraftIn):
    return drafts.upsert(**payload.model_dump())


@router.get("/api/drafts/{process_id}/{record_ref:path}")
def get_draft(process_id: str, record_ref: str, user_id: str):
    draft = drafts.get(user_id=user_id, process_id=process_id, record_ref=record_ref)
    if draft is None:
        raise HTTPException(status_code=404, detail="No draft for that user/process/record")
    return draft


@router.delete("/api/drafts/{draft_id}")
def delete_draft(draft_id: int):
    return {"deleted": drafts.delete(draft_id)}
