"""Request bodies for the calculation registry endpoints (Calc Studio CS-a)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class RunIn(BaseModel):
    """Run a registered calculation. ``args`` are merged over the handler's
    full default kwargs; ``scenario_id`` tags the run (overlay lands in CS-c)."""

    actor: str
    args: dict[str, Any] = {}
    scenario_id: str | None = None
