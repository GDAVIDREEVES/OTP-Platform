"""Calculation run history — mutable SQLite state for Calc Studio (CS-a).

One row per ``services/calc_registry.py:run()`` invocation: actor, args,
status, duration, the sha256 digest + summary of the output (the output body
itself is NOT persisted), the parameters read during the run and the raw trace
steps collected via ``calc/trace.py``. Same lock discipline as
``state/cases.py``; the matching audit event ("run" at record_ref
"calc:{calc_id}") is written by the registry, not here.

State dicts expose the ``*_json`` columns parsed (``overrides`` / ``args`` /
``summary`` / ``params_read`` / ``trace``) and drop the raw columns, so the API
shape is ready for the frontend Runs console.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from state.engine import LOCK, get_conn

_STATUSES = ("succeeded", "failed")

# raw column -> parsed key, with the fallback used when the column is NULL.
_JSON_COLS = {
    "overrides_json": ("overrides", None),
    "args_json": ("args", None),
    "summary_json": ("summary", None),
    "params_read_json": ("params_read", []),
    "trace_json": ("trace", []),
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_dict(row: Any) -> dict[str, Any]:
    """Row -> API dict: parse each ``*_json`` column into its object key.

    ``scenario_sensitive`` (CS-c) is derived, not stored: did the run's
    overrides intersect the parameters the handler actually read? Deriving it
    from the two persisted columns means it can never drift and historical
    rows gain the flag retroactively.
    """
    d = {k: row[k] for k in row.keys()}
    for raw, (key, fallback) in _JSON_COLS.items():
        raw_val = d.pop(raw)
        d[key] = json.loads(raw_val) if raw_val else fallback
    d["scenario_sensitive"] = bool(
        set(d["overrides"] or {}) & {p.get("key") for p in d["params_read"]}
    )
    return d


def insert_run(
    *,
    calc_id: str,
    actor: str,
    status: str,
    scenario_id: str | None = None,
    overrides: dict[str, Any] | None = None,
    args: dict[str, Any] | None = None,
    duration_ms: int | None = None,
    output_digest: str | None = None,
    summary: dict[str, Any] | None = None,
    params_read: list[dict[str, Any]] | None = None,
    trace: list[dict[str, Any]] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    """Persist one run row and return it (with the JSON columns parsed)."""
    if status not in _STATUSES:
        raise ValueError(f"invalid status: {status}")
    with LOCK:
        conn = get_conn()
        cur = conn.execute(
            "INSERT INTO calc_runs (calc_id, actor, ts, scenario_id, overrides_json, "
            "args_json, status, duration_ms, output_digest, summary_json, "
            "params_read_json, trace_json, error) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                calc_id, actor, _now(), scenario_id,
                json.dumps(overrides) if overrides is not None else None,
                json.dumps(args) if args is not None else None,
                status, duration_ms, output_digest,
                json.dumps(summary) if summary is not None else None,
                json.dumps(params_read) if params_read is not None else None,
                json.dumps(trace) if trace is not None else None,
                error,
            ),
        )
        conn.commit()
        run_id = cur.lastrowid
    return get_run(run_id)


def list_runs(
    calc_id: str | None = None,
    scenario_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Runs newest-first, optionally filtered by calc, scenario and/or status."""
    sql = "SELECT * FROM calc_runs"
    clauses: list[str] = []
    params: list[Any] = []
    if calc_id is not None:
        clauses.append("calc_id = ?")
        params.append(calc_id)
    if scenario_id is not None:
        clauses.append("scenario_id = ?")
        params.append(scenario_id)
    if status is not None:
        clauses.append("status = ?")
        params.append(status)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    rows = get_conn().execute(sql, params).fetchall()
    return [_to_dict(r) for r in rows]


def get_run(run_id: int) -> dict[str, Any] | None:
    row = get_conn().execute("SELECT * FROM calc_runs WHERE id = ?", (run_id,)).fetchone()
    return _to_dict(row) if row else None
