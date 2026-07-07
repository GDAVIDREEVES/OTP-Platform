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
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterator

import calc.trace as trace  # stdlib-only collector — no import cycle
import state.audit as audit
from state.engine import LOCK, get_conn

_DIR = Path(__file__).parent.parent / "seeds" / "parameters"

# Scenario overlay (Calc Studio CS-c). A contextvar so the override values are
# scoped to the enclosing ``overrides()`` block (and its thread/task) only —
# ``get_param`` consults it FIRST, so a scenario run sees its what-if values
# while ``set_param``/``list_params``/``get_param_row`` (the governed truth)
# never do. Outside an ``overrides()`` block reads behave exactly as before.
_OVERRIDES: ContextVar[dict[str, Any] | None] = ContextVar(
    "parameter_overrides", default=None
)


@contextmanager
def overrides(values: dict[str, Any]) -> Iterator[None]:
    """Overlay ``values`` over ``get_param`` reads for the enclosed block.

    The previous overlay (normally ``None``) is restored on exit even on
    error, so a failing scenario run cannot leak its overrides into later
    requests. Nested blocks shadow (and then restore) the outer overlay.
    """
    token = _OVERRIDES.set(values)
    try:
        yield
    finally:
        _OVERRIDES.reset(token)


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

    The scenario overlay (``overrides()``) is consulted FIRST: inside an
    overlay block an overridden key returns its what-if value (traced with
    ``overridden=True``) without ever touching the governed store.
    """
    overlay = _OVERRIDES.get()
    if overlay is not None and key in overlay:
        value = overlay[key]
        trace.emit("param", key=key, value=value, overridden=True)
        return value
    row = get_conn().execute("SELECT value FROM parameters WHERE key = ?", (key,)).fetchone()
    value = json.loads(row["value"]) if row else default
    trace.emit("param", key=key, value=value, overridden=False)
    return value


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


def _check_bounds(row: dict[str, Any], value: Any) -> None:
    """Enforce a numeric parameter's governed min/max (GP5).

    Additive and defensive: a no-op when both bounds are null OR when ``value``
    is not a numeric scalar (list/dict/string/bool params carry null bounds and
    are never constrained — bool is an int subclass, so it is excluded
    explicitly). An out-of-range numeric value raises ``ValueError``. This runs
    on EVERY write path (the direct-edit dialog, and scenario promotion), so the
    governed bounds hold no matter how the store is reached.
    """
    lo = row.get("min_value")
    hi = row.get("max_value")
    if lo is None and hi is None:
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return
    if lo is not None and value < lo:
        raise ValueError(f"{row['key']} = {value} is below the minimum {lo}")
    if hi is not None and value > hi:
        raise ValueError(f"{row['key']} = {value} is above the maximum {hi}")


def set_param(key: str, value: Any, actor: str, rationale: str | None = None) -> dict[str, Any]:
    """Update a parameter's value and hash-chain the change at param:{key}."""
    with LOCK:
        conn = get_conn()
        before = get_param_row(key)
        if before is None:
            raise ValueError(f"unknown parameter: {key}")
        _check_bounds(before, value)
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
    """Populate parameters from the seed (idempotent, regen-safe).

    Inserts every seed key that is MISSING from the table — so a brand-new DB
    gets the full seed, while an existing DB picks up newly added parameters
    (e.g. ``pl.use_post_charge``, Phase 5 W2) with their governed defaults.
    Existing rows — including user edits — are never touched.
    """
    with LOCK:
        conn = get_conn()
        existing = {
            r["key"] for r in conn.execute("SELECT key FROM parameters").fetchall()
        }
        now = _now()
        for p in _doc("parameters.v1.json")["parameters"]:
            if p["key"] in existing:
                continue
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
