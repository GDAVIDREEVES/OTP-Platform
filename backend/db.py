"""DuckDB connection helper.

One in-memory instance shared across requests. The four parquet datasets are
registered as DuckDB views the first time the connection is created, so
queries reference `entity_roles` / `segment_pl` / `supply_chain` / `journal`
instead of re-scanning the files with read_parquet() on every request. Fresh
cursor per call so concurrent FastAPI requests don't collide on the
connection's internal cursor.
"""

from __future__ import annotations

from typing import Any

import duckdb

from config import ENTITY_ROLES, JOURNAL, SEGMENT_PL, SUPPLY_CHAIN

_con: duckdb.DuckDBPyConnection | None = None

# view name -> parquet glob (from config). Views are lazy: DuckDB resolves the
# files when the view is queried, so missing data fails at query time exactly
# as the old inline read_parquet() did.
_VIEWS = {
    "entity_roles": ENTITY_ROLES,
    "segment_pl": SEGMENT_PL,
    "supply_chain": SUPPLY_CHAIN,
    "journal": JOURNAL,
}


def _register_views(con: duckdb.DuckDBPyConnection) -> None:
    for name, glob in _VIEWS.items():
        con.execute(f"CREATE OR REPLACE VIEW {name} AS SELECT * FROM read_parquet('{glob}')")


def db() -> duckdb.DuckDBPyConnection:
    global _con
    if _con is None:
        _con = duckdb.connect(database=":memory:", read_only=False)
        _con.execute("SET memory_limit='2GB'")
        _con.execute("SET threads=4")
        _register_views(_con)
    return _con


def register_views() -> None:
    """Re-register the parquet views (e.g. after a data refresh)."""
    _register_views(db())


def close_db() -> None:
    global _con
    if _con is not None:
        _con.close()
        _con = None


def q(sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
    """Execute SQL and return rows as a list of dicts (JSON-friendly)."""
    cur = db().cursor()
    try:
        cur.execute(sql, params or [])
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        cur.close()
