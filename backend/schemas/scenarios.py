"""Request bodies for the what-if scenario endpoints (Calc Studio CS-c)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ScenarioIn(BaseModel):
    """Create a scenario. ``overrides`` maps governed parameter keys to their
    what-if values (every key must exist in the parameter store)."""

    name: str
    description: str | None = None
    overrides: dict[str, Any] = Field(default_factory=dict)
    actor: str


class ScenarioPatch(BaseModel):
    """Edit a draft scenario; omitted fields keep their current value."""

    name: str | None = None
    description: str | None = None
    overrides: dict[str, Any] | None = None
    actor: str


class ScenarioCompareIn(BaseModel):
    """Compare a calculation under the scenario against the governed base.
    ``args`` are merged over the handler's full default kwargs on BOTH runs."""

    calc_id: str
    actor: str
    args: dict[str, Any] = {}


class ScenarioPromoteIn(BaseModel):
    """Submit a draft scenario for promotion (maker-checker review)."""

    maker: str


class ScenarioDiscardIn(BaseModel):
    """Discard a scenario (terminal)."""

    actor: str
