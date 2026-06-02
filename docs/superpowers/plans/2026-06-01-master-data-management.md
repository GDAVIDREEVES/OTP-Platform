# Master Data Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a front-of-cycle **Master Data** workspace to the OTP Platform — a master transaction matrix (entities × TP functions composed into covered transactions, hybrid SAP-read-only + editable TP overlay) and an agentic SAP inbound-mapping workflow (staging → AI propose → human sign-off → maker-checker → applied + audited).

**Architecture:** A new top-level `/master-data` React workspace (sibling of `/home`, `/director`) backed by a new FastAPI `master_data` router. Read-only definitional data ships as versioned JSON seeds; mutable TP overlay + inbound staging live in SQLite via the existing `state/engine.py` + hash-chained `state/audit.py` + maker-checker `state/review.py`. The AI mapping proposer is a deterministic by-analogy heuristic with optional Claude refinement, mirroring `research_brain.py`'s tiered fallback.

**Tech Stack:** FastAPI + DuckDB/Parquet + stdlib `sqlite3` (backend); React 18 + MUI 5 + React Router 6 + Vite (frontend); pytest + FastAPI `TestClient` (backend tests); `npm run typecheck` + `npm run build` (frontend verification — this repo has no component test runner).

**Spec:** `docs/superpowers/specs/2026-06-01-master-data-management-design.md`

**Before you start:** Work on a feature branch off `demo-readiness`:
```bash
cd "/Users/gregreeves/Documents/OTP Platform/OTP-Platform"
git checkout demo-readiness && git checkout -b master-data
```
All backend commands run from `backend/` using the repo venv: `../.venv/bin/python -m pytest …`. All frontend commands run from the repo root.

---

## File structure

**Backend — create**
- `backend/seeds/master_data/tp_functions.v1.json` — controlled function vocabulary
- `backend/seeds/master_data/transaction_types.v1.json` — covered-transaction type defs
- `backend/seeds/master_data/entity_functions.v1.json` — entity→function assignments
- `backend/seeds/master_data/covered_transactions.v1.json` — matrix backbone
- `backend/seeds/master_data/inbound/sap_delta.v1.json` — seeded unmapped batch
- `backend/state/master_data.py` — seed loaders, `resolve()`, SQLite overlay/staging/mapping CRUD, `seed_if_empty()`
- `backend/services/mapping_ai.py` — `propose_mapping()` heuristic (+ optional Claude)
- `backend/routers/master_data.py` — all `/api/master-data/*` endpoints
- `backend/tests/test_master_data.py`, `test_master_data_overlay.py`, `test_master_data_mapping.py`, `test_mapping_ai.py`

**Backend — modify**
- `backend/state/schema.sql` — add `md_entity_function`, `md_overlay`, `md_staging`, `md_mapping`
- `backend/state/migrate.py` — call `master_data.seed_if_empty()` from `run()`
- `backend/dim/entity_dim.json` — add `functional_currency` to each entity
- `backend/schemas/state.py` — add MD request models
- `backend/main.py` — include `master_data.router`

**Frontend — create**
- `src/features/master-data/MasterDataWorkspace.tsx` — route shell + sub-nav
- `src/features/master-data/EntityMaster.tsx`, `TransactionMaster.tsx`, `TransactionMatrix.tsx`, `InboundMapping.tsx`, `MasterDataAudit.tsx`
- `src/features/master-data/useMappingWorkflow.ts` — mapping wizard hook

**Frontend — modify**
- `src/shared/api/client.ts`, `src/shared/api/types.ts` — MD methods + types
- `src/App.tsx` — lazy import + `/master-data` routes
- `src/shared/components/layout/AppShell.tsx` — nav entry
- `src/kernel/home/OperatingCadenceHome.tsx` — front-of-cycle entry
- `DEMO.md` — master-data walkthrough beats

---

# Phase MD-1 — Backend foundation

## Task 1: TP-function + transaction-type seeds and the resolution function

**Files:**
- Create: `backend/seeds/master_data/tp_functions.v1.json`
- Create: `backend/seeds/master_data/transaction_types.v1.json`
- Create: `backend/state/master_data.py`
- Test: `backend/tests/test_master_data.py`

- [ ] **Step 1: Write `tp_functions.v1.json`**

```json
{
  "version": "1",
  "functions": [
    { "code": "PRIN",  "label": "Principal / Entrepreneur",     "default_method": "Residual", "default_pli": "operating_margin", "typically_tested": false },
    { "code": "IPOWN", "label": "IP Owner / Licensor",          "default_method": "CUP",      "default_pli": "royalty_rate",     "typically_tested": false },
    { "code": "FRMFG", "label": "Full-Risk Manufacturer",       "default_method": "TNMM",     "default_pli": "operating_margin", "typically_tested": true  },
    { "code": "TOLL",  "label": "Toll / Contract Manufacturer", "default_method": "TNMM",     "default_pli": "net_cost_plus",    "typically_tested": true  },
    { "code": "LRD",   "label": "Limited-Risk Distributor",     "default_method": "TNMM",     "default_pli": "operating_margin", "typically_tested": true  },
    { "code": "SVC",   "label": "Intra-Group Service Provider", "default_method": "TNMM",     "default_pli": "net_cost_plus",    "typically_tested": true  },
    { "code": "TREAS", "label": "Treasury / Finance",           "default_method": "CUP",      "default_pli": "interest_rate",    "typically_tested": false }
  ]
}
```

- [ ] **Step 2: Write `transaction_types.v1.json`** (ties to the existing `benchmarks.v1.json` set ids)

```json
{
  "version": "1",
  "transaction_types": [
    { "txn_type_id": "ROY-API",  "label": "Royalty — patented API",  "category": "Royalties",     "method": "CUP",  "pli": "royalty_rate",     "benchmark_set_id": "BM-ROY-API", "oecd_anchor": "OECD TPG Ch. VI",  "characterising_function": "IPOWN" },
    { "txn_type_id": "ROY-TM",   "label": "Royalty — trademark",     "category": "Royalties",     "method": "CUP",  "pli": "royalty_rate",     "benchmark_set_id": "BM-ROY-TM",  "oecd_anchor": "OECD TPG Ch. VI",  "characterising_function": "IPOWN" },
    { "txn_type_id": "DIST-LRD", "label": "Distribution (LRD)",      "category": "Distribution",  "method": "TNMM", "pli": "operating_margin", "benchmark_set_id": "BM-LRD",     "oecd_anchor": "OECD TPG Ch. II",  "characterising_function": "LRD" },
    { "txn_type_id": "MFG-TOLL", "label": "Toll / contract mfg",     "category": "Manufacturing", "method": "TNMM", "pli": "net_cost_plus",    "benchmark_set_id": "BM-TOLL",    "oecd_anchor": "OECD TPG Ch. II",  "characterising_function": "TOLL" },
    { "txn_type_id": "SVC",      "label": "Intra-group services",    "category": "Services",      "method": "TNMM", "pli": "net_cost_plus",    "benchmark_set_id": "BM-SVC",     "oecd_anchor": "OECD TPG Ch. VII", "characterising_function": "SVC" },
    { "txn_type_id": "FIN",      "label": "Intercompany financing",  "category": "Financing",     "method": "CUP",  "pli": "interest_rate",    "benchmark_set_id": "BM-FIN",     "oecd_anchor": "OECD TPG Ch. X",   "characterising_function": "TREAS" }
  ]
}
```

- [ ] **Step 3: Write the failing test** for the loaders + `resolve()`

`backend/tests/test_master_data.py`:
```python
"""Master-data seeds, resolution, and matrix composition."""
from __future__ import annotations

from state import master_data as md


def test_functions_seed_is_controlled_vocab():
    codes = {f["code"] for f in md.functions()}
    assert {"LRD", "TOLL", "IPOWN", "SVC", "TREAS", "FRMFG", "PRIN"} <= codes


def test_resolve_lrd_distribution_to_tnmm_range():
    r = md.resolve("LRD", "Distribution")
    assert r is not None
    assert r["txn_type_id"] == "DIST-LRD"
    assert r["method"] == "TNMM"
    assert r["pli"] == "operating_margin"
    # range comes from BM-LRD in benchmarks.v1.json (2.0 / 3.0 / 4.0)
    assert (r["lower"], r["median"], r["upper"]) == (2.0, 3.0, 4.0)


def test_resolve_toll_manufacturing_to_benchmark():
    r = md.resolve("TOLL", "Manufacturing")
    assert r["benchmark_set_id"] == "BM-TOLL"
    assert (r["lower"], r["upper"]) == (5.0, 12.0)


def test_resolve_unknown_pair_returns_none():
    assert md.resolve("LRD", "Manufacturing") is None
```

