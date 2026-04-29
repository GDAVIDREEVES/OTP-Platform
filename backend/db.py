"""DuckDB connection helper.

One in-memory instance shared across requests; queries hit parquet files
directly via read_parquet(). Fresh cursor per call so concurrent FastAPI
requests don't collide on the connection's internal cursor.
"""

from __future__ import annotations

from typing import Any

import duckdb

_con: duckdb.DuckDBPyConnection | None = None


def db() -> duckdb.DuckDBPyConnection:
    global _con
    if _con is None:
        _con = duckdb.connect(database=":memory:", read_only=False)
        _con.execute("SET memory_limit='2GB'")
        _con.execute("SET threads=4")
    return _con


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
