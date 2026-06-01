"""Editable application state — submitted adjustments, policy overrides, and
app settings.

Storage moved from a single JSON file to SQLite (state/), but the public API
is unchanged so the routers don't notice. Every mutation also writes an event
to the append-only audit stream, so the trail is a by-product of the work.

Records keep their flexible shape as JSON in the `data` column; the hot
`status`/timestamp columns are promoted for querying and ordering.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import state.audit as audit
from state.engine import LOCK, get_conn

STORE_DIR = Path(__file__).parent
STORE_PATH = STORE_DIR / "overrides.json"  # legacy file — import source only

_DEFAULT_SETTINGS: dict[str, Any] = {
    "companyName": "Aperture Tax",
    "defaultCurrency": "USD",
    "defaultReviewer": "Sam Rodriguez",
    "notifyOnDeviation": True,
}

VALID_STATUSES = {"Pending Approval", "Approved", "Rejected", "Exported", "Reversed"}
_STATUS_EVENT = {
    "Approved": "approved",
    "Rejected": "rejected",
    "Exported": "exported",
    "Reversed": "reversed",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ref(adj_id: str) -> str:
    return f"adj:{adj_id}"


def _new_id() -> str:
    return f"ADJ-{uuid4().hex[:8].upper()}"


# ----------------- adjustments -----------------

def list_adjustments() -> list[dict[str, Any]]:
    rows = get_conn().execute("SELECT data FROM adjustments ORDER BY rowid").fetchall()
    return [json.loads(r["data"]) for r in rows]


def _get(conn: Any, adj_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT data FROM adjustments WHERE id = ?", (adj_id,)).fetchone()
    return json.loads(row["data"]) if row else None


def _persist(conn: Any, record: dict[str, Any]) -> None:
    conn.execute(
        "UPDATE adjustments SET data = ?, status = ?, updated_at = ? WHERE id = ?",
        (json.dumps(record, default=str), record.get("status"), record.get("updatedAt"), record["id"]),
    )


def _insert(conn: Any, record: dict[str, Any]) -> None:
    conn.execute(
        "INSERT INTO adjustments (id, data, status, created_at, updated_at) VALUES (?, ?, ?, ?, NULL)",
        (record["id"], json.dumps(record, default=str), record["status"], record["submittedAt"]),
    )


def submit_adjustment(payload: dict[str, Any]) -> dict[str, Any]:
    with LOCK:
        conn = get_conn()
        record = {"id": _new_id(), "submittedAt": _now(), "status": "Pending Approval", **payload}
        _insert(conn, record)
        conn.commit()
        audit.record(
            actor=payload.get("submittedBy", "system"), actor_kind="human",
            record_ref=_ref(record["id"]), event_type="submitted",
            after=record, rationale=payload.get("notes"),
        )
    return record


def update_adjustment(adj_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    new_status = fields.get("status")
    if new_status is not None and new_status not in VALID_STATUSES:
        raise ValueError(f"Invalid status {new_status!r}; expected one of {sorted(VALID_STATUSES)}")
    with LOCK:
        conn = get_conn()
        record = _get(conn, adj_id)
        if record is None:
            return None
        before = dict(record)
        for k in ("status", "approvedBy", "exportedRef", "rejectionReason", "notes"):
            if k in fields:
                record[k] = fields[k]
        record["updatedAt"] = _now()
        if "by" in fields:
            record["updatedBy"] = fields["by"]
        _persist(conn, record)
        conn.commit()
        audit.record(
            actor=fields.get("by") or fields.get("approvedBy") or "system", actor_kind="human",
            record_ref=_ref(adj_id), event_type=_STATUS_EVENT.get(new_status, "edited"),
            before=before, after=record,
            rationale=fields.get("rejectionReason") or fields.get("notes"),
        )
    return dict(record)


def delete_adjustment(adj_id: str) -> bool:
    """Hard-delete, allowed only while still 'Pending Approval'."""
    with LOCK:
        conn = get_conn()
        record = _get(conn, adj_id)
        if record is None or record.get("status") != "Pending Approval":
            return False
        conn.execute("DELETE FROM adjustments WHERE id = ?", (adj_id,))
        conn.commit()
        audit.record(
            actor=record.get("submittedBy", "system"), actor_kind="human",
            record_ref=_ref(adj_id), event_type="deleted", before=record,
        )
    return True


def reverse_adjustment(adj_id: str, by: str | None = None) -> dict[str, Any] | None:
    """Create an opposite-sign counter-adjustment; mark the original Reversed."""
    with LOCK:
        conn = get_conn()
        original = _get(conn, adj_id)
        if original is None or original.get("status") == "Reversed":
            return None
        counter = {
            "id": _new_id(),
            "submittedAt": _now(),
            "status": "Pending Approval",
            "entityId": original.get("entityId"),
            "entityName": original.get("entityName"),
            "amount": -float(original.get("amount", 0)),
            "currency": original.get("currency", "USD"),
            "mode": original.get("mode", "median"),
            "targetMargin": original.get("targetMargin"),
            "actualMargin": original.get("actualMargin"),
            "notes": f"Reversal of {original['id']}",
            "submittedBy": by or "Reverse",
            "reversesId": original["id"],
        }
        original["status"] = "Reversed"
        original["reversedById"] = counter["id"]
        original["reversedAt"] = counter["submittedAt"]
        original["updatedAt"] = counter["submittedAt"]
        if by:
            original["reversedBy"] = by
        _persist(conn, original)
        _insert(conn, counter)
        conn.commit()
        audit.record(actor=by or "system", actor_kind="human", record_ref=_ref(adj_id),
                     event_type="reversed", after=original)
        audit.record(actor=by or "system", actor_kind="human", record_ref=_ref(counter["id"]),
                     event_type="submitted", after=counter)
    return counter


# ----------------- policy overrides -----------------

def list_policy_overrides() -> dict[str, dict[str, Any]]:
    rows = get_conn().execute("SELECT flow_id, data FROM policy_overrides").fetchall()
    return {r["flow_id"]: json.loads(r["data"]) for r in rows}


def upsert_policy_override(flow_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    with LOCK:
        conn = get_conn()
        record = {**payload, "flowId": flow_id, "updatedAt": _now()}
        conn.execute(
            "INSERT INTO policy_overrides (flow_id, data, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(flow_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            (flow_id, json.dumps(record, default=str), record["updatedAt"]),
        )
        conn.commit()
        audit.record(
            actor=payload.get("updatedBy", "system"), actor_kind="human",
            record_ref=f"flow:{flow_id}", event_type="edited", after=record,
            rationale=payload.get("notes"),
        )
    return record


# ----------------- settings -----------------

def get_settings() -> dict[str, Any]:
    row = get_conn().execute("SELECT v FROM app_settings WHERE k = 'settings'").fetchone()
    stored = json.loads(row["v"]) if row else {}
    return {**_DEFAULT_SETTINGS, **stored}


def update_settings(payload: dict[str, Any]) -> dict[str, Any]:
    with LOCK:
        conn = get_conn()
        merged = {**_DEFAULT_SETTINGS, **get_settings(), **payload}
        conn.execute(
            "INSERT INTO app_settings (k, v) VALUES ('settings', ?) "
            "ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            (json.dumps(merged, default=str),),
        )
        conn.commit()
    return merged


# ----------------- one-time legacy import -----------------

def import_legacy_json(json_path: Path | str | None = None) -> int:
    """Load records from the old overrides.json into SQLite, once.

    Idempotent: adjustments import only when the table is empty; a genesis
    'created' audit event is backfilled per migrated adjustment so the chain
    starts clean. Returns the number of adjustments imported.
    """
    path = Path(json_path) if json_path else STORE_PATH
    if not path.exists():
        return 0
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return 0

    with LOCK:
        conn = get_conn()
        already = conn.execute("SELECT COUNT(*) AS n FROM adjustments").fetchone()["n"]
        to_import = data.get("adjustments", []) if already == 0 else []
        for adj in to_import:
            _insert_or_ignore_adj(conn, adj)
        for flow_id, ov in data.get("policy_overrides", {}).items():
            conn.execute(
                "INSERT OR IGNORE INTO policy_overrides (flow_id, data, updated_at) VALUES (?, ?, ?)",
                (flow_id, json.dumps(ov, default=str), ov.get("updatedAt", _now())),
            )
        if "settings" in data:
            conn.execute(
                "INSERT OR REPLACE INTO app_settings (k, v) VALUES ('settings', ?)",
                (json.dumps(data["settings"], default=str),),
            )
        conn.commit()
        for adj in to_import:
            audit.record(
                actor=adj.get("submittedBy", "migration"), actor_kind="human",
                record_ref=_ref(adj["id"]), event_type="created", after=adj,
                rationale="migrated from legacy JSON store",
            )
    return len(to_import)


def _insert_or_ignore_adj(conn: Any, adj: dict[str, Any]) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO adjustments (id, data, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (adj["id"], json.dumps(adj, default=str), adj.get("status", "Pending Approval"),
         adj.get("submittedAt", _now()), adj.get("updatedAt")),
    )