- [ ] **Step 4: Run the test, expect failure**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'state.master_data'`.

- [ ] **Step 5: Implement the loaders + `resolve()` in `backend/state/master_data.py`**

```python
"""Master data — read-only definitional seeds (functions, transaction types,
entity-function assignments, covered transactions), the policy/calculation
resolution, and the SQLite-backed editable overlay + inbound staging.

Read seeds are cached like the process catalog; mutable state follows the
state/engine + audit pattern used across the platform.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from state import seeds

_DIR = Path(__file__).parent.parent / "seeds" / "master_data"


@lru_cache(maxsize=1)
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
```

- [ ] **Step 6: Run the test, expect pass**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data.py -q`
Expected: PASS (4 passed).

- [ ] **Step 7: Commit**

```bash
git add backend/seeds/master_data/tp_functions.v1.json backend/seeds/master_data/transaction_types.v1.json backend/state/master_data.py backend/tests/test_master_data.py
git commit -m "feat(md): tp-function + transaction-type seeds and policy resolution"
```

---

## Task 2: Entity-function, covered-transaction, and inbound seeds; entity_dim currency

**Files:**
- Create: `backend/seeds/master_data/entity_functions.v1.json`
- Create: `backend/seeds/master_data/covered_transactions.v1.json`
- Create: `backend/seeds/master_data/inbound/sap_delta.v1.json`
- Modify: `backend/dim/entity_dim.json`
- Test: `backend/tests/test_master_data.py` (add a seed-shape test)

- [ ] **Step 1: Write `entity_functions.v1.json`** (entity → one-or-more functions)

```json
{
  "version": "1",
  "assignments": [
    { "rbukrs": "1000", "tp_function_code": "PRIN",  "is_primary": true,  "tested_party": false, "applies_to": ["Royalties"] },
    { "rbukrs": "1000", "tp_function_code": "IPOWN", "is_primary": false, "tested_party": false, "applies_to": ["Royalties"] },
    { "rbukrs": "3100", "tp_function_code": "PRIN",  "is_primary": true,  "tested_party": false, "applies_to": ["Royalties"] },
    { "rbukrs": "3100", "tp_function_code": "IPOWN", "is_primary": false, "tested_party": false, "applies_to": ["Royalties"] },
    { "rbukrs": "3000", "tp_function_code": "FRMFG", "is_primary": true,  "tested_party": true,  "applies_to": ["Manufacturing"] },
    { "rbukrs": "3000", "tp_function_code": "SVC",   "is_primary": false, "tested_party": true,  "applies_to": ["Services"] },
    { "rbukrs": "3200", "tp_function_code": "LRD",   "is_primary": true,  "tested_party": true,  "applies_to": ["Distribution"] },
    { "rbukrs": "3300", "tp_function_code": "LRD",   "is_primary": true,  "tested_party": true,  "applies_to": ["Distribution"] },
    { "rbukrs": "3800", "tp_function_code": "LRD",   "is_primary": true,  "tested_party": true,  "applies_to": ["Distribution"] },
    { "rbukrs": "3400", "tp_function_code": "TREAS", "is_primary": true,  "tested_party": false, "applies_to": ["Financing"] },
    { "rbukrs": "4100", "tp_function_code": "TOLL",  "is_primary": true,  "tested_party": true,  "applies_to": ["Manufacturing"] }
  ]
}
```

- [ ] **Step 2: Write `covered_transactions.v1.json`** (the matrix backbone; `tested_rbukrs` is the characterising party whose actual is compared to the range)

```json
{
  "version": "1",
  "covered_transactions": [
    { "ctx_id": "CTX-ROY-API", "txn_type_id": "ROY-API",  "payer_rbukrs": "3000", "payee_rbukrs": "3100", "tested_rbukrs": "3100", "policy_ref": "POL-ROY-26",  "ica_ref": "ICA-26-014", "apa_ref": "APA-CHDE-19" },
    { "ctx_id": "CTX-ROY-TM",  "txn_type_id": "ROY-TM",   "payer_rbukrs": "3200", "payee_rbukrs": "1000", "tested_rbukrs": "1000", "policy_ref": "POL-ROYTM-26","ica_ref": "ICA-26-009", "apa_ref": null },
    { "ctx_id": "CTX-DIST-FR", "txn_type_id": "DIST-LRD", "payer_rbukrs": "3000", "payee_rbukrs": "3200", "tested_rbukrs": "3200", "policy_ref": "POL-DIS-26",  "ica_ref": "ICA-26-021", "apa_ref": null },
    { "ctx_id": "CTX-DIST-UK", "txn_type_id": "DIST-LRD", "payer_rbukrs": "3000", "payee_rbukrs": "3300", "tested_rbukrs": "3300", "policy_ref": "POL-DIS-26",  "ica_ref": "ICA-26-022", "apa_ref": null },
    { "ctx_id": "CTX-DIST-NL", "txn_type_id": "DIST-LRD", "payer_rbukrs": "3000", "payee_rbukrs": "3800", "tested_rbukrs": "3800", "policy_ref": "POL-DIS-26",  "ica_ref": "ICA-26-023", "apa_ref": null },
    { "ctx_id": "CTX-MFG-IN",  "txn_type_id": "MFG-TOLL", "payer_rbukrs": "3100", "payee_rbukrs": "4100", "tested_rbukrs": "4100", "policy_ref": "POL-MFG-26",  "ica_ref": "ICA-26-031", "apa_ref": null },
    { "ctx_id": "CTX-SVC-DE",  "txn_type_id": "SVC",      "payer_rbukrs": "1000", "payee_rbukrs": "3000", "tested_rbukrs": "3000", "policy_ref": "POL-SVC-26",  "ica_ref": "ICA-26-003", "apa_ref": null },
    { "ctx_id": "CTX-FIN-IE",  "txn_type_id": "FIN",      "payer_rbukrs": "3200", "payee_rbukrs": "3400", "tested_rbukrs": "3400", "policy_ref": "POL-FIN-26",  "ica_ref": "ICA-26-040", "apa_ref": null }
  ]
}
```

- [ ] **Step 3: Write `inbound/sap_delta.v1.json`** (the seeded unmapped batch; `id`s are stable so the demo + tests are deterministic)

```json
{
  "version": "1",
  "items": [
    { "id": "SAP-3500", "kind": "entity",      "raw": { "rbukrs": "3500", "name": "Spain Distribution Co.", "currency": "EUR", "country_hint": "Spain" } },
    { "id": "SAP-417000", "kind": "account",   "raw": { "account": "417000", "text": "Royalty expense - trademark" } },
    { "id": "SAP-CRD", "kind": "transaction",  "raw": { "label": "Contract R&D services", "payer_rbukrs": "3000", "payee_rbukrs": "4100" } }
  ]
}
```

- [ ] **Step 4: Add `functional_currency` to every entity in `backend/dim/entity_dim.json`**

Add `"functional_currency"` after each entity's `function`, per this map: 1000→USD, 3000→EUR, 3100→CHF, 3200→EUR, 3300→GBP, 3400→EUR, 3800→EUR, 4100→INR. Example for the first entity:
```json
    {
      "rbukrs": "1000",
      "display_name": "US IP Principal Co.",
      "country": "United States",
      "country_code": "US",
      "function": "Principal",
      "functional_currency": "USD",
      "lat": 39.74,
      "lng": -75.55
    },
```

- [ ] **Step 5: Write the failing test** (seed shapes) — append to `tests/test_master_data.py`

```python
def test_entity_function_seed_has_multi_hat_entity():
    import json
    from pathlib import Path
    p = Path("seeds/master_data/entity_functions.v1.json")
    asn = json.loads(p.read_text())["assignments"]
    by_rb: dict[str, int] = {}
    for a in asn:
        by_rb[a["rbukrs"]] = by_rb.get(a["rbukrs"], 0) + 1
    assert by_rb["1000"] == 2  # Principal + IP Owner
    assert by_rb["3000"] == 2  # Full-Risk Mfr + Service Provider
    # every limited-risk distributor shares the identical function code
    lrds = [a for a in asn if a["tp_function_code"] == "LRD"]
    assert {a["rbukrs"] for a in lrds} == {"3200", "3300", "3800"}
```

- [ ] **Step 6: Run, expect pass** (it reads committed JSON only)

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/seeds/master_data/ backend/dim/entity_dim.json backend/tests/test_master_data.py
git commit -m "feat(md): entity-function, covered-transaction, inbound seeds + entity currency"
```

---

## Task 3: SQLite tables for the overlay + staging

**Files:**
- Modify: `backend/state/schema.sql`
- Test: `backend/tests/test_master_data_overlay.py`

- [ ] **Step 1: Write the failing test** that the tables exist after `init_db()`

`backend/tests/test_master_data_overlay.py`:
```python
"""Master-data SQLite overlay + staging tables and CRUD."""
from __future__ import annotations

from state.engine import get_conn


def _tables() -> set[str]:
    rows = get_conn().execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {r["name"] for r in rows}


def test_md_tables_created(state_db):
    t = _tables()
    assert {"md_entity_function", "md_overlay", "md_staging", "md_mapping"} <= t
```

- [ ] **Step 2: Run, expect failure**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data_overlay.py -q`
Expected: FAIL — assertion error (tables missing).

- [ ] **Step 3: Append the DDL to `backend/state/schema.sql`** (all `IF NOT EXISTS`, consistent with the file)

```sql
-- ---- Master data: editable TP overlay + inbound mapping staging ----

CREATE TABLE IF NOT EXISTS md_entity_function (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  rbukrs           TEXT NOT NULL,
  tp_function_code TEXT NOT NULL,
  is_primary       INTEGER NOT NULL DEFAULT 0,
  tested_party     INTEGER NOT NULL DEFAULT 0,
  applies_to       TEXT,                              -- JSON array of categories
  status           TEXT NOT NULL DEFAULT 'active',    -- active|retired
  created_at       TEXT NOT NULL,
  updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS ix_md_ef_rbukrs ON md_entity_function (rbukrs);

CREATE TABLE IF NOT EXISTS md_overlay (
  ctx_id          TEXT PRIMARY KEY,
  policy_ref      TEXT,
  ica_ref         TEXT,
  apa_ref         TEXT,
  target_override REAL,
  notes           TEXT,
  updated_by      TEXT,
  updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS md_staging (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,                        -- entity|account|transaction|field
  raw_json      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'unmapped',     -- unmapped|proposed|in_review|applied|rejected
  proposed_json TEXT,
  confidence    TEXT,
  rationale     TEXT,
  maker         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS md_mapping (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  kind           TEXT NOT NULL,
  raw_key        TEXT NOT NULL,
  canonical_json TEXT NOT NULL,
  applied_by     TEXT,
  applied_at     TEXT NOT NULL
);
```

- [ ] **Step 4: Run, expect pass**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data_overlay.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/state/schema.sql backend/tests/test_master_data_overlay.py
git commit -m "feat(md): SQLite tables for TP overlay + inbound staging"
```

---

## Task 4: Overlay + entity-function CRUD, staging store, `seed_if_empty`, migrate hook

**Files:**
- Modify: `backend/state/master_data.py`
- Modify: `backend/state/migrate.py`
- Test: `backend/tests/test_master_data_overlay.py`

- [ ] **Step 1: Write the failing tests** — append to `tests/test_master_data_overlay.py`

```python
from state import master_data as md


def test_seed_if_empty_loads_entity_functions(state_db):
    md.seed_if_empty()
    rows = md.list_entity_functions("1000")
    codes = {r["tp_function_code"] for r in rows}
    assert codes == {"PRIN", "IPOWN"}


def test_seed_if_empty_is_idempotent(state_db):
    md.seed_if_empty()
    md.seed_if_empty()
    rows = md.list_entity_functions("3000")
    assert len(rows) == 2  # not duplicated


def test_set_overlay_records_audit_event(state_db):
    md.seed_if_empty()
    md.set_overlay("CTX-DIST-FR", {"policy_ref": "POL-DIS-26b"}, actor="u_maria")
    ov = md.get_overlay("CTX-DIST-FR")
    assert ov["policy_ref"] == "POL-DIS-26b"
    from state import audit
    events = audit.list_events(record_ref="mdctx:CTX-DIST-FR")
    assert any(e["event_type"] == "edited" for e in events)


def test_staging_seeded_with_inbound_batch(state_db):
    md.seed_if_empty()
    items = md.list_staging()
    ids = {i["id"] for i in items}
    assert {"SAP-3500", "SAP-417000", "SAP-CRD"} <= ids
    assert all(i["status"] == "unmapped" for i in items)
```

- [ ] **Step 2: Run, expect failure**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data_overlay.py -q`
Expected: FAIL — `AttributeError: module 'state.master_data' has no attribute 'seed_if_empty'`.

- [ ] **Step 3: Implement the SQLite layer in `backend/state/master_data.py`** (append; follows the `overrides.py` LOCK/get_conn/audit pattern)

```python
import state.audit as audit
from state.engine import LOCK, get_conn

from datetime import datetime, timezone


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
            record_ref=f"mdent:{rbukrs}", event_type="edited",
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
    rows = [i for i in list_staging() if i["id"] == item_id]
    return rows[0] if rows else None


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
    with LOCK:
        conn = get_conn()
        conn.execute(
            "UPDATE md_staging SET proposed_json=?, confidence=?, rationale=?, status='proposed', updated_at=? WHERE id=?",
            (json.dumps(proposal.get("proposed")), proposal.get("confidence"),
             proposal.get("rationale"), _now(), item_id),
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
    item = get_staging(item_id)
    if item is None:
        raise ValueError(f"no staging item {item_id}")
    proposed = item.get("proposed") or {}
    with LOCK:
        conn = get_conn()
        raw_key = json.dumps(item["raw"], sort_keys=True)
        conn.execute(
            "INSERT INTO md_mapping (kind, raw_key, canonical_json, applied_by, applied_at) VALUES (?, ?, ?, ?, ?)",
            (item["kind"], raw_key, json.dumps(proposed), applied_by, _now()),
        )
        # An onboarded entity also gets a function assignment so it shows in the master.
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
```

Note: `_doc()` already loads `inbound/sap_delta.v1.json` correctly (the `/` is part of the relative name under `_DIR`).

- [ ] **Step 4: Call it from `backend/state/migrate.py`** — modify `run()`

```python
def run() -> None:
    engine.init_db()
    overrides.import_legacy_json()
    from state import master_data
    master_data.seed_if_empty()
```

- [ ] **Step 5: Run the tests, expect pass**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data_overlay.py -q`
Expected: PASS (all). Note: these tests call `md.seed_if_empty()` directly under the `state_db` fixture.

- [ ] **Step 6: Commit**

```bash
git add backend/state/master_data.py backend/state/migrate.py backend/tests/test_master_data_overlay.py
git commit -m "feat(md): overlay/entity-function/staging CRUD + idempotent seeding"
```

---

## Task 5: AI mapping proposer (deterministic heuristic + optional Claude)

**Files:**
- Create: `backend/services/mapping_ai.py`
- Test: `backend/tests/test_mapping_ai.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_mapping_ai.py`:
```python
"""The by-analogy mapping proposer — deterministic, offline-safe."""
from __future__ import annotations

from services.mapping_ai import propose_mapping


def test_proposes_lrd_for_distribution_entity():
    item = {"kind": "entity", "raw": {"rbukrs": "3500", "name": "Spain Distribution Co.", "currency": "EUR", "country_hint": "Spain"}}
    out = propose_mapping(item)
    assert out["proposed"]["tp_function_code"] == "LRD"
    assert out["proposed"]["tested_party"] is True
    assert out["confidence"] in {"High", "Medium", "Low"}
    assert out["rationale"]


def test_proposes_roytm_for_trademark_royalty_account():
    item = {"kind": "account", "raw": {"account": "417000", "text": "Royalty expense - trademark"}}
    out = propose_mapping(item)
    assert out["proposed"]["txn_type_id"] == "ROY-TM"


def test_proposes_services_for_rd_transaction():
    item = {"kind": "transaction", "raw": {"label": "Contract R&D services", "payer_rbukrs": "3000", "payee_rbukrs": "4100"}}
    out = propose_mapping(item)
    assert out["proposed"]["txn_type_id"] == "SVC"


def test_unknown_entity_is_low_confidence_not_crash():
    out = propose_mapping({"kind": "entity", "raw": {"rbukrs": "9999", "name": "Zeta Holdings", "currency": "USD"}})
    assert out["proposed"]["tp_function_code"] in {"PRIN", "LRD", "SVC", "TREAS", "FRMFG", "TOLL", "IPOWN"}
    assert out["confidence"] == "Low"
```

- [ ] **Step 2: Run, expect failure**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_mapping_ai.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.mapping_ai'`.

- [ ] **Step 3: Implement `backend/services/mapping_ai.py`**

```python
"""Inbound SAP-mapping proposer.

