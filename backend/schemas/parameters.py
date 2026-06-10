"""Request bodies for the governed parameter store endpoints (Phase 2a)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ParamPatch(BaseModel):
    """Edit a parameter's value. ``value`` is free-form JSON (scalar|list|dict)."""

    value: Any
    actor: str
    rationale: str | None = None


class ParamReset(BaseModel):
    """Reset a parameter to its governed default."""

    actor: str
