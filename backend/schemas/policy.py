"""Pydantic input model for /api/overrides/policy."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class PolicyOverrideIn(BaseModel):
    model_config = ConfigDict(extra="allow")

    tpMethod: str | None = None
    reviewer: str | None = None
    notes: str | None = None
    updatedBy: str | None = None