Tiered like the Research Brain: a deterministic by-analogy heuristic always
produces a defensible proposal (offline-safe); when ANTHROPIC_API_KEY is set the
rationale may be refined by Claude. NEVER auto-applies — the result is a proposal
a human signs off on.
"""
from __future__ import annotations

import os
from typing import Any

# keyword -> (function code, label fragment used in the rationale)
_FUNCTION_KEYWORDS = [
    ("distribut", "LRD"),
    ("toll", "TOLL"),
    ("contract man", "TOLL"),
    ("manufactur", "FRMFG"),
    ("financ", "TREAS"),
    ("treasur", "TREAS"),
    ("service", "SVC"),
    ("principal", "PRIN"),
    ("licens", "IPOWN"),
    ("ip ", "IPOWN"),
]
_TESTED = {"LRD", "TOLL", "FRMFG", "SVC"}

_ACCOUNT_KEYWORDS = [
    (("royalt", "trademark"), "ROY-TM"),
    (("royalt", "trade mark"), "ROY-TM"),
    (("royalt", "api"), "ROY-API"),
    (("royalt",), "ROY-API"),
    (("interest",), "FIN"),
    (("service",), "SVC"),
]
_TXN_KEYWORDS = [
    (("r&d",), "SVC"),
    (("research",), "SVC"),
    (("service",), "SVC"),
    (("royalt",), "ROY-API"),
    (("distribut",), "DIST-LRD"),
    (("manufactur",), "MFG-TOLL"),
]


def _match(text: str, table) -> str | None:
    t = text.lower()
    for keys, code in table:
        if isinstance(keys, str):
            if keys in t:
                return code
        elif all(k in t for k in keys):
            return code
    return None


def _propose_entity(raw: dict[str, Any]) -> dict[str, Any]:
    name = str(raw.get("name", ""))
    code = None
    for frag, c in _FUNCTION_KEYWORDS:
        if frag in name.lower():
            code = c
            break
    if code is None:
        return {
            "proposed": {"tp_function_code": "PRIN", "tested_party": False, "applies_to": []},
            "confidence": "Low",
            "rationale": f"Could not infer a characterisation for '{name}' from its name; defaulting to Principal — please set the correct function.",
        }
    proposed = {
        "tp_function_code": code,
        "tested_party": code in _TESTED,
        "applies_to": {"LRD": ["Distribution"], "TOLL": ["Manufacturing"], "FRMFG": ["Manufacturing"], "SVC": ["Services"]}.get(code, []),
        "country": raw.get("country_hint"),
        "functional_currency": raw.get("currency"),
    }
    return {
        "proposed": proposed,
        "confidence": "High" if code == "LRD" else "Medium",
        "rationale": (
            f"RBUKRS {raw.get('rbukrs')} '{name}' matches the naming and routing of the existing "
            f"distributors (3200/3300/3800); characterised as {code} by analogy."
            if code == "LRD" else
            f"'{name}' indicates a {code} characterisation by name; confirm against its functional profile."
        ),
    }


def propose_mapping(item: dict[str, Any]) -> dict[str, Any]:
    kind = item["kind"]
    raw = item["raw"]
    if kind == "entity":
        out = _propose_entity(raw)
    elif kind == "account":
        code = _match(str(raw.get("text", "")), _ACCOUNT_KEYWORDS)
        out = {
            "proposed": {"txn_type_id": code} if code else {"txn_type_id": None},
            "confidence": "High" if code else "Low",
            "rationale": f"Account text '{raw.get('text')}' maps to transaction type {code}." if code
                         else f"Could not classify account '{raw.get('account')}'; assign a transaction type.",
        }
    elif kind == "transaction":
        code = _match(str(raw.get("label", "")), _TXN_KEYWORDS)
        out = {
            "proposed": {"txn_type_id": code} if code else {"txn_type_id": None},
            "confidence": "Medium" if code else "Low",
            "rationale": f"'{raw.get('label')}' best matches transaction type {code}." if code
                         else f"Could not classify transaction '{raw.get('label')}'.",
        }
    else:
        out = {"proposed": {}, "confidence": "Low", "rationale": f"Unsupported kind '{kind}'."}

    out["live"] = False
    out["citations"] = [{"source": "OECD TPG Ch. I–III", "note": "functional analysis & method selection"}]
    return _maybe_refine(item, out)


def _maybe_refine(item: dict[str, Any], out: dict[str, Any]) -> dict[str, Any]:
    """Optionally let Claude rewrite the rationale; never changes the proposal."""
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return out
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=key)
        msg = client.messages.create(
            model=os.getenv("OTP_CLAUDE_MODEL", "claude-3-5-haiku-latest"),
            max_tokens=160,
            system="You are a transfer-pricing assistant. In <=2 sentences, justify the proposed mapping. Do not change it.",
            messages=[{"role": "user", "content": f"Item: {item}\nProposed: {out['proposed']}\nCurrent rationale: {out['rationale']}"}],
        )
        text = "".join(getattr(b, "text", "") for b in msg.content).strip()
        if text:
            out["rationale"] = text
            out["live"] = True
    except Exception:
        pass
    return out
```

- [ ] **Step 4: Run, expect pass**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_mapping_ai.py -q`
Expected: PASS (4 passed). (No network: `ANTHROPIC_API_KEY` unset → heuristic only.)

- [ ] **Step 5: Commit**

```bash
git add backend/services/mapping_ai.py backend/tests/test_mapping_ai.py
git commit -m "feat(md): by-analogy SAP mapping proposer with optional Claude refinement"
```

---

## Task 6: Read endpoints + matrix composition + router wiring

**Files:**
- Modify: `backend/state/master_data.py` (add `entity_master()`, `matrix()`)
- Create: `backend/routers/master_data.py`
- Modify: `backend/main.py`
- Modify: `backend/schemas/state.py`
- Test: `backend/tests/test_master_data.py`

- [ ] **Step 1: Write the failing tests** — append to `tests/test_master_data.py`

```python
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_entities_endpoint_returns_entity_function_grain(state_db):
    md.seed_if_empty()
    rows = client.get("/api/master-data/entities").json()
    by_rb = [r for r in rows if r["rbukrs"] == "1000"]
    assert {r["tp_function_code"] for r in by_rb} == {"PRIN", "IPOWN"}
    assert by_rb[0]["tp_function_label"]  # resolved label
    assert by_rb[0]["functional_currency"] == "USD"


def test_matrix_endpoint_composes_and_resolves(state_db):
    md.seed_if_empty()
    rows = client.get("/api/master-data/matrix").json()
    fr = next(r for r in rows if r["ctx_id"] == "CTX-DIST-FR")
    assert fr["method"] == "TNMM"
    assert fr["lower"] == 2.0 and fr["upper"] == 4.0
    assert fr["policy_ref"] == "POL-DIS-26"
    assert fr["status"] in {"in_range", "review", "na"}
    assert fr["payer"]["role"] and fr["tested"]["role"]  # roles from the master
    # the trademark royalty must resolve to its OWN benchmark, not the API royalty's
    tm = next(r for r in rows if r["ctx_id"] == "CTX-ROY-TM")
    assert tm["benchmark_set_id"] == "BM-ROY-TM"
    assert tm["upper"] == 4.0


def test_transaction_types_and_functions_endpoints(state_db):
    md.seed_if_empty()
    assert client.get("/api/master-data/functions").status_code == 200
    tt = client.get("/api/master-data/transaction-types").json()
    assert any(t["txn_type_id"] == "DIST-LRD" for t in tt)
```

- [ ] **Step 2: Run, expect failure**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data.py -q`
Expected: FAIL — 404 (router not mounted) / missing functions.

- [ ] **Step 3: Add `entity_master()` and `matrix()` to `backend/state/master_data.py`**

```python
from db import q
from period_filter import PeriodFilter
from services.entities import list_entities


@lru_cache(maxsize=1)
def _entity_dim() -> dict[str, dict[str, Any]]:
    raw = json.loads((Path(__file__).parent.parent / "dim" / "entity_dim.json").read_text(encoding="utf-8"))
    return {e["rbukrs"]: e for e in raw["entities"]}


def _identity(rbukrs: str) -> dict[str, Any]:
    dim = _entity_dim().get(rbukrs)
    if dim:
        return {"rbukrs": rbukrs, "display_name": dim["display_name"], "country": dim.get("country"),
                "functional_currency": dim.get("functional_currency")}
    for e in onboarded_entities():           # SAP-onboarded entity
        if e["rbukrs"] == rbukrs:
            return e
    return {"rbukrs": rbukrs, "display_name": f"Entity {rbukrs}", "country": None, "functional_currency": None}


def entity_master() -> list[dict[str, Any]]:
    """entity × function grain: SAP identity (incl. onboarded) joined to functions."""
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
        })
    return out


@lru_cache(maxsize=1)
def _covered_seed() -> list[dict[str, Any]]:
    return _doc("covered_transactions.v1.json")["covered_transactions"]


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
```

- [ ] **Step 4: Add request models to `backend/schemas/state.py`** (append)

```python
class EntityFunctionIn(BaseModel):
    rbukrs: str
    tp_function_code: str
    tested_party: bool = False
    applies_to: list[str] = Field(default_factory=list)
    is_primary: bool = False
    actor: str


class OverlayIn(BaseModel):
    policy_ref: str | None = None
    ica_ref: str | None = None
    apa_ref: str | None = None
    target_override: float | None = None
    notes: str | None = None
    actor: str


class MappingSubmitIn(BaseModel):
    maker: str


class MappingDecisionIn(BaseModel):
    checker: str
    comments: str | None = None
```

- [ ] **Step 5: Create `backend/routers/master_data.py`** (read endpoints first; staging/overlay added in Tasks 7–8)

```python
"""Master Data workspace — the front of the close cycle."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from schemas.state import EntityFunctionIn, MappingDecisionIn, MappingSubmitIn, OverlayIn
from services.mapping_ai import propose_mapping
from state import master_data as md
from state import review

