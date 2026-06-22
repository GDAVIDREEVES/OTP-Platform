"""SQLite connection + schema bootstrap for mutable app state.

One shared connection (check_same_thread=False) guarded by a module lock so
concurrent FastAPI requests serialise their writes — the same discipline the
old JSON store used. Tests point the engine at a temp file via configure().
"""

from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

_BASE = Path(__file__).parent
_SCHEMA = _BASE / "schema.sql"

# Default location; override with OTP_STATE_DB or configure() (tests do this).
_db_path: Path = Path(os.getenv("OTP_STATE_DB", str(_BASE / "otp_state.db")))
_conn: sqlite3.Connection | None = None

# Serialises writes across request threads. Re-entrant so a write that also
# emits an audit event (which takes the same lock) can't deadlock itself.
LOCK = threading.RLock()


def configure(db_path: str | Path) -> None:
    """Point the engine at a different database file (closes any open conn)."""
    global _db_path
    close()
    _db_path = Path(db_path)


def db_path() -> Path:
    return _db_path


def get_conn() -> sqlite3.Connection:
    """Lazily open (once) and return the shared connection."""
    global _conn
    if _conn is None:
        _db_path.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(str(_db_path), check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA foreign_keys=ON")
    return _conn


# Additive columns introduced after a table's original CREATE. SQLite cannot
# express "ADD COLUMN IF NOT EXISTS", so init_db() adds any of these missing from
# an existing DB — append-only, never dropping or rewriting data.
_ADDITIVE_COLUMNS: tuple[tuple[str, str, str], ...] = (
    # (table, column, column-def) — Phase 7 MC1 canvas graph storage.
    ("user_calculations", "graph_json", "TEXT"),
    # Phase 7 MC3 — allocation stage-graph storage (visual layer; the compiled
    # definition stays the source of truth, the graph is the canvas view).
    ("authored_pools", "graph_json", "TEXT"),
)


def _ensure_columns(conn: sqlite3.Connection) -> None:
    for table, column, coldef in _ADDITIVE_COLUMNS:
        cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if column not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coldef}")


def init_db() -> None:
    """Apply the schema. Idempotent (all CREATE ... IF NOT EXISTS) plus any
    additive ALTER TABLE columns introduced after a table's original create."""
    with LOCK:
        conn = get_conn()
        conn.executescript(_SCHEMA.read_text(encoding="utf-8"))
        _ensure_columns(conn)
        conn.commit()


def close() -> None:
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None
