"""Startup bootstrap for mutable state.

Called once from the FastAPI lifespan: apply the SQLite schema, then import
any legacy JSON store into it. Seed-file loading (process catalog, users,
benchmarks, …) will be added here in a later phase.
"""

from __future__ import annotations

from persistence import overrides
from state import engine


def run() -> None:
    engine.init_db()
    overrides.import_legacy_json()