router = APIRouter()


@router.get("/api/master-data/functions")
def functions():
    return md.functions()


@router.get("/api/master-data/transaction-types")
def transaction_types():
    return md.transaction_types()


@router.get("/api/master-data/entities")
def entities():
    return md.entity_master()


@router.get("/api/master-data/matrix")
def matrix():
    return md.matrix()
```

- [ ] **Step 6: Mount it in `backend/main.py`** — add `master_data` to the import line and the include tuple

In the existing `from routers import (...)` import, add `master_data`. Then add it to the `include_router` loop, after `reference.router`:
```python
    reference.router,
    master_data.router,
```

- [ ] **Step 7: Run the tests, expect pass**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data.py -q`
Expected: PASS.

- [ ] **Step 8: Run the full backend suite (no regressions)**

Run: `cd backend && ../.venv/bin/python -m pytest -q`
Expected: PASS (previous count + the new tests).

- [ ] **Step 9: Commit**

```bash
git add backend/state/master_data.py backend/routers/master_data.py backend/main.py backend/schemas/state.py backend/tests/test_master_data.py
git commit -m "feat(md): read endpoints + matrix composition (function-driven resolution)"
```

---

## Task 7: Overlay + entity-function write endpoints (maker-checker + audit)

**Files:**
- Modify: `backend/routers/master_data.py`
- Test: `backend/tests/test_master_data_overlay.py`

- [ ] **Step 1: Write the failing test** — append to `tests/test_master_data_overlay.py`

```python
from fastapi.testclient import TestClient
from main import app

api = TestClient(app)


def test_overlay_put_endpoint_edits_and_audits(state_db):
    md.seed_if_empty()
    r = api.put("/api/master-data/overlay/CTX-DIST-FR", json={"policy_ref": "POL-DIS-26c", "actor": "u_maria"})
    assert r.status_code == 200
    assert r.json()["policy_ref"] == "POL-DIS-26c"
    events = api.get("/api/audit", params={"record_ref": "mdctx:CTX-DIST-FR"}).json()
    assert any(e["event_type"] == "edited" and e["actor"] == "u_maria" for e in events)


def test_entity_function_post_adds_row(state_db):
    md.seed_if_empty()
    r = api.post("/api/master-data/entity-function", json={
        "rbukrs": "3200", "tp_function_code": "SVC", "tested_party": True,
        "applies_to": ["Services"], "actor": "u_maria"})
    assert r.status_code == 200
    rows = api.get("/api/master-data/entities").json()
    fr = [x for x in rows if x["rbukrs"] == "3200"]
    assert {x["tp_function_code"] for x in fr} == {"LRD", "SVC"}
```

