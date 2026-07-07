"""Request bodies for the waterfall endpoints.

GP4 (UX Phase 2): running or rolling back the waterfall no longer executes on
the HTTP call — it submits a maker-checker REQUEST (``WaterfallRequestIn``) that
a different reviewer must approve before the group P&L is touched.
"""

from __future__ import annotations

from pydantic import BaseModel


class WaterfallRequestIn(BaseModel):
    """Submit a waterfall apply/rollback request for maker-checker review.

    ``action`` is ``'run'`` (launch the charge sequence) or ``'rollback'``
    (reverse an applied run). For a run, ``steps`` (optional) is an ordered
    subset of the known step ids; omitted means the full default sequence.
    For a rollback, ``target_run_id`` is the applied run to reverse. ``year``
    defaults to the demo year; ``rationale`` is the requester's note captured on
    the request. Nothing executes until the enqueued review item is approved by
    a DIFFERENT reviewer.
    """

    actor: str
    action: str
    year: int = 2026
    steps: list[str] | None = None
    target_run_id: str | None = None
    rationale: str | None = None
