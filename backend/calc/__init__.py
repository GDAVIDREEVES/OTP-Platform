"""Shared calculation layer (Phase 2b).

A thin, opt-in engine that dedupes the three patterns repeated across the ~24
computed routers:

* ``warehouse.aggregate`` — the GROUP-BY-RBUKRS / ``SUM(measure)`` +
  ``PeriodFilter`` pattern copied across csa/pnl/beat/flows.
* ``bands.evaluate_band`` — the TP-band status check, unified by delegating to
  ``services/status.py:compute_status`` (the existing single source of truth).
* ``allocation.allocate`` — the per-participant share/allocation kernel behind
  ``csa()``'s RAB share and ``profit_split()``'s value-driver split.

The engine is *opt-in*: routers adopt it incrementally, golden-gated to keep
their JSON responses byte-identical. It does not change ``services/status.py``
or ``services/entities.py`` — it composes them.
"""

from __future__ import annotations
