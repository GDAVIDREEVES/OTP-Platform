"""Allocation engine persistence — append-only ledgers + the run table.

Adapter between the pure engine (backend/allocation/) and SQLite. Tables are
created by the GENERATED DDL spliced into state/schema.sql (allocation/codegen.py).

Discipline (ENGINE-CLAUDE.md):
- The four ledgers (cost_lines, key_values, charge_ledger, recon) are
  APPEND-ONLY: this module deliberately exposes NO update or delete functions
  for them — corrections are reversing rows inserted like any other row.
- All column lists come from the generated metadata
  (allocation.generated.types.ENTITIES) — entity shapes are never hand-written.
- Rows are schema-validated on insert (V-R2 enums + types; FK resolution V-R1
  is engine-enforced at run time, not by SQLite).
- Decimal/Percent values are stored as exact decimal strings (TEXT), never
  floats. Booleans are stored as 0/1 and decoded back to bool.
- Writes serialize under the shared state LOCK, like every state module.

``allocation_runs`` (SPEC §3.2) is the one mutable table here: a run is
inserted as 'running' and may transition exactly once to 'succeeded' or
'failed' (set_run_status). Nothing else on a run row ever changes.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from allocation import validation
from allocation.generated import types as gen
from state.engine import LOCK, get_conn

_RUN_TYPES = ("budget", "actual", "trueup")
_RUN_STATUSES = ("running", "succeeded", "failed")
# The only legal transitions: running -> succeeded | failed.
_RUN_TRANSITIONS = {"running": {"succeeded", "failed"}}

ENGINE_VERSION = "0.1.0"  # bumped per milestone; persisted on every run


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- ledgers --


def _bool_fields(sheet: str) -> tuple[str, ...]:
    ent = gen.ENTITIES[sheet]
    return tuple(n for n, m in ent["fields"].items() if m["type"] == "Boolean")


def _encode(value: Any) -> Any:
    return int(value) if isinstance(value, bool) else value


def _decode_row(sheet: str, row: Any) -> dict[str, Any]:
    d = {k: row[k] for k in row.keys()}
    for name in _bool_fields(sheet):
        if d.get(name) is not None:
            d[name] = bool(d[name])
    return d


def _insert_rows(sheet: str, rows: list[dict[str, Any]], extra: dict[str, Any] | None = None) -> int:
    """Append rows to a ledger table. Validates shape first; never updates."""
    errors = validation.validate_rows(sheet, rows)
    if errors:
        raise ValueError(f"invalid {sheet} rows: " + "; ".join(errors[:10]))
    ent = gen.ENTITIES[sheet]
    cols = list(ent["field_order"]) + list(extra or {})
    sql = (
        f"INSERT INTO {ent['table']} ({', '.join(cols)}) "
        f"VALUES ({', '.join('?' for _ in cols)})"
    )
    extras = tuple((extra or {}).values())
    params = [
        tuple(_encode(r.get(c)) for c in ent["field_order"]) + extras
        for r in rows
    ]
    with LOCK:
        conn = get_conn()
        conn.executemany(sql, params)
        conn.commit()
    return len(rows)


def _list_rows(sheet: str, filters: dict[str, Any]) -> list[dict[str, Any]]:
    ent = gen.ENTITIES[sheet]
    sql = f"SELECT * FROM {ent['table']}"
    clauses, params = [], []
    for col, val in filters.items():
        if val is not None:
            clauses.append(f"{col} = ?")
            params.append(val)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += f" ORDER BY {ent['primary_key']}"  # deterministic: ascending ID
    rows = get_conn().execute(sql, params).fetchall()
    return [_decode_row(sheet, r) for r in rows]


def _get_row(sheet: str, pk_value: str) -> dict[str, Any] | None:
    ent = gen.ENTITIES[sheet]
    row = get_conn().execute(
        f"SELECT * FROM {ent['table']} WHERE {ent['primary_key']} = ?", (pk_value,)
    ).fetchone()
    return _decode_row(sheet, row) if row else None


# 1_CostLine -> cost_lines
def insert_cost_lines(rows: list[dict[str, Any]]) -> int:
    return _insert_rows("1_CostLine", rows)


def list_cost_lines(
    provider_entity_id: str | None = None,
    fiscal_period: str | None = None,
    pool_id: str | None = None,
) -> list[dict[str, Any]]:
    return _list_rows(
        "1_CostLine",
        {"provider_entity_id": provider_entity_id, "fiscal_period": fiscal_period, "pool_id": pool_id},
    )


def get_cost_line(cost_line_id: str) -> dict[str, Any] | None:
    return _get_row("1_CostLine", cost_line_id)


# 7_KeyValue -> key_values
def insert_key_values(rows: list[dict[str, Any]]) -> int:
    return _insert_rows("7_KeyValue", rows)


def list_key_values(
    pool_id: str | None = None,
    period: str | None = None,
    recipient_entity_id: str | None = None,
) -> list[dict[str, Any]]:
    return _list_rows(
        "7_KeyValue",
        {"pool_id": pool_id, "period": period, "recipient_entity_id": recipient_entity_id},
    )


def get_key_value(key_value_id: str) -> dict[str, Any] | None:
    return _get_row("7_KeyValue", key_value_id)


# 10_ChargeLedger -> charge_ledger (+ run_id, SPEC §3.2)
def insert_charges(rows: list[dict[str, Any]], run_id: str | None = None) -> int:
    return _insert_rows("10_ChargeLedger", rows, extra={"run_id": run_id})


def list_charges(
    run_id: str | None = None,
    pool_id: str | None = None,
    period: str | None = None,
    recipient_entity_id: str | None = None,
) -> list[dict[str, Any]]:
    return _list_rows(
        "10_ChargeLedger",
        {"run_id": run_id, "pool_id": pool_id, "period": period,
         "recipient_entity_id": recipient_entity_id},
    )


def get_charge(charge_id: str) -> dict[str, Any] | None:
    return _get_row("10_ChargeLedger", charge_id)


# 11_Recon -> recon (run_id is a schema field here)
def insert_recon(rows: list[dict[str, Any]]) -> int:
    return _insert_rows("11_Recon", rows)


def list_recon(run_id: str | None = None, pool_id: str | None = None) -> list[dict[str, Any]]:
    return _list_rows("11_Recon", {"run_id": run_id, "pool_id": pool_id})


def get_recon(recon_id: str) -> dict[str, Any] | None:
    return _get_row("11_Recon", recon_id)


# ---------------------------------------------------------- allocation_runs --


def _run_to_dict(row: Any) -> dict[str, Any]:
    d = {k: row[k] for k in row.keys()}
    d["scope"] = json.loads(d.pop("scope_json")) if d.get("scope_json") else None
    d["config"] = json.loads(d.pop("config_json")) if d.get("config_json") else None
    return d


def insert_run(
    *,
    run_id: str,
    period: str,
    run_type: str,
    input_snapshot_hash: str,
    scope: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
    engine_version: str = ENGINE_VERSION,
    schema_version: str | None = None,
    started_at: str | None = None,
) -> dict[str, Any]:
    """Record a run start (status 'running') with its input snapshot hash."""
    if run_type not in _RUN_TYPES:
        raise ValueError(f"invalid run_type: {run_type}")
    with LOCK:
        conn = get_conn()
        conn.execute(
            "INSERT INTO allocation_runs (run_id, period, run_type, scope_json, config_json, "
            "engine_version, schema_version, input_snapshot_hash, started_at, finished_at, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'running')",
            (
                run_id,
                period,
                run_type,
                json.dumps(scope) if scope is not None else None,
                json.dumps(config) if config is not None else None,
                engine_version,
                schema_version or gen.SCHEMA_SHA256[:12],
                input_snapshot_hash,
                started_at or _now(),
            ),
        )
        conn.commit()
    return get_run(run_id)  # type: ignore[return-value]


def set_run_status(run_id: str, status: str) -> dict[str, Any]:
    """Transition a run: running -> succeeded | failed (sets finished_at)."""
    if status not in _RUN_STATUSES:
        raise ValueError(f"invalid run status: {status}")
    with LOCK:
        conn = get_conn()
        before = get_run(run_id)
        if before is None:
            raise ValueError(f"unknown run: {run_id}")
        if status not in _RUN_TRANSITIONS.get(before["status"], set()):
            raise ValueError(f"illegal run transition: {before['status']} -> {status}")
        conn.execute(
            "UPDATE allocation_runs SET status = ?, finished_at = ? WHERE run_id = ?",
            (status, _now(), run_id),
        )
        conn.commit()
    return get_run(run_id)  # type: ignore[return-value]


def get_run(run_id: str) -> dict[str, Any] | None:
    row = get_conn().execute(
        "SELECT * FROM allocation_runs WHERE run_id = ?", (run_id,)
    ).fetchone()
    return _run_to_dict(row) if row else None


def list_runs(period: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
    sql = "SELECT * FROM allocation_runs"
    clauses, params = [], []
    if period is not None:
        clauses.append("period = ?")
        params.append(period)
    if status is not None:
        clauses.append("status = ?")
        params.append(status)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY started_at, run_id"
    return [_run_to_dict(r) for r in get_conn().execute(sql, params).fetchall()]
