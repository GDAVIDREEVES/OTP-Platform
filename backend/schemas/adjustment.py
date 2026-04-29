"""Pydantic input models for /api/adjustments."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AdjustmentIn(BaseModel):
    """Body for POST /api/adjustments."""

    model_config = ConfigDict(extra="allow")

    entityId: str
    amount: float
    currency: str
    mode: Literal["median", "upper", "custom"]
    targetMargin: float
    actualMargin: float
    submittedBy: str
    entityName: str | None = None
    notes: str | None = None


class AdjustmentPatch(BaseModel):
    """Body for PATCH /api/adjustments/{id} — partial update."""

    model_config = ConfigDict(extra="allow")

    status: Literal[
        "Pending Approval", "Approved", "Rejected", "Exported", "Reversed"
    ] | None = None
    by: str | None = None
    approvedBy: str | None = None
    exportedRef: str | None = None
    rejectionReason: str | None = None
    notes: str | None = None


class AdjustmentReverseIn(BaseModel):
    by: str | None = None
