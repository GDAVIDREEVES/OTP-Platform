"""Adjustments — submitted-adjustment workflow."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from persistence import overrides as store
from schemas.adjustment import AdjustmentIn, AdjustmentPatch, AdjustmentReverseIn

router = APIRouter()


@router.get("/api/adjustments")
def list_submitted_adjustments():
    return store.list_adjustments()


@router.post("/api/adjustments")
def post_adjustment(payload: AdjustmentIn):
    return store.submit_adjustment(payload.model_dump(exclude_none=True))


@router.patch("/api/adjustments/{adj_id}")
def patch_adjustment(adj_id: str, payload: AdjustmentPatch):
    """Update status / approver / notes on an adjustment."""
    try:
        record = store.update_adjustment(adj_id, payload.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if record is None:
        raise HTTPException(status_code=404, detail=f"Adjustment {adj_id} not found")
    return record


@router.delete("/api/adjustments/{adj_id}")
def delete_adjustment(adj_id: str):
    """Hard-delete a still-pending adjustment. Approved/Exported require reversal."""
    deleted = store.delete_adjustment(adj_id)
    if not deleted:
        raise HTTPException(
            status_code=409,
            detail=f"Adjustment {adj_id} not found, or already approved (use reverse instead).",
        )
    return {"deleted": adj_id}


@router.post("/api/adjustments/{adj_id}/reverse")
def reverse_adjustment(adj_id: str, payload: AdjustmentReverseIn = AdjustmentReverseIn()):
    """Mark original as Reversed and create a counter-adjustment with opposite sign."""
    counter = store.reverse_adjustment(adj_id, by=payload.by)
    if counter is None:
        raise HTTPException(
            status_code=409,
            detail=f"Adjustment {adj_id} not found or already reversed.",
        )
    return counter
