"""Request bodies for the waterfall endpoints (Phase 5 W1)."""

from __future__ import annotations

from pydantic import BaseModel


class WaterfallRunIn(BaseModel):
    """Launch a waterfall run.

    ``steps`` (optional) is an ordered subset of the known step ids; omitted
    means the full default sequence service_allocation -> royalties ->
    csa_true_up -> profit_split. ``year`` defaults to the demo year and is
    recorded on the run.
    """

    actor: str
    steps: list[str] | None = None
    year: int = 2026


class WaterfallRollbackIn(BaseModel):
    actor: str
