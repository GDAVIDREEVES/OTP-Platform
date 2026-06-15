"""Request bodies for the Allocation Pool Builder endpoints (Phase 6 PB2).

An ``AuthoredPoolDefinition`` is the user-built cost-to-charge pool: a
cost-capture rule (predicates over cost_center / profit_center / cost_element,
optional split %), beneficiaries, an allocation key factor, exclusions and
per-jurisdiction markup policies. The definition rides through the API as a
free-shaped dict (``definition``) — ``state/authored_pools.validate_definition``
is the single source of truth for its shape, so the schema here stays thin and
never drifts from the validator.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class AuthoredPoolIn(BaseModel):
    """Create a draft authored pool. ``definition`` is the authoring object
    (validated by state/authored_pools.validate_definition)."""

    definition: dict[str, Any]
    actor: str
    process_id: str | None = None


class AuthoredPoolPatch(BaseModel):
    """Edit an authored pool (drafts in place; an active pool versions + returns
    to draft). A definition change invalidates the test gate."""

    actor: str
    definition: dict[str, Any] | None = None
    process_id: str | None = None


class CaptureRuleIn(BaseModel):
    """A cost-capture rule for the live preview (no persist)."""

    cost_centers: list[str] | None = None
    profit_centers: list[str] | None = None
    cost_elements: list[str] | None = None
    split_pct: str | None = None
    source: str = "actual"


class ActorIn(BaseModel):
    actor: str


class MakerIn(BaseModel):
    maker: str
