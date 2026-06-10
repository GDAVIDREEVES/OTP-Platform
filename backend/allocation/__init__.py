"""Intercompany cost allocation engine (docs/allocation/SPEC.md).

PURE package — no I/O anywhere under ``backend/allocation/``. Persistence
(state/allocation_store.py), the seeds generator (seeds/allocation/) and the
API are adapters around it (ENGINE-CLAUDE.md "Engine purity").

Hard rules (ENGINE-CLAUDE.md):
- Money is ``decimal.Decimal`` (precision 28, ROUND_HALF_EVEN); never floats,
  including tests. Rounding only at SPEC §5.6's three boundaries.
- ``allocation/generated/`` is codegen output from
  docs/allocation/intercompany-allocation-schema.json — never hand-edit;
  regenerate via ``python -m allocation.codegen`` (from backend/).
- Validation rules carry IDs (V-P1, V-K3, ...) in code comments and test names.
"""
