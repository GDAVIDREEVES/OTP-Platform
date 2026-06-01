"""Request bodies for the Phase 2 state endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DraftIn(BaseModel):
    user_id: str
    process_id: str
    record_ref: str
    step: str
    step_index: int = 0
    payload: dict[str, Any] = Field(default_factory=dict)
    status: str = "in_progress"


class ReviewItemIn(BaseModel):
    process_id: str
    record_ref: str
    maker: str


class ReviewDecisionIn(BaseModel):
    checker: str
    comments: str | None = None
