"""Band evaluation kernel.

There are three benchmark-band patterns scattered across the routers. This
module unifies them onto the single existing source of truth —
``services/status.py:compute_status`` — so every band check shares the same
in-range / watch / out-of-range / no-data rule and financing-entity tolerance.

It deliberately delegates rather than reimplements: ``services/status.py`` and
``services/entities.py`` keep their exact behaviour. ``evaluate_band`` is just a
named, reusable entry point onto ``compute_status`` for the calc engine.
"""

from __future__ import annotations

from typing import Any

from services.status import compute_status
from state import seeds


def evaluate_band(
    actual: float | None, low: float, high: float
) -> tuple[str, float | None]:
    """Classify ``actual`` against the ``[low, high]`` band.

    Returns ``(status, variance)`` exactly as ``services/status.py:compute_status``
    does — ``status`` in ``{"no-data", "in-range", "watch", "out-of-range"}`` and
    ``variance`` the signed points outside the band (0 inside, ``None`` for
    no-data). This is the single band-evaluation entry point for the engine.
    """
    return compute_status(actual, low, high)


def benchmark_band(set_id: str) -> dict[str, Any] | None:
    """Look up one benchmark set from the ``benchmarks`` reference seed.

    Returns the set dict (``lower``/``median``/``upper``/``pli``/…) for ``set_id``
    or ``None`` if unknown. A convenience for callers that evaluate an actual PLI
    against a published comparables range; the band values are in the seed's
    own unit (percent), so callers convert as needed before ``evaluate_band``.
    """
    doc = seeds.load("benchmarks")
    for s in doc.get("sets", []):
        if s.get("set_id") == set_id:
            return s
    return None
