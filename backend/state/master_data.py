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

from period_filter import PeriodFilter
from services.entities import list_entities

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


# ---------- composition helpers ----------

@lru_cache(maxsize=1)
def _entity_dim() -> dict[str, dict[str, Any]]:
    raw = json.loads((Path(__file__).parent.parent / "dim" / "entity_dim.json").read_text(encoding="utf-8"))
    return {e["rbukrs"]: e for e in raw["entities"]}


def _identity(rbukrs: str) -> dict[str, Any]:
    dim = _entity_dim().get(rbukrs)
    if dim:
        return {"rbukrs": rbukrs, "display_name": dim["display_name"], "country": dim.get("country"),
                "functional_currency": dim.get("functional_currency")}
    for e in onboarded_entities():
        if e["rbukrs"] == rbukrs:
            return e
    return {"rbukrs": rbukrs, "display_name": f"Entity {rbukrs}", "country": None, "functional_currency": None}


def entity_master() -> list[dict[str, Any]]:
    """entity × function grain: SAP identity (incl. onboarded) joined to functions,
    plus the transaction types the entity participates in (derived)."""
    part = entity_participation()
    out = []
    for ef in list_entity_functions():
        ident = _identity(ef["rbukrs"])
        out.append({
            **ident,
            "tp_function_code": ef["tp_function_code"],
            "tp_function_label": function_label(ef["tp_function_code"]),
            "is_primary": ef["is_primary"],
            "tested_party": ef["tested_party"],
            "applies_to": ef["applies_to"],
            "participates_in": part.get(ef["rbukrs"], []),
        })
    return out


@lru_cache(maxsize=1)
def _covered_seed() -> list[dict[str, Any]]:
    return _doc("covered_transactions.v1.json")["covered_transactions"]


def entity_participation() -> dict[str, list[str]]:
    """For each entity, the transaction-type labels it participates in (payer /
    payee / tested) across the covered transactions — the real 'participates in'."""
    tt_label = {t["txn_type_id"]: t["label"] for t in transaction_types()}
    by_rb: dict[str, set[str]] = {}
    for c in _covered_for_participation():
        label = tt_label.get(c["txn_type_id"], c["txn_type_id"])
        for key in ("payer_rbukrs", "payee_rbukrs", "tested_rbukrs"):
            rb = c.get(key)
            if rb:
                by_rb.setdefault(rb, set()).add(label)
    return {rb: sorted(labels) for rb, labels in by_rb.items()}


def _covered_for_participation() -> list[dict[str, Any]]:
    """Covered transactions feeding participation. (A later task extends this to
    include mapped-unplanned; for now it's the planned seed.)"""
    return _covered_seed()


def _entity_role(rbukrs: str) -> str:
    fns = list_entity_functions(rbukrs)
    primary = next((f for f in fns if f["is_primary"]), fns[0] if fns else None)
    return function_label(primary["tp_function_code"]) if primary else "—"


def _actual_margin(rbukrs: str) -> float | None:
    ents = list_entities(PeriodFilter(), entity_id=rbukrs)
    return ents[0]["actualMargin"] if ents else None


def type_with_range(txn_type_id: str) -> dict[str, Any] | None:
    """Exact transaction type merged with its benchmark range. The matrix uses
    THIS (it knows the specific type) — not resolve(), which maps a
    (function, category) to its DEFAULT type by first match (e.g. IPOWN+Royalties
    -> ROY-API). Two royalty sub-types share that key, so resolve() must not be
    used for the matrix range."""
    bm_index = _benchmark_index()
    for t in transaction_types():
        if t["txn_type_id"] == txn_type_id:
            bm = bm_index.get(t["benchmark_set_id"], {})
            return {**t, "lower": bm.get("lower"), "median": bm.get("median"),
                    "upper": bm.get("upper"), "unit": bm.get("unit")}
    return None


# A small pool of extra deltas the "Simulate SAP delta" button cycles through.
# Deterministic (pick the next not-yet-present item) — no Math.random/Date needed.
_SIM_POOL = [
    {"id": "SAP-3600", "kind": "entity", "raw": {"rbukrs": "3600", "name": "Brazil Distribution Co.", "currency": "BRL", "country_hint": "Brazil"}},
    {"id": "SAP-418000", "kind": "account", "raw": {"account": "418000", "text": "Interest expense - intercompany loan"}},
    {"id": "SAP-MFG2", "kind": "transaction", "raw": {"label": "Contract manufacturing - sterile fill", "payer_rbukrs": "3100", "payee_rbukrs": "4100"}},
]


def simulate_delta() -> dict[str, Any]:
    """Insert the next not-yet-present pool item (deterministic, replayable)."""
    existing = {i["id"] for i in list_staging()}
    for cand in _SIM_POOL:
        if cand["id"] not in existing:
            add_staging_batch([cand])
            return cand
    return {"id": None, "kind": None, "raw": {}}


def matrix() -> list[dict[str, Any]]:
    rows = []
    tt_index = {t["txn_type_id"]: t for t in transaction_types()}
    for c in _covered_seed():
        tt = tt_index.get(c["txn_type_id"], {})
        res = type_with_range(c["txn_type_id"]) or {}
        ov = get_overlay(c["ctx_id"]) or {}
        lower, upper = res.get("lower"), res.get("upper")
        status = "na"
        actual = None
        if tt.get("method") == "TNMM":
            actual = _actual_margin(c["tested_rbukrs"])
            if actual is not None and lower is not None and upper is not None:
                status = "in_range" if lower <= actual <= upper else "review"
        rows.append({
            "ctx_id": c["ctx_id"],
            "txn_type_id": c["txn_type_id"],
            "txn_label": tt.get("label"),
            "category": tt.get("category"),
            "method": tt.get("method"),
            "pli": tt.get("pli"),
            "lower": lower, "median": res.get("median"), "upper": upper, "unit": res.get("unit"),
            "actual": actual,
            "status": status,
            "oecd_anchor": tt.get("oecd_anchor"),
            "payer": {"rbukrs": c["payer_rbukrs"], "name": _identity(c["payer_rbukrs"])["display_name"], "role": _entity_role(c["payer_rbukrs"])},
            "payee": {"rbukrs": c["payee_rbukrs"], "name": _identity(c["payee_rbukrs"])["display_name"], "role": _entity_role(c["payee_rbukrs"])},
            "tested": {"rbukrs": c["tested_rbukrs"], "name": _identity(c["tested_rbukrs"])["display_name"], "role": _entity_role(c["tested_rbukrs"])},
            "policy_ref": ov.get("policy_ref") or c.get("policy_ref"),
            "ica_ref": ov.get("ica_ref") or c.get("ica_ref"),
            "apa_ref": ov.get("apa_ref") or c.get("apa_ref"),
            "benchmark_set_id": res.get("benchmark_set_id"),
        })
    return rows