- [ ] **Step 2: Run, expect failure**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data_overlay.py -q`
Expected: FAIL — 405/404 (endpoints absent).

- [ ] **Step 3: Add the write endpoints to `backend/routers/master_data.py`**

```python
@router.put("/api/master-data/overlay/{ctx_id}")
def put_overlay(ctx_id: str, body: OverlayIn):
    patch = body.model_dump(exclude_none=True, exclude={"actor"})
    return md.set_overlay(ctx_id, patch, actor=body.actor)


@router.post("/api/master-data/entity-function")
def post_entity_function(body: EntityFunctionIn):
    return md.add_entity_function(
        rbukrs=body.rbukrs, tp_function_code=body.tp_function_code,
        tested_party=body.tested_party, applies_to=body.applies_to,
        is_primary=body.is_primary, actor=body.actor,
    )
```

- [ ] **Step 4: Run, expect pass**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data_overlay.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routers/master_data.py backend/tests/test_master_data_overlay.py
git commit -m "feat(md): overlay + entity-function write endpoints (audited)"
```

---

## Task 8: Inbound staging endpoints — simulate, propose, submit, approve/reject

**Files:**
- Modify: `backend/routers/master_data.py`
- Modify: `backend/state/master_data.py` (add `simulate_delta()`)
- Test: `backend/tests/test_master_data_mapping.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_master_data_mapping.py`:
```python
"""End-to-end inbound mapping: staging -> propose -> submit -> approve -> applied."""
from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from state import master_data as md

api = TestClient(app)


def test_full_mapping_flow_applies_entity_and_audits(state_db):
    md.seed_if_empty()
    # 1. queue is seeded with the SAP delta
    q = api.get("/api/master-data/staging").json()
    assert any(i["id"] == "SAP-3500" and i["status"] == "unmapped" for i in q)

    # 2. AI proposes a mapping (agentic hand-off)
    p = api.post("/api/master-data/staging/SAP-3500/propose").json()
    assert p["proposed"]["tp_function_code"] == "LRD"
    assert p["confidence"]

    # 3. maker submits for review
    s = api.post("/api/master-data/staging/SAP-3500/submit", json={"maker": "u_maria"})
    assert s.status_code == 200

    # 4. a different human approves -> applied
    a = api.post("/api/master-data/staging/SAP-3500/approve", json={"checker": "u_sam"})
    assert a.status_code == 200

    # the onboarded entity now shows in the master as an LRD
    rows = api.get("/api/master-data/entities").json()
    assert any(r["rbukrs"] == "3500" and r["tp_function_code"] == "LRD" for r in rows)

    # audit chain stays intact and records the assistant -> maker -> checker trail
    assert api.get("/api/audit/verify").json()["ok"] is True
    ev = api.get("/api/audit", params={"record_ref": "mdmap:SAP-3500"}).json()
    kinds = {e["actor_kind"] for e in ev}
    assert "assistant" in kinds and "human" in kinds


def test_maker_cannot_approve_own_mapping(state_db):
    md.seed_if_empty()
    api.post("/api/master-data/staging/SAP-417000/propose")
    api.post("/api/master-data/staging/SAP-417000/submit", json={"maker": "u_maria"})
    r = api.post("/api/master-data/staging/SAP-417000/approve", json={"checker": "u_maria"})
    assert r.status_code == 400


def test_simulate_adds_a_new_unmapped_item(state_db):
    md.seed_if_empty()
    before = len(api.get("/api/master-data/staging").json())
    api.post("/api/master-data/staging/simulate")
    after = len(api.get("/api/master-data/staging").json())
    assert after == before + 1
```

- [ ] **Step 2: Run, expect failure**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data_mapping.py -q`
Expected: FAIL — endpoints absent.

- [ ] **Step 3: Add `simulate_delta()` to `backend/state/master_data.py`**

```python
# A small pool of extra deltas the "Simulate SAP delta" button cycles through.
# No Math.random/Date in the codebase guidance: pick deterministically by count.
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
    # pool exhausted -> re-add the first as a no-op-ish refresh
    return {"id": None, "kind": None, "raw": {}}
```

- [ ] **Step 4: Add the staging endpoints to `backend/routers/master_data.py`**

```python
@router.get("/api/master-data/staging")
def staging():
    return md.list_staging()


@router.post("/api/master-data/staging/simulate")
def simulate():
    return md.simulate_delta()


@router.post("/api/master-data/staging/{item_id}/propose")
def propose(item_id: str):
    item = md.get_staging(item_id)
    if item is None:
        raise HTTPException(404, f"no staging item {item_id}")
    out = propose_mapping(item)
    md.set_proposal(item_id, out)
    # the proposal is an assistant 'prepared' event — the visible hand-off
    from state import audit
    ev = audit.record(
        actor=audit.ASSISTANT_ACTOR, actor_kind="assistant", process_id="MASTER-DATA",
        record_ref=f"mdmap:{item_id}", event_type="prepared", rationale=out.get("rationale"),
    )
    return {**out, "event_id": ev["id"]}


@router.post("/api/master-data/staging/{item_id}/submit")
def submit(item_id: str, body: MappingSubmitIn):
    item = md.get_staging(item_id)
    if item is None:
        raise HTTPException(404, f"no staging item {item_id}")
    md.mark_status(item_id, "in_review", maker=body.maker)
    review.create_item(process_id="MASTER-DATA", record_ref=f"mdmap:{item_id}", maker=body.maker)
    return {"id": item_id, "status": "in_review"}


def _review_item_id(record_ref: str) -> int | None:
    from state.engine import get_conn
    r = get_conn().execute(
        "SELECT id FROM review_items WHERE record_ref=? AND status='pending' ORDER BY id DESC LIMIT 1",
        (record_ref,),
    ).fetchone()
    return r["id"] if r else None


@router.post("/api/master-data/staging/{item_id}/approve")
def approve(item_id: str, body: MappingDecisionIn):
    rid = _review_item_id(f"mdmap:{item_id}")
    if rid is None:
        raise HTTPException(404, f"no pending review for {item_id}")
    try:
        review.decide(rid, body.checker, "approve", body.comments)   # enforces checker!=maker, AI-never-checker
    except ValueError as e:
        raise HTTPException(400, str(e))
    return md.apply_mapping(item_id, applied_by=body.checker)


@router.post("/api/master-data/staging/{item_id}/reject")
def reject(item_id: str, body: MappingDecisionIn):
    rid = _review_item_id(f"mdmap:{item_id}")
    if rid is None:
        raise HTTPException(404, f"no pending review for {item_id}")
    try:
        review.decide(rid, body.checker, "reject", body.comments)
    except ValueError as e:
        raise HTTPException(400, str(e))
    md.mark_status(item_id, "rejected")
    return {"id": item_id, "status": "rejected"}
```

- [ ] **Step 5: Run the tests, expect pass**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data_mapping.py -q`
Expected: PASS (3 passed). The `approve` 400 case verifies maker≠checker.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && ../.venv/bin/python -m pytest -q`
Expected: PASS (all green).

- [ ] **Step 7: Commit**

```bash
git add backend/routers/master_data.py backend/state/master_data.py backend/tests/test_master_data_mapping.py
git commit -m "feat(md): inbound staging endpoints — simulate/propose/submit/approve/reject + apply"
```

---

# Phase MD-2 — Workspace frontend

## Task 9: API client methods + TypeScript types

**Files:**
- Modify: `src/shared/api/types.ts`
- Modify: `src/shared/api/client.ts`

- [ ] **Step 1: Add types to `src/shared/api/types.ts`** (append)

```ts
export interface TpFunction {
  code: string;
  label: string;
  default_method: string;
  default_pli: string;
  typically_tested: boolean;
}

export interface MdEntityRow {
  rbukrs: string;
  display_name: string;
  country: string | null;
  functional_currency: string | null;
  tp_function_code: string;
  tp_function_label: string;
  is_primary: boolean;
  tested_party: boolean;
  applies_to: string[];
}

export interface MdTransactionType {
  txn_type_id: string;
  label: string;
  category: string;
  method: string;
  pli: string;
  benchmark_set_id: string;
  oecd_anchor: string;
  characterising_function: string;
}

export interface MdMatrixParty {
  rbukrs: string;
  name: string;
  role: string;
}

export interface MdMatrixRow {
  ctx_id: string;
  txn_type_id: string;
  txn_label: string;
  category: string;
  method: string;
  pli: string;
  lower: number | null;
  median: number | null;
  upper: number | null;
  unit: string | null;
  actual: number | null;
  status: 'in_range' | 'review' | 'na';
  oecd_anchor: string;
  payer: MdMatrixParty;
  payee: MdMatrixParty;
  tested: MdMatrixParty;
  policy_ref: string | null;
  ica_ref: string | null;
  apa_ref: string | null;
  benchmark_set_id: string | null;
}

export interface MdStagingItem {
  id: string;
  kind: 'entity' | 'account' | 'transaction' | 'field';
  raw: Record<string, unknown>;
  status: 'unmapped' | 'proposed' | 'in_review' | 'applied' | 'rejected';
  proposed: Record<string, unknown> | null;
  confidence: string | null;
  rationale: string | null;
  maker: string | null;
}

