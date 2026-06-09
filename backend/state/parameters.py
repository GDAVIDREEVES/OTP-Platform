"""Governed parameter store — mutable SQLite state for the calc engine (Phase 2a).

The scattered hardcoded calc parameters (CSA growth/PCT multiplier, the BEAT
§59A thresholds and the RACCT->payment-type map, the reconciliation tolerance, …)
are pulled out of router code into a single governed registry. Routers read them
at handler top via ``get_param(key, default)``; nothing else changes, so with the
seeded defaults equal to the old constants the API responses stay byte-identical.

Each row's ``value`` / ``default_value`` is JSON-encoded so a parameter can hold a
scalar, a list, or a dict. Every edit is hash-chained into the audit trail at
record_ref="param:{key}" — the same lock+audit discipline used in
state/cases.py — so each parameter's Audit tab and /evidence/:ref packet light up
with no extra wiring.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import state.audit as audit
from state.engine import LOCK, get_conn

_DIR = Path(__file__).parent.parent / "seeds" / "parameters"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@lru_cache(maxsize=None)
def _doc(name: str) -> dict[str, Any]:
    return json.loads((_DIR / name).read_text(encoding="utf-8"))


def _to_dict(row: Any) -> dict[str, Any]:
    """Row -> API dict: JSON-parse `value`/`default_value` into `value`/`default`."""
    d = {k: row[k] for k in row.keys()}
    d["value"] = json.loads(d["value"])
    raw_default = d.pop("default_value")
    d["default"] = json.loads(raw_default) if raw_default is not None else None
    return d


def get_param(key: str, default: Any = None) -> Any:
    """The current JSON-parsed value for ``key``, or ``default`` if unknown.

    The ``default`` fallback equals the old hardcoded literal at each call site,
    so the parameter store can never silently change a response: an unseeded
    store behaves exactly like the pre-migration code.
    """
    row = get_conn().execute("SELECT value FROM parameters WHERE key = ?", (key,)).fetchone()
    return json.loads(row["value"]) if row else default


def list_params(category: str | None = None) -> list[dict[str, Any]]:
    """All parameters, optionally filtered by category, ordered by key."""
    sql = "SELECT * FROM parameters"
    params: list[Any] = []
    if category is not None:
        sql += " WHERE category = ?"
        params.append(category)
    sql += " ORDER BY key"
    rows = get_conn().execute(sql, params).fetchall()
    return [_to_dict(r) for r in rows]


def get_param_row(key: str) -> dict[str, Any] | None:
    """The full parameter record (value/default/metadata) for ``key``."""
    row = get_conn().execute("SELECT * FROM parameters WHERE key = ?", (key,)).fetchone()
    return _to_dict(row) if row else None


def set_param(key: str, value: Any, actor: str, rationale: str | None = None) -> dict[str, Any]:
    """Update a parameter's value and hash-chain the change at param:{key}."""
    with LOCK:
        conn = get_conn()
        before = get_param_row(key)
        if before is None:
            raise ValueError(f"unknown parameter: {key}")
        conn.execute(
            "UPDATE parameters SET value = ?, updated_at = ?, updated_by = ? WHERE key = ?",
            (json.dumps(value), _now(), actor, key),
        )
        conn.commit()
        after = get_param_row(key)
        audit.record(
            actor=actor, actor_kind="human",
            process_id=after.get("process_id"), record_ref=f"param:{key}",
            event_type="edited", before=before, after=after, rationale=rationale,
        )
    return after


def reset_param(key: str, actor: str) -> dict[str, Any]:
    """Restore a parameter to its governed default and hash-chain the reset."""
    with LOCK:
        conn = get_conn()
        before = get_param_row(key)
        if before is None:
            raise ValueError(f"unknown parameter: {key}")
        conn.execute(
            "UPDATE parameters SET value = ?, updated_at = ?, updated_by = ? WHERE key = ?",
            (json.dumps(before["default"]), _now(), actor, key),
        )
        conn.commit()
        after = get_param_row(key)
        audit.record(
            actor=actor, actor_kind="human",
            process_id=after.get("process_id"), record_ref=f"param:{key}",
            event_type="edited", before=before, after=after, rationale="reset to default",
        )
    return after


def seed_if_empty() -> None:
    """Populate parameters from the seed on first run (idempotent)."""
    with LOCK:
        conn = get_conn()
        if conn.execute("SELECT count(*) AS n FROM parameters").fetchone()["n"] != 0:
            return
        now = _now()
        for p in _doc("parameters.v1.json")["parameters"]:
            conn.execute(
                "INSERT INTO parameters (key, value, type, default_value, min_value, "
                "max_value, category, process_id, provenance, rationale, unit, updated_at, "
                "updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    p["key"], json.dumps(p["value"]), p.get("type"),
                    json.dumps(p["default"]) if "default" in p else None,
                    p.get("min"), p.get("max"), p.get("category"), p.get("process_id"),
                    p.get("provenance"), p.get("rationale"), p.get("unit"), now, None,
                ),
            )
        conn.commit()
