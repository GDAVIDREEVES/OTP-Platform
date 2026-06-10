"""Engine algorithms (SPEC §5) — pure functions, no I/O.

M2 ships effective-dating resolution (§5.5); M3 ships largest-remainder
apportionment (§5.1); M5 ships cascading allocation (§5.2 —
``cascade.cascade_allocate``, the cascade-aware Stage-4 orchestration path)
and the reciprocal method (§5.3 — Tarjan SCC + Decimal Gaussian elimination
in ``reciprocal``). True-up (§5.4) lands with M6.
"""
