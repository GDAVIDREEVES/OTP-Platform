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


def init_db() -> None:
    """Apply the schema. Idempotent (all CREATE ... IF NOT EXISTS)."""
    with LOCK:
        conn = get_conn()
        conn.executescript(_SCHEMA.read_text(encoding="utf-8"))
        conn.commit()


def close() -> None:
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None
