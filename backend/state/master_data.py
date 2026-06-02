"""Master data — read-only definitional seeds (functions, transaction types,
entity-function assignments, covered transactions), the policy/calculation
resolution, and the SQLite-backed editable overlay + inbound staging.

Read seeds are cached like the process catalog; mutable state follows the
state/engine + audit pattern used across the platform.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import state.audit as audit
from state import seeds
from state.engine import LOCK, get_conn

_DIR = Path(__file__).parent.parent / "seeds" / "master_data"


@lru_cache(maxsize=None)
def _doc(name: str) -> dict[str, Any]:
    return json.loads((_DIR / name).read_text(encoding="utf-8"))


def functions() -> list[dict[str, Any]]:
    return _doc("tp_functions.v1.json")["functions"]


def function_label(code: str) -> str:
    for f in functions():
        if f["code"] == code:
            return f["label"]
    return code


def transaction_types() -> list[dict[str, Any]]:
    return _doc("transaction_types.v1.json")["transaction_types"]


@lru_cache(maxsize=1)
def _benchmark_index() -> dict[str, dict[str, Any]]:
    return {s["set_id"]: s for s in seeds.load("benchmarks")["sets"]}


def resolve(characterising_function: str, category: str) -> dict[str, Any] | None:
    """(function, transaction category) -> the covered transaction type with its
    method, PLI, benchmark set and arm's-length range. Returns None if no type
    matches — this is what makes master data drive the calculation."""
    for t in transaction_types():
        if t["characterising_function"] == characterising_function and t["category"] == category:
            bm = _benchmark_index().get(t["benchmark_set_id"], {})
            return {
                **t,
                "lower": bm.get("lower"),
                "median": bm.get("median"),
                "upper": bm.get("upper"),
                "unit": bm.get("unit"),
            }
    return None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- entity-function overlay ----------

def list_entity_functions(rbukrs: str | None = None) -> list[dict[str, Any]]:
    sql = "SELECT * FROM md_entity_function WHERE status='active'"
    params: list[Any] = []
    if rbukrs is not None:
        sql += " AND rbukrs = ?"
        params.append(rbukrs)
    sql += " ORDER BY rbukrs, is_primary DESC, id"
    rows = get_conn().execute(sql, params).fetchall()
    out = []
    for r in rows:
        d = {k: r[k] for k in r.keys()}
        d["applies_to"] = json.loads(d["applies_to"]) if d["applies_to"] else []
        d["is_primary"] = bool(d["is_primary"])
        d["tested_party"] = bool(d["tested_party"])
        out.append(d)
    return out


def add_entity_function(
    *, rbukrs: str, tp_function_code: str, tested_party: bool = False,
    applies_to: list[str] | None = None, is_primary: bool = False, actor: str = "system",
) -> dict[str, Any]:
    with LOCK:
        conn = get_conn()
        conn.execute(
            "INSERT INTO md_entity_function (rbukrs, tp_function_code, is_primary, tested_party, applies_to, status, created_at) "
            "VALUES (?, ?, ?, ?, ?, 'active', ?)",
            (rbukrs, tp_function_code, int(is_primary), int(tested_party),
             json.dumps(applies_to or []), _now()),
        )
        conn.commit()
        audit.record(
            actor=actor, actor_kind="human", process_id="MASTER-DATA",
            record_ref=f"mdent:{rbukrs}", event_type="created",
            after={"rbukrs": rbukrs, "tp_function_code": tp_function_code},
        )
    return {"rbukrs": rbukrs, "tp_function_code": tp_function_code}


# ---------- covered-transaction overlay ----------

def get_overlay(ctx_id: str) -> dict[str, Any] | None:
    r = get_conn().execute("SELECT * FROM md_overlay WHERE ctx_id = ?", (ctx_id,)).fetchone()
    return {k: r[k] for k in r.keys()} if r else None


def set_overlay(ctx_id: str, patch: dict[str, Any], *, actor: str) -> dict[str, Any]:
    fields = ("policy_ref", "ica_ref", "apa_ref", "target_override", "notes")
    with LOCK:
        conn = get_conn()
        before = get_overlay(ctx_id)
        cur = dict(before) if before else {"ctx_id": ctx_id}
        for f in fields:
            if f in patch:
                cur[f] = patch[f]
        conn.execute(
            "INSERT INTO md_overlay (ctx_id, policy_ref, ica_ref, apa_ref, target_override, notes, updated_by, updated_at) "
            "VALUES (:ctx_id, :policy_ref, :ica_ref, :apa_ref, :target_override, :notes, :updated_by, :updated_at) "
            "ON CONFLICT(ctx_id) DO UPDATE SET policy_ref=excluded.policy_ref, ica_ref=excluded.ica_ref, "
            "apa_ref=excluded.apa_ref, target_override=excluded.target_override, notes=excluded.notes, "
            "updated_by=excluded.updated_by, updated_at=excluded.updated_at",
            {
                "ctx_id": ctx_id,
                "policy_ref": cur.get("policy_ref"), "ica_ref": cur.get("ica_ref"),
                "apa_ref": cur.get("apa_ref"), "target_override": cur.get("target_override"),
                "notes": cur.get("notes"), "updated_by": actor, "updated_at": _now(),
            },
        )
        conn.commit()
        audit.record(
            actor=actor, actor_kind="human", process_id="MASTER-DATA",
            record_ref=f"mdctx:{ctx_id}", event_type="edited",
            before=before, after=patch,
        )
    return get_overlay(ctx_id)


# ---------- inbound staging ----------

def list_staging(status: str | None = None) -> list[dict[str, Any]]:
    sql = "SELECT * FROM md_staging"
    params: list[Any] = []
    if status:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY created_at, id"
    rows = get_conn().execute(sql, params).fetchall()
    out = []
    for r in rows:
        d = {k: r[k] for k in r.keys()}
        d["raw"] = json.loads(d.pop("raw_json"))
        d["proposed"] = json.loads(d["proposed_json"]) if d["proposed_json"] else None
        d.pop("proposed_json", None)
        out.append(d)
    return out


def get_staging(item_id: str) -> dict[str, Any] | None:
    r = get_conn().execute("SELECT * FROM md_staging WHERE id = ?", (item_id,)).fetchone()
    if r is None:
        return None
    d = {k: r[k] for k in r.keys()}
    d["raw"] = json.loads(d.pop("raw_json"))
    d["proposed"] = json.loads(d["proposed_json"]) if d["proposed_json"] else None
    d.pop("proposed_json", None)
    return d


def _insert_staging(conn: Any, item: dict[str, Any]) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO md_staging (id, kind, raw_json, status, created_at) VALUES (?, ?, ?, 'unmapped', ?)",
        (item["id"], item["kind"], json.dumps(item["raw"]), _now()),
    )


def add_staging_batch(items: list[dict[str, Any]]) -> int:
    with LOCK:
        conn = get_conn()
        for it in items:
            _insert_staging(conn, it)
        conn.commit()
    return len(items)


def set_proposal(item_id: str, proposal: dict[str, Any]) -> None:
    proposed = proposal.get("proposed")
    with LOCK:
        conn = get_conn()
        conn.execute(
            "UPDATE md_staging SET proposed_json=?, confidence=?, rationale=?, status='proposed', updated_at=? WHERE id=?",
            (json.dumps(proposed) if proposed is not None else None,
             proposal.get("confidence"), proposal.get("rationale"), _now(), item_id),
        )
        conn.commit()


def mark_status(item_id: str, status: str, maker: str | None = None) -> None:
    with LOCK:
        conn = get_conn()
        conn.execute(
            "UPDATE md_staging SET status=?, maker=COALESCE(?, maker), updated_at=? WHERE id=?",
            (status, maker, _now(), item_id),
        )
        conn.commit()


def apply_mapping(item_id: str, *, applied_by: str) -> dict[str, Any]:
    """Persist the approved mapping to the master and the mapping ledger; audit it."""
    with LOCK:
        conn = get_conn()
        item = get_staging(item_id)
        if item is None:
            raise ValueError(f"no staging item {item_id}")
        proposed = item.get("proposed") or {}
        raw_key = json.dumps(item["raw"], sort_keys=True)
        conn.execute(
            "INSERT INTO md_mapping (kind, raw_key, canonical_json, applied_by, applied_at) VALUES (?, ?, ?, ?, ?)",
            (item["kind"], raw_key, json.dumps(proposed), applied_by, _now()),
        )
        if item["kind"] == "entity" and proposed.get("tp_function_code"):
            conn.execute(
                "INSERT INTO md_entity_function (rbukrs, tp_function_code, is_primary, tested_party, applies_to, status, created_at) "
                "VALUES (?, ?, 1, ?, ?, 'active', ?)",
                (item["raw"]["rbukrs"], proposed["tp_function_code"],
                 int(bool(proposed.get("tested_party"))),
                 json.dumps(proposed.get("applies_to") or []), _now()),
            )
        conn.execute("UPDATE md_staging SET status='applied', updated_at=? WHERE id=?", (_now(), item_id))
        conn.commit()
        audit.record(
            actor=applied_by, actor_kind="human", process_id="MASTER-DATA",
            record_ref=f"mdmap:{item_id}", event_type="posted", after=proposed,
        )
    return {"id": item_id, "status": "applied"}


def onboarded_entities() -> list[dict[str, Any]]:
    """Identity rows for entities onboarded via approved mappings (kind='entity')."""
    rows = get_conn().execute("SELECT canonical_json, raw_key FROM md_mapping WHERE kind='entity'").fetchall()
    out = []
    for r in rows:
        raw = json.loads(r["raw_key"])
        out.append({
            "rbukrs": raw.get("rbukrs"),
            "display_name": raw.get("name"),
            "country": raw.get("country_hint"),
            "functional_currency": raw.get("currency"),
        })
    return out


# ---------- seeding ----------

def seed_if_empty() -> None:
    """Populate the overlay + staging from seeds on first run (idempotent)."""
    with LOCK:
        conn = get_conn()
        if conn.execute("SELECT count(*) AS n FROM md_entity_function").fetchone()["n"] == 0:
            for a in _doc("entity_functions.v1.json")["assignments"]:
                conn.execute(
                    "INSERT INTO md_entity_function (rbukrs, tp_function_code, is_primary, tested_party, applies_to, status, created_at) "
                    "VALUES (?, ?, ?, ?, ?, 'active', ?)",
                    (a["rbukrs"], a["tp_function_code"], int(a.get("is_primary", False)),
                     int(a.get("tested_party", False)), json.dumps(a.get("applies_to", [])), _now()),
                )
        if conn.execute("SELECT count(*) AS n FROM md_overlay").fetchone()["n"] == 0:
            for c in _doc("covered_transactions.v1.json")["covered_transactions"]:
                conn.execute(
                    "INSERT OR IGNORE INTO md_overlay (ctx_id, policy_ref, ica_ref, apa_ref, updated_at) VALUES (?, ?, ?, ?, ?)",
                    (c["ctx_id"], c.get("policy_ref"), c.get("ica_ref"), c.get("apa_ref"), _now()),
                )
        if conn.execute("SELECT count(*) AS n FROM md_staging").fetchone()["n"] == 0:
            for it in _doc("inbound/sap_delta.v1.json")["items"]:
                _insert_staging(conn, it)
        conn.commit()
