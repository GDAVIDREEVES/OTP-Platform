"""P&L overlay ledger + waterfall run table (Phase 5 W1 — Author & Apply).

The overlay ledger holds the APPLIED intercompany charges as double-entry
P&L lines: for every charge the provider books a ``revenue``+ line and the
recipient a ``cost``+ line of the same amount, so the group nets to zero by
construction (test-enforced in tests/test_waterfall.py). The ledger is
APPEND-ONLY — corrections and rollbacks are reversing rows (negated amount,
``reverses_id`` -> the original line), never UPDATEs — exactly the discipline
of the allocation ledgers (state/allocation_store.py).

Amounts are exact decimal strings (TEXT), never floats. Every append is
hash-chained into the audit trail at record_ref="overlay:{id}" — the same
lock+audit discipline used in state/cases.py — so each line's Audit tab and
/evidence/:ref packet light up with no extra wiring.

``waterfall_runs`` records each orchestrator launch (services/
waterfall_runner.py) with its per-step summary. A run is inserted 'running'
and transitions exactly once to 'applied' or 'failed'; an 'applied' run may
later transition to 'rolled_back' (explicit rollback) or 'superseded'
(replaced by a newer applied run) — so AT MOST ONE run is applied at a time.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import state.audit as audit
from state.engine import LOCK, get_conn

#: The waterfall's home process — segmented financials (the P&L the overlay
#: adjusts). Used as process_id on every overlay/waterfall audit event.
PROCESS_ID = "OTP-21"

LINE_KINDS = ("service_charge", "royalty", "csa_true_up", "profit_split", "other")
SIDES = ("revenue", "cost")

RUN_STATUSES = ("running", "applied", "failed", "rolled_back", "superseded")
# The only legal transitions; everything else raises.
_RUN_TRANSITIONS = {
    "running": {"applied", "failed"},
    "applied": {"rolled_back", "superseded"},
}

_LINE_COLS = ("waterfall_run_id", "step", "entity", "function", "period",
              "line_kind", "side", "amount", "source_ref", "reverses_id",
              "created_at")
_INSERT_LINE = (
    f"INSERT INTO pl_overlays ({', '.join(_LINE_COLS)}) "
    f"VALUES ({', '.join('?' for _ in _LINE_COLS)})"
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_dict(row: Any) -> dict[str, Any]:
    return {k: row[k] for k in row.keys()}


# ------------------------------------------------------------ overlay lines --


def _validated_amount(line: dict[str, Any]) -> Decimal:
    """Validate one overlay line; returns its amount as a Decimal.

    No silent defaults: every field the P&L aggregation depends on must be
    present and well-formed, and a regular append must be strictly positive —
    negative rows exist ONLY as reversing rows written by reverse_run_lines().
    """
    for field in ("entity", "period", "line_kind", "side", "amount", "source_ref"):
        if line.get(field) in (None, ""):
            raise ValueError(f"overlay line missing {field!r}: {line}")
    if line["line_kind"] not in LINE_KINDS:
        raise ValueError(f"invalid line_kind: {line['line_kind']!r}")
    if line["side"] not in SIDES:
        raise ValueError(f"invalid side: {line['side']!r}")
    try:
        amount = Decimal(str(line["amount"]))
    except InvalidOperation:
        raise ValueError(f"overlay amount is not a decimal: {line['amount']!r}")
    if amount <= 0:
        raise ValueError(
            "overlay amounts must be positive — corrections are reversing rows"
        )
    return amount


def get_line(line_id: int) -> dict[str, Any] | None:
    row = get_conn().execute(
        "SELECT * FROM pl_overlays WHERE id = ?", (line_id,)
    ).fetchone()
    return _to_dict(row) if row else None


def append_lines(
    lines: list[dict[str, Any]], *, waterfall_run_id: str, step: str, actor: str
) -> list[dict[str, Any]]:
    """Append validated double-entry lines for one waterfall step.

    All lines insert in ONE transaction; each is then hash-chained at
    record_ref="overlay:{id}" (event_type "posted"). Returns the stored rows.
    """
    if not lines:
        return []
    amounts = [_validated_amount(line) for line in lines]  # validate ALL first
    with LOCK:
        conn = get_conn()
        now = _now()
        ids: list[int] = []
        for line, amount in zip(lines, amounts):
            cur = conn.execute(_INSERT_LINE, (
                waterfall_run_id, step, line["entity"], line.get("function"),
                line["period"], line["line_kind"], line["side"], str(amount),
                line["source_ref"], None, now,
            ))
            ids.append(cur.lastrowid)
        conn.commit()
        records = []
        for line_id in ids:
            record = get_line(line_id)
            audit.record(
                actor=actor, actor_kind="human",
                process_id=PROCESS_ID, record_ref=f"overlay:{line_id}",
                event_type="posted", after=record,
            )
            records.append(record)
    return records


def reverse_run_lines(
    waterfall_run_id: str, *, actor: str, rationale: str
) -> list[dict[str, Any]]:
    """Append one reversing row per not-yet-reversed line of a run.

    A reversing row negates the original amount and points back at it via
    ``reverses_id`` (same entity/side/kind/period/source_ref), so the pair
    nets to zero and the ledger stays append-only. Each reversal is audited
    at record_ref="overlay:{new_id}" (event_type "reversed", before = the
    original line). Already-reversed lines are skipped, so calling this twice
    reverses nothing twice. Returns the reversing rows.
    """
    with LOCK:
        conn = get_conn()
        originals = [_to_dict(r) for r in conn.execute(
            "SELECT * FROM pl_overlays o WHERE waterfall_run_id = ? "
            "AND reverses_id IS NULL "
            "AND NOT EXISTS (SELECT 1 FROM pl_overlays r WHERE r.reverses_id = o.id) "
            "ORDER BY id",
            (waterfall_run_id,),
        ).fetchall()]
        now = _now()
        ids: list[int] = []
        for orig in originals:
            cur = conn.execute(_INSERT_LINE, (
                orig["waterfall_run_id"], orig["step"], orig["entity"],
                orig["function"], orig["period"], orig["line_kind"],
                orig["side"], str(-Decimal(orig["amount"])), orig["source_ref"],
                orig["id"], now,
            ))
            ids.append(cur.lastrowid)
        conn.commit()
        records = []
        for orig, line_id in zip(originals, ids):
            record = get_line(line_id)
            audit.record(
                actor=actor, actor_kind="human",
                process_id=PROCESS_ID, record_ref=f"overlay:{line_id}",
                event_type="reversed", before=orig, after=record,
                rationale=rationale,
            )
            records.append(record)
    return records


def list_lines(
    *,
    waterfall_run_id: str | None = None,
    entity: str | None = None,
    year: int | None = None,
) -> list[dict[str, Any]]:
    """Overlay lines (including reversing rows), oldest first.

    ``year`` matches both annual lines (period == 'YYYY') and monthly lines
    (period LIKE 'YYYY-%').
    """
    sql = "SELECT * FROM pl_overlays"
    clauses: list[str] = []
    params: list[Any] = []
    if waterfall_run_id is not None:
        clauses.append("waterfall_run_id = ?")
        params.append(waterfall_run_id)
    if entity is not None:
        clauses.append("entity = ?")
        params.append(entity)
    if year is not None:
        clauses.append("(period = ? OR period LIKE ?)")
        params.extend([str(year), f"{year}-%"])
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY id"
    return [_to_dict(r) for r in get_conn().execute(sql, params).fetchall()]


# ----------------------------------------------------------- waterfall runs --


def _run_to_dict(row: Any) -> dict[str, Any]:
    d = {k: row[k] for k in row.keys()}
    d["steps"] = json.loads(d.pop("steps_json")) if d.get("steps_json") else []
    return d


def insert_run(*, year: int, steps: list[str], actor: str) -> dict[str, Any]:
    """Record a waterfall launch (status 'running') with its step plan."""
    with LOCK:
        conn = get_conn()
        n = conn.execute("SELECT count(*) AS n FROM waterfall_runs").fetchone()["n"]
        run_id = f"WF-{n + 1}"
        conn.execute(
            "INSERT INTO waterfall_runs (id, year, actor, status, steps_json, started_at) "
            "VALUES (?, ?, ?, 'running', ?, ?)",
            (run_id, year, actor,
             json.dumps([{"id": s, "status": "pending"} for s in steps]), _now()),
        )
        conn.commit()
    return get_run(run_id)  # type: ignore[return-value]


def finish_run(
    run_id: str,
    *,
    status: str,
    steps: list[dict[str, Any]] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    """Transition a run: running -> applied | failed, persisting the per-step
    summaries (and the failure message, if any)."""
    with LOCK:
        conn = get_conn()
        before = get_run(run_id)
        if before is None:
            raise ValueError(f"unknown waterfall run: {run_id}")
        if status not in _RUN_TRANSITIONS.get(before["status"], set()):
            raise ValueError(
                f"illegal waterfall run transition: {before['status']} -> {status}")
        conn.execute(
            "UPDATE waterfall_runs SET status = ?, steps_json = ?, error = ?, "
            "finished_at = ? WHERE id = ?",
            (status, json.dumps(steps if steps is not None else before["steps"]),
             error, _now(), run_id),
        )
        conn.commit()
    return get_run(run_id)  # type: ignore[return-value]


def set_run_status(run_id: str, status: str) -> dict[str, Any]:
    """Transition an applied run: applied -> rolled_back | superseded."""
    if status not in RUN_STATUSES:
        raise ValueError(f"invalid waterfall run status: {status}")
    with LOCK:
        conn = get_conn()
        before = get_run(run_id)
        if before is None:
            raise ValueError(f"unknown waterfall run: {run_id}")
        if status not in _RUN_TRANSITIONS.get(before["status"], set()):
            raise ValueError(
                f"illegal waterfall run transition: {before['status']} -> {status}")
        conn.execute(
            "UPDATE waterfall_runs SET status = ? WHERE id = ?", (status, run_id))
        conn.commit()
    return get_run(run_id)  # type: ignore[return-value]


def get_run(run_id: str) -> dict[str, Any] | None:
    row = get_conn().execute(
        "SELECT * FROM waterfall_runs WHERE id = ?", (run_id,)
    ).fetchone()
    return _run_to_dict(row) if row else None


def list_runs(status: str | None = None) -> list[dict[str, Any]]:
    sql = "SELECT * FROM waterfall_runs"
    params: list[Any] = []
    if status is not None:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY started_at, id"
    return [_run_to_dict(r) for r in get_conn().execute(sql, params).fetchall()]
