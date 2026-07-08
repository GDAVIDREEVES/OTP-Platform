"""Pydantic input model for /api/overrides/policy."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class PolicyOverrideIn(BaseModel):
    model_config = ConfigDict(extra="allow")

    tpMethod: str | None = None
    reviewer: str | None = None
    notes: str | None = None
    updatedBy: str | None = None
    # P4-2: the drawer's arm's-length range bounds, deviation threshold and
    # approver — previously dropped from the save payload. Additive + nullable
    # so older callers (which omit them) round-trip unchanged. Kept as strings:
    # the drawer edits raw text ("4", "7.5", "2") with a "%"/"pp" adornment.
    pli: str | None = None
    rangeLow: str | None = None
    rangeHigh: str | None = None
    deviationThreshold: str | None = None
    approver: str | None = None
