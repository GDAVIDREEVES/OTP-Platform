"""Maker-checker review queue."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

import state.review as review
from schemas.state import ReviewDecisionIn, ReviewItemIn

router = APIRouter()


@router.get("/api/review-queue")
def get_queue(status: str | None = "pending"):
    return review.list_queue(status=status)


@router.post("/api/review-queue")
def enqueue(payload: ReviewItemIn):
    return review.create_item(
        process_id=payload.process_id, record_ref=payload.record_ref, maker=payload.maker
    )


@router.post("/api/review/{item_id}/approve")
def approve(item_id: int, payload: ReviewDecisionIn):
    try:
        return review.decide(item_id, checker=payload.checker, decision="approve", comments=payload.comments)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/api/review/{item_id}/reject")
def reject(item_id: int, payload: ReviewDecisionIn):
    try:
        return review.decide(item_id, checker=payload.checker, decision="reject", comments=payload.comments)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