export interface MdProposal {
  proposed: Record<string, unknown>;
  confidence: string;
  rationale: string;
  live: boolean;
  citations: { source: string; note?: string }[];
  event_id: number;
}
```

- [ ] **Step 2: Add methods to the `api` object in `src/shared/api/client.ts`** (insert alongside the other methods; import the new types at the top)

Add to the type import from `./types`: `TpFunction, MdEntityRow, MdTransactionType, MdMatrixRow, MdStagingItem, MdProposal`. Then add these methods to the `api` object:
```ts
  // ---- Master Data ----
  mdFunctions: () => getJSON<TpFunction[]>('/api/master-data/functions'),
  mdEntities: () => getJSON<MdEntityRow[]>('/api/master-data/entities'),
  mdTransactionTypes: () => getJSON<MdTransactionType[]>('/api/master-data/transaction-types'),
  mdMatrix: () => getJSON<MdMatrixRow[]>('/api/master-data/matrix'),
  mdPutOverlay: (
    ctxId: string,
    body: { policy_ref?: string; ica_ref?: string; apa_ref?: string; target_override?: number; notes?: string; actor: string },
  ) => sendJSON<MdMatrixRow>('PUT', `/api/master-data/overlay/${encodeURIComponent(ctxId)}`, body),
  mdAddEntityFunction: (
    body: { rbukrs: string; tp_function_code: string; tested_party?: boolean; applies_to?: string[]; is_primary?: boolean; actor: string },
  ) => sendJSON<{ rbukrs: string; tp_function_code: string }>('POST', '/api/master-data/entity-function', body),
  mdStaging: () => getJSON<MdStagingItem[]>('/api/master-data/staging'),
  mdSimulate: () => sendJSON<MdStagingItem>('POST', '/api/master-data/staging/simulate'),
  mdPropose: (id: string) => sendJSON<MdProposal>('POST', `/api/master-data/staging/${encodeURIComponent(id)}/propose`),
  mdSubmitMapping: (id: string, maker: string) =>
    sendJSON<{ id: string; status: string }>('POST', `/api/master-data/staging/${encodeURIComponent(id)}/submit`, { maker }),
  mdApproveMapping: (id: string, checker: string, comments?: string) =>
    sendJSON<{ id: string; status: string }>('POST', `/api/master-data/staging/${encodeURIComponent(id)}/approve`, { checker, comments }),
  mdRejectMapping: (id: string, checker: string, comments: string) =>
    sendJSON<{ id: string; status: string }>('POST', `/api/master-data/staging/${encodeURIComponent(id)}/reject`, { checker, comments }),
```

- [ ] **Step 3: Verify the frontend compiles**

Run: `npm run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add src/shared/api/types.ts src/shared/api/client.ts
git commit -m "feat(md): api client methods + types for master data"
```

---

## Task 10: Workspace shell + route + nav entry

**Files:**
- Create: `src/features/master-data/MasterDataWorkspace.tsx`
- Modify: `src/App.tsx`
- Modify: `src/shared/components/layout/AppShell.tsx`

- [ ] **Step 1: Create `src/features/master-data/MasterDataWorkspace.tsx`** (sub-nav tabs read from `:tab`; child views are placeholders imported in later tasks)

```tsx
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Tabs, Tab, Typography, Chip, Stack } from '@mui/material';
import { useEffect, useState } from 'react';
import AppShell from '@/shared/components/layout/AppShell';
import { api } from '@/shared/api/client';
import EntityMaster from './EntityMaster';
import TransactionMaster from './TransactionMaster';
import TransactionMatrix from './TransactionMatrix';
import InboundMapping from './InboundMapping';
import MasterDataAudit from './MasterDataAudit';

const TABS = [
  { key: 'matrix', label: 'Transaction matrix' },
  { key: 'entities', label: 'Entities' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'mapping', label: 'Inbound mapping' },
  { key: 'audit', label: 'Audit' },
] as const;

export default function MasterDataWorkspace() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const active = TABS.find((t) => t.key === tab)?.key ?? 'matrix';
  const [unmapped, setUnmapped] = useState(0);

  useEffect(() => {
    api.mdStaging().then((s) => setUnmapped(s.filter((i) => i.status !== 'applied' && i.status !== 'rejected').length)).catch(() => {});
  }, [active]);

  return (
    <AppShell>
      <Box sx={{ mb: 2 }}>
        <Typography variant="overline" sx={{ color: 'text.secondary' }}>Front of the close cycle</Typography>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Master Data</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          The entities, transactions and policies every downstream calculation reads from.
        </Typography>
      </Box>
      <Tabs value={active} onChange={(_, v) => navigate(`/master-data/${v}`)} sx={{ mb: 2 }}>
        {TABS.map((t) => (
          <Tab
            key={t.key}
            value={t.key}
            label={
              t.key === 'mapping' && unmapped > 0 ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <span>{t.label}</span>
                  <Chip size="small" color="warning" label={unmapped} sx={{ height: 18 }} />
                </Stack>
              ) : t.label
            }
          />
        ))}
      </Tabs>
      {active === 'matrix' && <TransactionMatrix />}
      {active === 'entities' && <EntityMaster />}
      {active === 'transactions' && <TransactionMaster />}
      {active === 'mapping' && <InboundMapping onChange={() => api.mdStaging().then((s) => setUnmapped(s.filter((i) => i.status !== 'applied' && i.status !== 'rejected').length))} />}
      {active === 'audit' && <MasterDataAudit />}
    </AppShell>
  );
}
```

Note: confirm `AppShell` is a default export that accepts `children`. If it is a named export, adjust the import accordingly (check `src/shared/components/layout/AppShell.tsx`).

- [ ] **Step 2: Create stub child components so the shell compiles** — create each file with a minimal default export (filled in Tasks 11–14):

`src/features/master-data/EntityMaster.tsx`, `TransactionMaster.tsx`, `TransactionMatrix.tsx`, `MasterDataAudit.tsx`:
```tsx
export default function Placeholder() {
  return <div>Coming up in the next task.</div>;
}
```
`src/features/master-data/InboundMapping.tsx`:
```tsx
export default function InboundMapping(_: { onChange?: () => void }) {
  return <div>Coming up in the next task.</div>;
}
```

- [ ] **Step 3: Add routes in `src/App.tsx`** — add the lazy import beside the others and the two routes beside `/director`

```tsx
const MasterData = lazy(() => import('@/features/master-data/MasterDataWorkspace'));
```
```tsx
                <Route path="/master-data" element={<MasterData />} />
                <Route path="/master-data/:tab" element={<MasterData />} />
```

- [ ] **Step 4: Add the nav entry in `src/shared/components/layout/AppShell.tsx`** — import an icon and insert after the Home item in `navItems`

```tsx
import AccountTreeIcon from '@mui/icons-material/AccountTree';
```
```tsx
  { label: 'Home', icon: <HomeIcon />, path: '/home' },
  { label: 'Master Data', icon: <AccountTreeIcon />, path: '/master-data' },
```

- [ ] **Step 5: Verify compile + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/master-data/ src/App.tsx src/shared/components/layout/AppShell.tsx
git commit -m "feat(md): master data workspace shell, route, and nav entry"
```

---

## Task 11: Entity master view (entity × function grid)

**Files:**
- Modify: `src/features/master-data/EntityMaster.tsx`

- [ ] **Step 1: Implement `EntityMaster.tsx`** (groups rows by entity; SAP identity shown once per group; TP overlay tinted)

```tsx
import { useEffect, useMemo, useState } from 'react';
import {
  Box, CircularProgress, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography, Chip,
} from '@mui/material';
import { api } from '@/shared/api/client';
import type { MdEntityRow } from '@/shared/api/types';

const OVERLAY = '#FAF5FF';

export default function EntityMaster() {
  const [rows, setRows] = useState<MdEntityRow[] | null>(null);
  useEffect(() => { api.mdEntities().then(setRows).catch(() => setRows([])); }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, MdEntityRow[]>();
    for (const r of rows ?? []) {
      const k = r.rbukrs;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return Array.from(m.values());
  }, [rows]);

  if (rows === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Paper variant="outlined">
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Entity master</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          One row per function. SAP identity is read-only; the TP characterisation (tinted) is the governed overlay.
        </Typography>
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>RBUKRS</TableCell><TableCell>Legal entity</TableCell><TableCell>Country</TableCell>
            <TableCell sx={{ bgcolor: OVERLAY }}>TP function</TableCell>
            <TableCell sx={{ bgcolor: OVERLAY }}>Tested</TableCell>
            <TableCell sx={{ bgcolor: OVERLAY }}>Currency</TableCell>
            <TableCell sx={{ bgcolor: OVERLAY }}>Applies to</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {grouped.map((g) =>
            g.map((r, i) => (
              <TableRow key={`${r.rbukrs}-${r.tp_function_code}`} hover>
                <TableCell sx={{ fontWeight: 700, borderTop: i === 0 ? '2px solid #E2E8F0' : undefined }}>{i === 0 ? r.rbukrs : ''}</TableCell>
                <TableCell sx={{ borderTop: i === 0 ? '2px solid #E2E8F0' : undefined }}>{i === 0 ? r.display_name : ''}</TableCell>
                <TableCell sx={{ borderTop: i === 0 ? '2px solid #E2E8F0' : undefined }}>{i === 0 ? r.country : ''}</TableCell>
                <TableCell sx={{ bgcolor: OVERLAY, fontWeight: 600 }}>{r.tp_function_label}{r.is_primary ? ' ·primary' : ''}</TableCell>
                <TableCell sx={{ bgcolor: OVERLAY }}>{r.tested_party ? '✓' : '—'}</TableCell>
                <TableCell sx={{ bgcolor: OVERLAY }}>{r.functional_currency ?? '—'}</TableCell>
                <TableCell sx={{ bgcolor: OVERLAY }}>{r.applies_to.map((a) => <Chip key={a} size="small" label={a} sx={{ mr: 0.5, height: 20 }} />)}</TableCell>
              </TableRow>
            )),
          )}
        </TableBody>
      </Table>
    </Paper>
  );
}
```

