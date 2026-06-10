"""Request bodies for the allocation engine endpoints (M6)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class AllocationRunIn(BaseModel):
    """Launch an allocation run (SPEC §6 run config subset).

    ``period`` is "YYYY-MM" for budget/actual runs; trueup runs take the
    year — either ``period`` = "YYYY" or the ``year`` convenience field.
    ``config`` overlays the SPEC §6 defaults (e.g. chargeCurrency,
    fxRateType); ``scope`` is the optional pool/provider scope.
    """

    run_type: str
    actor: str
    period: str | None = None
    year: str | None = None
    scope: dict[str, Any] | None = None
    config: dict[str, Any] | None = None
