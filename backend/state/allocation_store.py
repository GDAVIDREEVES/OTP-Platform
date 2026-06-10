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

M6 adds the run ARTIFACTS (``allocation_run_artifacts`` — doc pack, exception
report, posting files, lineage index, output hash; DECISIONS.md M6) and the
ATOMIC persistence path: ``persist_run_success`` writes a run's charges,
recon rows and artifacts and flips the status in ONE transaction — a failure
anywhere rolls everything back (SPEC §4 "persists outputs atomically,
all-or-nothing per run").
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

ENGINE_VERSION = "0.2.0"  # bumped per milestone; persisted on every run (M6)


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


def _insert_sql(
    sheet: str, rows: list[dict[str, Any]], extra: dict[str, Any] | None = None
) -> tuple[str, list[tuple]]:
    """Validated (sql, params) for an append to a ledger table — shared by
    the per-call inserts and the atomic run persistence."""
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
    return sql, params


def _insert_rows(sheet: str, rows: list[dict[str, Any]], extra: dict[str, Any] | None = None) -> int:
    """Append rows to a ledger table. Validates shape first; never updates."""
    sql, params = _insert_sql(sheet, rows, extra)
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


def new_run_id(period: str, run_type: str) -> str:
    """Deterministic-given-state run id: ``RUN-{seq:04d}-{run_type}-{period}``
    (seq = 1 + total runs ever inserted; zero-padded so lexical order is
    insertion order — the 'latest run per period' selection relies on it)."""
    with LOCK:
        n = get_conn().execute("SELECT COUNT(*) FROM allocation_runs").fetchone()[0]
    return f"RUN-{int(n) + 1:04d}-{run_type}-{period}"


# ------------------------------------------------------------- run artifacts --


def insert_artifacts(run_id: str, artifacts: list[dict[str, Any]]) -> int:
    """Persist run artifacts (doc pack, exception report, posting files, ...).
    Append-only like everything run-scoped: (run_id, name) is the PK."""
    now = _now()
    with LOCK:
        conn = get_conn()
        conn.executemany(
            "INSERT INTO allocation_run_artifacts "
            "(run_id, name, content_type, content, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            [(run_id, a["name"], a["content_type"], a["content"], now)
             for a in artifacts],
        )
        conn.commit()
    return len(artifacts)


def list_artifacts(run_id: str) -> list[dict[str, Any]]:
    rows = get_conn().execute(
        "SELECT name, content_type, LENGTH(content) AS size, created_at "
        "FROM allocation_run_artifacts WHERE run_id = ? ORDER BY name",
        (run_id,),
    ).fetchall()
    return [{k: r[k] for k in r.keys()} for r in rows]


def get_artifact(run_id: str, name: str) -> dict[str, Any] | None:
    row = get_conn().execute(
        "SELECT name, content_type, content, created_at "
        "FROM allocation_run_artifacts WHERE run_id = ? AND name = ?",
        (run_id, name),
    ).fetchone()
    return {k: row[k] for k in row.keys()} if row else None


# ----------------------------------------------------- atomic run persistence --


def persist_run_success(
    run_id: str,
    *,
    charges: list[dict[str, Any]],
    recon_rows: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    """Persist a succeeded run ATOMICALLY (SPEC §4 "all-or-nothing per run"):
    charge ledger rows (+run_id column), recon rows, artifacts and the
    running -> succeeded transition commit together or not at all."""
    charges_sql = _insert_sql("10_ChargeLedger", charges,
                              extra={"run_id": run_id}) if charges else None
    recon_sql = _insert_sql("11_Recon", recon_rows) if recon_rows else None
    now = _now()
    with LOCK:
        conn = get_conn()
        before = get_run(run_id)
        if before is None:
            raise ValueError(f"unknown run: {run_id}")
        if before["status"] != "running":
            raise ValueError(
                f"illegal run transition: {before['status']} -> succeeded")
        try:
            if charges_sql:
                conn.executemany(*charges_sql)
            if recon_sql:
                conn.executemany(*recon_sql)
            conn.executemany(
                "INSERT INTO allocation_run_artifacts "
                "(run_id, name, content_type, content, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                [(run_id, a["name"], a["content_type"], a["content"], now)
                 for a in artifacts],
            )
            conn.execute(
                "UPDATE allocation_runs SET status = 'succeeded', "
                "finished_at = ? WHERE run_id = ?",
                (now, run_id),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return get_run(run_id)  # type: ignore[return-value]


def persist_run_failure(
    run_id: str, *, artifacts: list[dict[str, Any]]
) -> dict[str, Any]:
    """Fail a run atomically: NO ledger rows are written — only the exception
    artifacts and the running -> failed transition (SPEC §4 all-or-nothing;
    BLOCK exceptions withhold every output)."""
    now = _now()
    with LOCK:
        conn = get_conn()
        before = get_run(run_id)
        if before is None:
            raise ValueError(f"unknown run: {run_id}")
        if before["status"] != "running":
            raise ValueError(
                f"illegal run transition: {before['status']} -> failed")
        try:
            conn.executemany(
                "INSERT INTO allocation_run_artifacts "
                "(run_id, name, content_type, content, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                [(run_id, a["name"], a["content_type"], a["content"], now)
                 for a in artifacts],
            )
            conn.execute(
                "UPDATE allocation_runs SET status = 'failed', "
                "finished_at = ? WHERE run_id = ?",
                (now, run_id),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return get_run(run_id)  # type: ignore[return-value]


# ------------------------------------------------------ booked budget reader --


def latest_booked_budget_rows(fiscal_year: str) -> list[dict[str, Any]]:
    """The booked Budget charges for a year: rows of the LATEST succeeded
    budget run per period (earlier same-period budget runs are superseded —
    the ledger stays append-only; recency is by run sequence, DECISIONS.md
    M6). Ordered by charge_id (ascending-ID determinism)."""
    runs = get_conn().execute(
        "SELECT run_id, period FROM allocation_runs "
        "WHERE run_type = 'budget' AND status = 'succeeded' "
        "ORDER BY run_id",
    ).fetchall()
    latest_by_period: dict[str, str] = {}
    for r in runs:
        latest_by_period[r["period"]] = r["run_id"]  # last (highest seq) wins
    if not latest_by_period:
        return []
    run_ids = sorted(latest_by_period.values())
    placeholders = ", ".join("?" for _ in run_ids)
    rows = get_conn().execute(
        f"SELECT * FROM charge_ledger WHERE run_id IN ({placeholders}) "
        "AND fiscal_year = ? AND budget_or_actual = 'Budget' "
        "ORDER BY charge_id",
        (*run_ids, fiscal_year),
    ).fetchall()
    return [_decode_row("10_ChargeLedger", r) for r in rows]
