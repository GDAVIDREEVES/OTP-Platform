"""Startup bootstrap for mutable state.

Called once from the FastAPI lifespan: apply the SQLite schema, then import
any legacy JSON store into it. Seed-file loading (process catalog, users,
benchmarks, …) will be added here in a later phase.
"""

from __future__ import annotations

from pathlib import Path

from persistence import overrides
from state import engine


def run() -> None:
    engine.init_db()
    overrides.import_legacy_json()
    from state import master_data
    master_data.seed_if_empty()


def reset() -> None:
    """Wipe mutable state for a pristine demo, then re-init + re-import seeds.

    Deletes the SQLite file (and its WAL/SHM sidecars), so the audit stream,
    drafts, and review queue start empty. Run with the server stopped:
        cd backend && ../.venv/bin/python -m state.migrate --reset
    """
    engine.close()
    base = str(engine.db_path())
    for suffix in ("", "-wal", "-shm"):
        f = Path(base + suffix)
        if f.exists():
            f.unlink()
    run()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="OTP state migration / demo reset")
    parser.add_argument("--reset", action="store_true", help="wipe mutable state and re-seed")
    args = parser.parse_args()
    if args.reset:
        reset()
        print(f"demo state reset → {engine.db_path()}")
    else:
        run()
        print(f"migrated → {engine.db_path()}")