- [ ] **Step 2: Verify compile + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/master-data/EntityMaster.tsx
git commit -m "feat(md): entity master view (entity x function grid)"
```

---

## Task 12: Transaction master view

**Files:**
- Modify: `src/features/master-data/TransactionMaster.tsx`

- [ ] **Step 1: Implement `TransactionMaster.tsx`**

```tsx
import { useEffect, useState } from 'react';
import {
  Box, CircularProgress, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography, Chip,
} from '@mui/material';
import { api } from '@/shared/api/client';
import type { MdTransactionType, TpFunction } from '@/shared/api/types';

export default function TransactionMaster() {
  const [types, setTypes] = useState<MdTransactionType[] | null>(null);
  const [fns, setFns] = useState<TpFunction[]>([]);
  useEffect(() => {
    api.mdTransactionTypes().then(setTypes).catch(() => setTypes([]));
    api.mdFunctions().then(setFns).catch(() => setFns([]));
  }, []);
  const label = (code: string) => fns.find((f) => f.code === code)?.label ?? code;

  if (types === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Paper variant="outlined">
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Transaction master</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Each covered transaction type: the characterising function selects it, and it carries the method, PLI and benchmark.
        </Typography>
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Type</TableCell><TableCell>Category</TableCell><TableCell>Characterising function</TableCell>
            <TableCell>Method</TableCell><TableCell>PLI</TableCell><TableCell>Benchmark</TableCell><TableCell>OECD</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {types.map((t) => (
            <TableRow key={t.txn_type_id} hover>
              <TableCell sx={{ fontWeight: 600 }}>{t.label}</TableCell>
              <TableCell><Chip size="small" label={t.category} sx={{ height: 20 }} /></TableCell>
              <TableCell>{label(t.characterising_function)}</TableCell>
              <TableCell>{t.method}</TableCell>
              <TableCell>{t.pli}</TableCell>
              <TableCell>{t.benchmark_set_id}</TableCell>
              <TableCell><Typography variant="caption" sx={{ color: 'text.secondary' }}>{t.oecd_anchor}</Typography></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}
```

- [ ] **Step 2: Verify compile + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/master-data/TransactionMaster.tsx
git commit -m "feat(md): transaction master view"
```

---

## Task 13: Transaction matrix view (dense grid + overlay edit + drill + export)

**Files:**
- Modify: `src/features/master-data/TransactionMatrix.tsx`

- [ ] **Step 1: Implement `TransactionMatrix.tsx`** (dense workpaper grid; editable policy/ICA/APA via prompt for simplicity; drill the tested party; print/export)

```tsx
import { useEffect, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useToast } from '@/shared/providers/DataProvider';
import DrillDrawer from '@/kernel/data/DrillDrawer';
import type { MdMatrixRow } from '@/shared/api/types';

const OVERLAY = '#FAF5FF';
const STATUS: Record<string, { label: string; color: string }> = {
  in_range: { label: 'In range', color: '#16A34A' },
  review: { label: 'Review', color: '#D97706' },
  na: { label: '—', color: '#94A3B8' },
};

export default function TransactionMatrix() {
  const user = useSessionUser();
  const toast = useToast();
  const [rows, setRows] = useState<MdMatrixRow[] | null>(null);
  const [drill, setDrill] = useState<{ id: string; name: string } | null>(null);

  const load = () => api.mdMatrix().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const editOverlay = async (r: MdMatrixRow, field: 'policy_ref' | 'ica_ref' | 'apa_ref') => {
    const next = window.prompt(`Edit ${field} for ${r.txn_label}`, (r[field] as string) ?? '');
    if (next === null) return;
    try {
      await api.mdPutOverlay(r.ctx_id, { [field]: next, actor: user.id } as never);
      toast.show('Overlay updated — audited', 'success');
      load();
    } catch (e) {
      toast.show(`Update failed: ${String(e)}`, 'error');
    }
  };

  if (rows === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Paper variant="outlined">
      <Stack direction="row" alignItems="center" sx={{ p: 2, pb: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Master transaction matrix</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            One row per covered transaction. Grey = SAP-derived (drill to source); tinted = editable TP overlay (audited).
          </Typography>
        </Box>
        <Button size="small" startIcon={<PrintIcon />} onClick={() => window.print()}>Export</Button>
      </Stack>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ whiteSpace: 'nowrap' }}>
          <TableHead>
            <TableRow>
              <TableCell>Transaction</TableCell><TableCell>Payer (role)</TableCell><TableCell>Tested (role)</TableCell>
              <TableCell>Method</TableCell><TableCell sx={{ bgcolor: OVERLAY }}>PLI · actual vs range</TableCell><TableCell>Status</TableCell>
              <TableCell sx={{ bgcolor: OVERLAY }}>Policy</TableCell><TableCell sx={{ bgcolor: OVERLAY }}>ICA</TableCell><TableCell sx={{ bgcolor: OVERLAY }}>APA</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const s = STATUS[r.status];
              const range = r.lower != null ? `${r.lower}–${r.upper}${r.unit ?? ''}` : '—';
              const actual = r.actual != null ? `${r.actual}${r.unit ?? ''} vs ` : '';
              return (
                <TableRow key={r.ctx_id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{r.txn_label}</TableCell>
                  <TableCell>{r.payer.name} <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>({r.payer.role})</Typography></TableCell>
                  <TableCell
                    onClick={() => setDrill({ id: r.tested.rbukrs, name: r.tested.name })}
                    sx={{ cursor: 'pointer', color: '#2563EB' }}
                  >
                    {r.tested.name} <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>({r.tested.role})</Typography>
                  </TableCell>
                  <TableCell>{r.method}</TableCell>
                  <TableCell sx={{ bgcolor: OVERLAY }}>{actual}{range}</TableCell>
                  <TableCell><Chip size="small" label={s.label} sx={{ bgcolor: s.color, color: 'white', height: 20, fontWeight: 700 }} /></TableCell>
                  <TableCell sx={{ bgcolor: OVERLAY, cursor: 'pointer' }} onClick={() => editOverlay(r, 'policy_ref')}>{r.policy_ref ?? '✎'}</TableCell>
                  <TableCell sx={{ bgcolor: OVERLAY, cursor: 'pointer' }} onClick={() => editOverlay(r, 'ica_ref')}>{r.ica_ref ?? '✎'}</TableCell>
                  <TableCell sx={{ bgcolor: OVERLAY, cursor: 'pointer' }} onClick={() => editOverlay(r, 'apa_ref')}>{r.apa_ref ?? '✎'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
      <DrillDrawer open={!!drill} onClose={() => setDrill(null)} entityId={drill?.id} entityName={drill?.name} />
    </Paper>
  );
}
```

- [ ] **Step 2: Verify compile + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/master-data/TransactionMatrix.tsx
git commit -m "feat(md): transaction matrix view (overlay edit, drill, export)"
```

---

# Phase MD-3 — Inbound mapping

## Task 14: Inbound mapping wizard + workspace audit view

**Files:**
- Create: `src/features/master-data/useMappingWorkflow.ts`
- Modify: `src/features/master-data/InboundMapping.tsx`
- Modify: `src/features/master-data/MasterDataAudit.tsx`

- [ ] **Step 1: Implement `useMappingWorkflow.ts`** (per-item: propose → submit → approve)

```ts
import { useState } from 'react';
import { api } from '@/shared/api/client';
import { useToast } from '@/shared/providers/DataProvider';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import type { MdProposal } from '@/shared/api/types';

export function useMappingWorkflow(onChange?: () => void) {
  const user = useSessionUser();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Record<string, MdProposal>>({});

  const propose = async (id: string) => {
    setBusyId(id);
    try {
      const p = await api.mdPropose(id);
      setProposal((m) => ({ ...m, [id]: p }));
    } catch (e) {
      toast.show(`Propose failed: ${String(e)}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const submit = async (id: string) => {
    setBusyId(id);
    try {
      await api.mdSubmitMapping(id, user.id);
      toast.show('Submitted for review', 'success');
      onChange?.();
    } catch (e) {
      toast.show(`Submit failed: ${String(e)}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const approve = async (id: string) => {
    setBusyId(id);
    try {
      await api.mdApproveMapping(id, user.id);
      toast.show('Approved & applied — audited', 'success');
      onChange?.();
    } catch (e) {
      toast.show(`Approve failed (maker cannot self-approve): ${String(e)}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return { busyId, proposal, propose, submit, approve, user };
}
```

- [ ] **Step 2: Implement `InboundMapping.tsx`** (queue + per-item agentic propose → hand-off → submit → approve; "Simulate SAP delta")

```tsx
import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import type { MdStagingItem } from '@/shared/api/types';
import { useMappingWorkflow } from './useMappingWorkflow';

const STATUS_COLOR: Record<string, string> = {
  unmapped: '#D97706', proposed: '#7C3AED', in_review: '#2563EB', applied: '#16A34A', rejected: '#DC2626',
};

export default function InboundMapping({ onChange }: { onChange?: () => void }) {
  const [items, setItems] = useState<MdStagingItem[] | null>(null);
  const refresh = () => api.mdStaging().then(setItems).catch(() => setItems([]));
  useEffect(() => { refresh(); }, []);
  const wf = useMappingWorkflow(() => { refresh(); onChange?.(); });

  const simulate = async () => { await api.mdSimulate(); refresh(); };

  if (items === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center">
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Inbound SAP mapping</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Unrecognised SAP items, characterised with AI assistance and applied only after human sign-off.
          </Typography>
        </Box>
        <Button variant="outlined" size="small" onClick={simulate}>⟳ Simulate SAP delta</Button>
      </Stack>

      {items.length === 0 && <Alert severity="success">All caught up — no unmapped items.</Alert>}

      {items.map((it) => {
        const p = wf.proposal[it.id];
        const proposed = p?.proposed ?? it.proposed;
        return (
          <Paper key={it.id} variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Chip size="small" label={it.kind} />
              <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>{JSON.stringify(it.raw)}</Typography>
              <Chip size="small" label={it.status} sx={{ bgcolor: STATUS_COLOR[it.status], color: 'white', height: 20 }} />
            </Stack>

            {proposed && (
              <Box sx={{ mt: 1.5 }}>
                <AgenticHandoffMarker summary={(p?.rationale ?? it.rationale) || 'Research Brain proposed a mapping.'} />
                <Table size="small" sx={{ mt: 1, maxWidth: 520 }}>
                  <TableBody>
                    {Object.entries(proposed).map(([k, v]) => (
                      <TableRow key={k}>
                        <TableCell sx={{ color: 'text.secondary', width: 180 }}>{k}</TableCell>
                        <TableCell sx={{ bgcolor: '#FAF5FF', fontWeight: 600 }}>{String(v)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {p?.confidence && <Typography variant="caption" sx={{ color: 'text.secondary' }}>Confidence: {p.confidence}{p.live ? ' · live' : ' · offline'}</Typography>}
              </Box>
            )}

            <Stack direction="row" spacing={1.5} sx={{ mt: 1.5 }}>
              {it.status === 'unmapped' && (
                <Button variant="contained" disabled={wf.busyId === it.id} onClick={() => wf.propose(it.id)}
                  startIcon={wf.busyId === it.id ? <CircularProgress size={16} color="inherit" /> : undefined}>
                  🧠 Propose mapping
                </Button>
              )}
              {(it.status === 'proposed' || (proposed && it.status === 'unmapped')) && (
                <Button variant="contained" disabled={wf.busyId === it.id} onClick={() => wf.submit(it.id)}>Submit for review →</Button>
              )}
              {it.status === 'in_review' && (
                <Button variant="contained" color="success" disabled={wf.busyId === it.id} onClick={() => wf.approve(it.id)}>
                  Approve &amp; apply (as {wf.user.name})
                </Button>
              )}
            </Stack>
            {it.status === 'in_review' && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                Maker {it.maker} submitted. A different reviewer must approve (switch role from the avatar). The AI can never be the checker.
              </Typography>
            )}
          </Paper>
        );
      })}
    </Stack>
  );
}
```

- [ ] **Step 3: Implement `MasterDataAudit.tsx`** (reuses `useAudit` against the workspace's synthetic process id)

```tsx
import {
  Box, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography, Button,
} from '@mui/material';
import { useAudit } from '@/kernel/audit/useAudit';

export default function MasterDataAudit() {
  const { events, loading, verify, runVerify } = useAudit({ processId: 'MASTER-DATA' });
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  return (
    <Paper variant="outlined">
      <Stack direction="row" alignItems="center" sx={{ p: 2, pb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>Master data audit</Typography>
        <Button size="small" onClick={runVerify}>Verify chain</Button>
        {verify && <Chip size="small" label={verify.ok ? 'Chain OK' : `Broken @ ${verify.broken_at}`} color={verify.ok ? 'success' : 'error'} sx={{ ml: 1 }} />}
      </Stack>
      <Table size="small">
        <TableHead>
          <TableRow><TableCell>When</TableCell><TableCell>Actor</TableCell><TableCell>Event</TableCell><TableCell>Record</TableCell></TableRow>
        </TableHead>
        <TableBody>
          {events.map((e) => (
            <TableRow key={e.id} hover>
              <TableCell><Typography variant="caption">{new Date(e.ts).toLocaleString()}</Typography></TableCell>
              <TableCell>{e.actor} <Chip size="small" label={e.actor_kind} sx={{ height: 16, ml: 0.5 }} /></TableCell>
              <TableCell>{e.event_type}</TableCell>
              <TableCell><Typography variant="caption" sx={{ color: 'text.secondary' }}>{e.record_ref}</Typography></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}
```

- [ ] **Step 4: Verify compile + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Manual end-to-end check** (start the dev stack)

Run: `./scripts/dev.sh` then open `http://localhost:5173/master-data/mapping`. Confirm: the three seeded items show; **Propose mapping** on SAP-3500 shows the hand-off marker + LRD proposal; **Submit for review** (as operator); switch role to reviewer (top-right avatar); **Approve & apply**; the entity tab now lists 3500 as LRD; the Audit tab shows `prepared (assistant) → submitted → approved/posted` and **Verify chain** = OK. Try approving as the same user who submitted → toast error (maker cannot self-approve).

- [ ] **Step 6: Commit**

```bash
git add src/features/master-data/useMappingWorkflow.ts src/features/master-data/InboundMapping.tsx src/features/master-data/MasterDataAudit.tsx
git commit -m "feat(md): inbound mapping wizard + workspace audit view"
```

---

# Phase MD-4 — Polish & ops

## Task 15: Home entry, DEMO.md, full verification, pristine reset

**Files:**
- Modify: `src/kernel/home/OperatingCadenceHome.tsx`
- Modify: `DEMO.md`

- [ ] **Step 1: Make master data the front of the cycle in `OperatingCadenceHome.tsx`** — prepend the stage and bump the current index

```tsx
const CYCLE = ['Master data', 'Set rates', 'Charge & invoice', 'Monitor margins', 'Adjust & true-up', 'Reserve & provision'];
const CURRENT = 3; // demo period sits in monitoring / adjustment (was 2 before the Master data stage)
```

- [ ] **Step 2: Add a quick-link to the workspace** — in `OperatingCadenceHome.tsx`, add a button near the lifecycle stepper (place it after the `<LifecycleStepper />` usage in the page body)

```tsx
import { useNavigate } from 'react-router-dom';
// inside the component body:
const navigate = useNavigate();
// in the JSX, below the stepper:
<Button size="small" variant="outlined" onClick={() => navigate('/master-data')} sx={{ mt: 1 }}>
  Open Master Data →
</Button>
```
(If `Button` / `useNavigate` are already imported, don't duplicate the imports.)

- [ ] **Step 3: Verify compile + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Add a Master Data section to `DEMO.md`** — insert after the existing process-library bullet in "The walkthrough"

```markdown
0. **Master Data** (`/master-data`) — the front of the cycle. The **matrix** shows
   every covered transaction with its method, PLI/range, country and policy / ICA /
   APA references (grey = SAP, tinted = editable TP overlay; cells drill to source).
   **Entities** are defined at entity × function grain (a multi-hat entity has a row
   per function); **Transactions** define each type's method + benchmark. Under
   **Inbound mapping**, a seeded SAP delta (new entity 3500, a GL account, a new
   transaction) is characterised by the Research Brain → you review the proposal →
   submit → switch role to approve (maker ≠ checker; AI is never the checker) → the
   entity joins the master, all on the audit trail. **Simulate SAP delta** pushes
   another item live.
```

- [ ] **Step 5: Full backend suite + frontend build (final gate)**

Run: `cd backend && ../.venv/bin/python -m pytest -q && cd .. && npm run typecheck && npm run build`
Expected: all PASS.

- [ ] **Step 6: Pristine demo reset**

Run: `cd backend && ../.venv/bin/python -m state.migrate --reset`
Expected: prints `demo state reset → …`; the master-data overlay + staging are re-seeded; `GET /api/audit/verify` → `{ok: true}` after restart.

- [ ] **Step 7: Commit**

```bash
git add src/kernel/home/OperatingCadenceHome.tsx DEMO.md
git commit -m "feat(md): home entry point + demo runbook for master data"
```

---

## Self-review (completed by the plan author)

**Spec coverage:** matrix (Tasks 6, 13) ✓; hybrid SAP-read-only + editable overlay (Tasks 4, 7, 13) ✓; TP function as controlled dimension (Task 1) ✓; function → policy resolution (Task 1, 6) ✓; entity × function multiplicity (Tasks 2, 6, 11) ✓; agentic staging w/ AI propose + no auto-apply + maker-checker + AI-never-checker (Tasks 5, 8, 14) ✓; seeded batch + simulate (Tasks 2, 8, 14) ✓; top-level workspace + nav + Home entry (Tasks 10, 15) ✓; audit on every mutation + chain-verify (Tasks 4, 8, 14) ✓; reuse of state/audit/review/research_brain/kernel primitives ✓; tests across resolution, multiplicity, overlay-audit, full mapping flow, maker-checker guards ✓; DEMO.md + reset (Task 15) ✓.

**Deferred per spec non-goals (intentional, not gaps):** real SAP integration (simulated); bi-temporal/time-travel UI (effective-date fields exist in seeds only); new covered-transaction *rows* auto-created from an onboarded entity (the entity joins the master; wiring its flows is follow-on); account/transaction mappings are recorded in `md_mapping` + audited but don't synthesise matrix rows.

**Type consistency:** `resolve()` keys (`lower/median/upper/unit/method/pli`) match `matrix()` and `MdMatrixRow`; `mdPutOverlay`/`OverlayIn` fields align; staging status strings match across backend + `MdStagingItem`; `record_ref` conventions (`mdctx:`, `mdent:`, `mdmap:`) are consistent; `process_id="MASTER-DATA"` matches the `MasterDataAudit` `useAudit({processId:'MASTER-DATA'})`.
