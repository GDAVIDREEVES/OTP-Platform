"""Master-data SQLite overlay + staging tables and CRUD."""
from __future__ import annotations

from state.engine import get_conn


def _tables() -> set[str]:
    rows = get_conn().execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {r["name"] for r in rows}


def test_md_tables_created(state_db):
    t = _tables()
    assert {"md_entity_function", "md_overlay", "md_staging", "md_mapping"} <= t
