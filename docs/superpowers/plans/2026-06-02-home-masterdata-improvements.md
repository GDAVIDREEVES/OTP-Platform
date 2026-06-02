# Home & Master Data Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Home lifecycle stepper clickable with the real close-cycle stages; derive the entity master's participation from the covered transactions; and make the transaction matrix = planned covered transactions **+** unplanned intercompany flows auto-detected from actuals (surfaced as `unmapped`, mapped through the existing Inbound pipeline).

**Architecture:** Frontend tweaks to `OperatingCadenceHome` + `EntityMaster` + `TransactionMatrix` + `InboundMapping`; backend additions to `state/master_data.py` (participation, unplanned detection, matrix union, apply for a new `unplanned_transaction` kind), `services/mapping_ai.py` (proposal for that kind), `routers/master_data.py` (a `promote` endpoint), one new seed item. Reuses `md_mapping`/`md_overlay`/`md_staging`, `review`, `audit`, `useMappingWorkflow` — **no new SQLite tables**.

**Tech Stack:** FastAPI + DuckDB/Parquet + stdlib sqlite3; React 18 + MUI 5 + React Router 6 + Vite; pytest + FastAPI TestClient (backend); `npm run typecheck` + `npm run build` (frontend).

**Spec:** `docs/superpowers/specs/2026-06-02-home-masterdata-improvements-design.md`

**Branch:** work on `demo-readiness` (current). All backend commands from `backend/` via `../.venv/bin/python -m pytest`; frontend from repo root.

---

## File structure

- **Modify (frontend):** `src/kernel/home/OperatingCadenceHome.tsx` (I-1); `src/features/master-data/EntityMaster.tsx` (I-2); `src/features/master-data/TransactionMatrix.tsx`, `src/features/master-data/InboundMapping.tsx` (I-3); `src/shared/api/types.ts`, `src/shared/api/client.ts` (I-2, I-3).
- **Modify (backend):** `backend/state/master_data.py` (I-2 participation; I-3 detection + matrix union + apply); `backend/services/mapping_ai.py` (I-3 proposal); `backend/routers/master_data.py` + `backend/schemas/state.py` (I-3 promote); `backend/seeds/master_data/inbound/sap_delta.v1.json` (I-3 seed).
- **Tests:** extend `backend/tests/test_master_data.py` (participation, matrix union, detection) and `backend/tests/test_master_data_mapping.py` (unplanned map flow, promote).

---

# Phase I-1 — Home clickable close-cycle stepper

## Task 1: Clickable stepper with real stages

**Files:** Modify `src/kernel/home/OperatingCadenceHome.tsx`

- [ ] **Step 1: Replace the `CYCLE`/`CURRENT` constants** (lines 26–27) with route-bearing stages:

```tsx
const CYCLE: { label: string; route: string }[] = [
  { label: 'Master Data', route: '/master-data' },
  { label: 'Price Setting', route: '/process/OTP-3' },
  { label: 'Royalty Calculation', route: '/process/OTP-9' },
  { label: 'Service Allocations', route: '/process/OTP-10' },
  { label: 'Monitor margins', route: '/process/OTP-20' },
  { label: 'Adjust & true-up', route: '/process/OTP-16' },
  { label: 'Reserve & provision', route: '/process/OTP-45' },
];
const CURRENT = 4; // demo period sits in monitoring / adjustment
```

- [ ] **Step 2: Make `LifecycleStepper` clickable** — replace the whole function (lines 41–63) with:

```tsx
function LifecycleStepper() {
  const navigate = useNavigate();
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="overline" sx={{ color: 'text.secondary' }}>Close cycle · FY2026</Typography>
      <Stack direction="row" alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap' }}>
        {CYCLE.map((step, i) => {
          const done = i < CURRENT;
          const active = i === CURRENT;
          const color = active ? tokens.action : done ? tokens.ok : '#CBD5E1';
          return (
            <Box key={step.label} sx={{ display: 'flex', alignItems: 'center', flex: i < CYCLE.length - 1 ? 1 : '0 0 auto', minWidth: 0 }}>
              <Stack
                direction="row" spacing={0.75} alignItems="center"
                onClick={() => navigate(step.route)}
                sx={{ minWidth: 0, cursor: 'pointer', borderRadius: 1, p: 0.5, '&:hover': { bgcolor: '#F1F5F9' } }}
              >
                <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{i + 1}</Box>
                <Typography variant="body2" noWrap sx={{ fontWeight: active ? 700 : 500, color: active ? 'text.primary' : 'text.secondary' }}>{step.label}</Typography>
              </Stack>
              {i < CYCLE.length - 1 && <Box sx={{ flex: 1, height: 2, bgcolor: i < CURRENT ? tokens.ok : '#E2E8F0', mx: 1 }} />}
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}
```

- [ ] **Step 3: Remove the now-redundant "Open Master Data" button** — delete lines 223–225 (the `<Button ... onClick={() => navigate('/master-data')}>Open Master Data →</Button>`). The first stepper node now covers it. Leave the `const navigate = useNavigate();` on line 212 (still used by child sections? No — verify: the default export `OperatingCadenceHome` uses `navigate` only for that button). After deleting the button, also remove the now-unused `const navigate = useNavigate();` from the `OperatingCadenceHome` body (line 212) **only if** nothing else in that function uses it. (Child components `OperatorHome`, `ReviewerHome`, `DirectorHome`, `ResumeSurface` each have their own `useNavigate`.)

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: both PASS. (If tsc flags an unused `navigate`/`useNavigate`, remove that line per Step 3.)

- [ ] **Step 5: Commit**

```bash
git add src/kernel/home/OperatingCadenceHome.tsx
git commit -m "feat(home): clickable close-cycle stepper with real stages"
```

---

# Phase I-2 — Entity master "Participates in" (derived)

## Task 2: `entity_participation()` + `entity_master.participates_in`

**Files:** Modify `backend/state/master_data.py`; Test `backend/tests/test_master_data.py`

- [ ] **Step 1: Write the failing test** — append to `backend/tests/test_master_data.py`:

```python
def test_entity_participation_derives_from_covered(state_db):
    md.seed_if_empty()
    part = md.entity_participation()
    # 3000 (Germany) is payer on royalty + distribution flows and the SVC tested party
    assert "Royalty — patented API" in part["3000"]
    assert "Distribution (LRD)" in part["3000"]
    # entity_master rows expose participates_in
    rows = md.entity_master()
    de = [r for r in rows if r["rbukrs"] == "3000"][0]
    assert de["participates_in"] == part["3000"]
```

- [ ] **Step 2: Run, expect FAILURE**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data.py::test_entity_participation_derives_from_covered -q`
Expected: FAIL — `AttributeError: ... 'entity_participation'`.

- [ ] **Step 3: Add `entity_participation()`** to `backend/state/master_data.py` (place it right after `_covered_seed()`, ~line 329; it may reference `_planned_covered` which is added in Task 5 — for now derive from `_covered_seed()` and update in Task 5). Use this version, which depends only on `_covered_seed()` + `transaction_types()`:

```python
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
    """Covered transactions feeding participation. Task 5 extends this to include
    mapped-unplanned; for now it's the planned seed."""
    return _covered_seed()
```

- [ ] **Step 4: Add `participates_in` to `entity_master()`** — replace `entity_master()` (lines 310–323) with:

```python
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
```

- [ ] **Step 5: Run, expect PASS** + full suite

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data.py -q && ../.venv/bin/python -m pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/state/master_data.py backend/tests/test_master_data.py
git commit -m "feat(md): entity participation derived from covered transactions"
```

## Task 3: Entity master frontend column → "Participates in"

**Files:** Modify `src/shared/api/types.ts`, `src/features/master-data/EntityMaster.tsx`

- [ ] **Step 1: Add `participates_in` to `MdEntityRow`** in `src/shared/api/types.ts` — inside the `MdEntityRow` interface, after `applies_to: string[];` add:

```ts
  participates_in: string[];
```

- [ ] **Step 2: Render the derived column** in `src/features/master-data/EntityMaster.tsx`. Change the last header cell from "Applies to" to "Participates in":

```tsx
            <TableCell sx={{ bgcolor: OVERLAY }}>Participates in</TableCell>
```

And change the last body cell (the one rendering `r.applies_to`) to render `r.participates_in` once per entity group (only on the first row, `i === 0`):

```tsx
                <TableCell sx={{ bgcolor: OVERLAY }}>{i === 0 ? r.participates_in.map((a) => <Chip key={a} size="small" label={a} sx={{ mr: 0.5, mb: 0.5, height: 20 }} />) : ''}</TableCell>
```

(The header text and that one cell are the only changes; the rest of the table is unchanged.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/api/types.ts src/features/master-data/EntityMaster.tsx
git commit -m "feat(md): entity master shows derived participation"
```

---

# Phase I-3 — Planned + unplanned matrix

## Task 4: Seed one guaranteed unplanned flow

**Files:** Modify `backend/seeds/master_data/inbound/sap_delta.v1.json`

- [ ] **Step 1: Add an `unplanned_transaction` item** to the `items` array (the entity-pair 3300↔3400 is NOT in any planned covered transaction, so it's genuinely unplanned). New full file:

```json
{
  "version": "1",
  "items": [
    { "id": "SAP-3500", "kind": "entity",      "raw": { "rbukrs": "3500", "name": "Spain Distribution Co.", "currency": "EUR", "country_hint": "Spain" } },
    { "id": "SAP-417000", "kind": "account",   "raw": { "account": "417000", "text": "Royalty expense - trademark" } },
    { "id": "SAP-CRD", "kind": "transaction",  "raw": { "label": "Contract R&D services", "payer_rbukrs": "3000", "payee_rbukrs": "4100" } },
    { "id": "UNPL-3300-3400", "kind": "unplanned_transaction", "raw": { "payer_rbukrs": "3300", "counterparty_rbukrs": "3400", "label": "Intra-group services - shared service charge", "amount": 1850000.0 } }
  ]
}
```

- [ ] **Step 2: Verify JSON parses**

Run: `cd backend && ../.venv/bin/python -c "import json; json.load(open('seeds/master_data/inbound/sap_delta.v1.json'))" && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add backend/seeds/master_data/inbound/sap_delta.v1.json
git commit -m "feat(md): seed one unplanned intercompany flow for the matrix"
```

## Task 5: Matrix = planned + unplanned (detection + union)

**Files:** Modify `backend/state/master_data.py`; Test `backend/tests/test_master_data.py`

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_master_data.py`:

```python
def test_unplanned_pairs_excludes_planned():
    planned = {frozenset(("3000", "3100")), frozenset(("3200", "3400"))}
    actual = {frozenset(("3000", "3100")), frozenset(("3300", "3400"))}
    assert md._unplanned_pairs(actual, planned) == {frozenset(("3300", "3400"))}


def test_matrix_includes_seeded_unplanned_as_unmapped(state_db):
    md.seed_if_empty()
    rows = md.matrix()
    unmapped = [r for r in rows if r["status"] == "unmapped"]
    assert any(r["staging_id"] == "UNPL-3300-3400" for r in unmapped)
    u = [r for r in unmapped if r["staging_id"] == "UNPL-3300-3400"][0]
    assert u["planned"] is False and u["method"] is None and u["actual_amount"] == 1850000.0
    # planned rows still present + mapped
    assert any(r["ctx_id"] == "CTX-DIST-FR" and r["status"] != "unmapped" for r in rows)
```

- [ ] **Step 2: Run, expect FAILURE**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data.py::test_matrix_includes_seeded_unplanned_as_unmapped -q`
Expected: FAIL (`_unplanned_pairs` missing / no unmapped rows).

- [ ] **Step 3: Add `from db import q`** to the imports in `backend/state/master_data.py` (with the other top imports, after `from period_filter import PeriodFilter`):

```python
from db import q
```

- [ ] **Step 4: Replace `matrix()`** (lines 376–409) with the helper-based version below, and add the helpers above it:

```python
def _party(rbukrs: str) -> dict[str, Any]:
    return {"rbukrs": rbukrs, "name": _identity(rbukrs)["display_name"], "role": _entity_role(rbukrs)}


def _pair(a: str, b: str) -> frozenset:
    return frozenset((a, b))


def _entity_set() -> set[str]:
    s = set(_entity_dim().keys())
    s |= {e["rbukrs"] for e in onboarded_entities() if e.get("rbukrs")}
    return s


def mapped_unplanned() -> list[dict[str, Any]]:
    """Covered transactions created by mapping an unplanned flow (from md_mapping)."""
    rows = get_conn().execute(
        "SELECT canonical_json FROM md_mapping WHERE kind='unplanned_transaction'"
    ).fetchall()
    out = []
    for r in rows:
        c = json.loads(r["canonical_json"])
        if c.get("ctx_id") and c.get("txn_type_id"):
            out.append({**c, "planned": False})
    return out


def _planned_covered() -> list[dict[str, Any]]:
    """The covered transactions that count as 'planned coverage': the curated seed
    plus any unplanned flow already mapped into a covered transaction."""
    return [{**c, "planned": True} for c in _covered_seed()] + mapped_unplanned()


def _covered_row(c: dict[str, Any]) -> dict[str, Any]:
    tt = type_with_range(c["txn_type_id"]) or {}
    ov = get_overlay(c["ctx_id"]) or {}
    lower, upper = tt.get("lower"), tt.get("upper")
    status, actual = "na", None
    if tt.get("method") == "TNMM":
        actual = _actual_margin(c["tested_rbukrs"])
        if actual is not None and lower is not None and upper is not None:
            status = "in_range" if lower <= actual <= upper else "review"
    return {
        "ctx_id": c["ctx_id"], "txn_type_id": c["txn_type_id"], "txn_label": tt.get("label"),
        "category": tt.get("category"), "method": tt.get("method"), "pli": tt.get("pli"),
        "lower": lower, "median": tt.get("median"), "upper": upper, "unit": tt.get("unit"),
        "actual": actual, "status": status, "planned": c.get("planned", True),
        "actual_amount": None, "flow_id": None, "staging_id": None,
        "oecd_anchor": tt.get("oecd_anchor"),
        "payer": _party(c["payer_rbukrs"]), "payee": _party(c["payee_rbukrs"]), "tested": _party(c["tested_rbukrs"]),
        "policy_ref": ov.get("policy_ref") or c.get("policy_ref"),
        "ica_ref": ov.get("ica_ref") or c.get("ica_ref"),
        "apa_ref": ov.get("apa_ref") or c.get("apa_ref"),
        "benchmark_set_id": tt.get("benchmark_set_id"),
    }


def _unmapped_row(*, ctx_id: str, label: str, payer: str, counterparty: str,
                  amount: float | None, flow_id: str | None, staging_id: str | None) -> dict[str, Any]:
    return {
        "ctx_id": ctx_id, "txn_type_id": None, "txn_label": label, "category": None,
        "method": None, "pli": None, "lower": None, "median": None, "upper": None, "unit": None,
        "actual": None, "status": "unmapped", "planned": False, "actual_amount": amount,
        "flow_id": flow_id, "staging_id": staging_id, "oecd_anchor": None,
        "payer": _party(payer), "payee": _party(counterparty), "tested": _party(payer),
        "policy_ref": None, "ica_ref": None, "apa_ref": None, "benchmark_set_id": None,
    }


def _unplanned_pairs(actual_pairs: set[frozenset], planned_pairs: set[frozenset]) -> set[frozenset]:
    return {p for p in actual_pairs if p not in planned_pairs}


def unplanned_flows() -> list[dict[str, Any]]:
    """Intercompany flows in the actuals (journal) with no planned/mapped coverage
    and not already staged. Read-only. Empty if the sample journal has no IC postings."""
    ents = _entity_set()
    if not ents:
        return []
    ph = ",".join("?" for _ in ents)
    try:
        rows = q(
            f"SELECT RBUKRS, RASSC, SUM(HSL) AS amount FROM journal "
            f"WHERE RASSC IS NOT NULL AND RASSC <> RBUKRS AND RASSC IN ({ph}) AND RBUKRS IN ({ph}) "
            f"GROUP BY RBUKRS, RASSC",
            list(ents) + list(ents),
        )
    except Exception:
        return []
    planned = {_pair(c["payer_rbukrs"], c["payee_rbukrs"]) for c in _planned_covered()}
    staged = {i["id"] for i in list_staging()}
    actual = {_pair(str(r["RBUKRS"]), str(r["RASSC"])): r for r in rows}
    out = []
    for pair in _unplanned_pairs(set(actual.keys()), planned):
        a, b = sorted(list(pair))
        flow_id = f"UNPL-{a}-{b}"
        if flow_id in staged:
            continue
        r = actual[pair]
        out.append({"flow_id": flow_id, "payer_rbukrs": str(r["RBUKRS"]),
                    "counterparty_rbukrs": str(r["RASSC"]), "amount": float(r["amount"] or 0)})
    return out


def matrix() -> list[dict[str, Any]]:
    rows = [_covered_row(c) for c in _planned_covered()]
    for it in list_staging():
        if it["kind"] == "unplanned_transaction" and it["status"] in ("unmapped", "proposed", "in_review"):
            raw = it["raw"]
            rows.append(_unmapped_row(
                ctx_id=f"stg:{it['id']}", label=raw.get("label", "Unplanned transaction"),
                payer=raw.get("payer_rbukrs"), counterparty=raw.get("counterparty_rbukrs"),
                amount=raw.get("amount"), flow_id=None, staging_id=it["id"]))
    for f in unplanned_flows():
        rows.append(_unmapped_row(
            ctx_id=f["flow_id"], label="Unplanned intercompany flow (from actuals)",
            payer=f["payer_rbukrs"], counterparty=f["counterparty_rbukrs"],
            amount=f["amount"], flow_id=f["flow_id"], staging_id=None))
    return rows
```

- [ ] **Step 5: Point participation at `_planned_covered`** — update `_covered_for_participation()` (added in Task 2) so participation includes mapped-unplanned:

```python
def _covered_for_participation() -> list[dict[str, Any]]:
    return _planned_covered()
```

- [ ] **Step 6: Run tests** (the new ones + the existing matrix test from the Master Data feature, which still expects CTX-DIST-FR + CTX-ROY-TM mapped rows)

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data.py -q && ../.venv/bin/python -m pytest -q`
Expected: PASS. (The earlier `test_matrix_endpoint_composes_and_resolves` still passes: planned rows are unchanged; it doesn't assert row count.)

- [ ] **Step 7: Commit**

```bash
git add backend/state/master_data.py backend/tests/test_master_data.py
git commit -m "feat(md): matrix = planned + unplanned (journal detection + union)"
```

## Task 6: Map an unplanned flow → covered transaction (proposal + apply)

**Files:** Modify `backend/services/mapping_ai.py`, `backend/state/master_data.py`; Test `backend/tests/test_master_data_mapping.py`

- [ ] **Step 1: Write the failing test** — append to `backend/tests/test_master_data_mapping.py`:

```python
def test_unplanned_flow_maps_to_covered_transaction(state_db):
    md.seed_if_empty()
    # the seeded unplanned flow shows as unmapped in the matrix
    assert any(r["staging_id"] == "UNPL-3300-3400" for r in md.matrix() if r["status"] == "unmapped")
    # AI proposes a transaction type (label mentions 'service' -> SVC)
    p = api.post("/api/master-data/staging/UNPL-3300-3400/propose").json()
    assert p["proposed"]["txn_type_id"] == "SVC"
    api.post("/api/master-data/staging/UNPL-3300-3400/submit", json={"maker": "u_maria"})
    api.post("/api/master-data/staging/UNPL-3300-3400/approve", json={"checker": "u_sam"})
    # now it's a MAPPED covered transaction in the matrix, no longer unmapped
    rows = md.matrix()
    assert not any(r["staging_id"] == "UNPL-3300-3400" for r in rows if r["status"] == "unmapped")
    mapped = [r for r in rows if r["ctx_id"] == "CTX-UNPL-3300-3400"]
    assert mapped and mapped[0]["txn_type_id"] == "SVC" and mapped[0]["method"] == "TNMM"
    assert api.get("/api/audit/verify").json()["ok"] is True
```

(`api`, `md` are already imported at the top of `test_master_data_mapping.py`.)

- [ ] **Step 2: Run, expect FAILURE**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data_mapping.py::test_unplanned_flow_maps_to_covered_transaction -q`
Expected: FAIL (propose returns `txn_type_id: None`; no mapped row).

- [ ] **Step 3: Add the `unplanned_transaction` branch to `propose_mapping`** in `backend/services/mapping_ai.py` — insert this `elif` before the `else:` (after the `transaction` branch, ~line 109):

```python
    elif kind == "unplanned_transaction":
        code = _match(str(raw.get("label", "")), _TXN_KEYWORDS)
        out = {
            "proposed": {"txn_type_id": code, "tested_rbukrs": raw.get("payer_rbukrs")} if code else {"txn_type_id": None},
            "confidence": "Medium" if code else "Low",
            "rationale": (
                f"Unexpected IC flow {raw.get('payer_rbukrs')}→{raw.get('counterparty_rbukrs')} "
                f"'{raw.get('label')}' best matches transaction type {code}; assign policy / ICA / APA on review."
                if code else f"Could not classify the unexpected flow '{raw.get('label')}'; assign a transaction type."
            ),
        }
```

- [ ] **Step 4: Rework `apply_mapping`** in `backend/state/master_data.py` (lines 220–247) so it builds a kind-specific canonical payload and, for `unplanned_transaction`, creates a covered transaction. Replace the function with:

```python
def apply_mapping(item_id: str, *, applied_by: str) -> dict[str, Any]:
    """Persist the approved mapping to the master and the mapping ledger; audit it."""
    with LOCK:
        conn = get_conn()
        item = get_staging(item_id)
        if item is None:
            raise ValueError(f"no staging item {item_id}")
        kind = item["kind"]
        raw = item["raw"]
        proposed = item.get("proposed") or {}
        canonical: dict[str, Any] = dict(proposed)
        if kind == "unplanned_transaction" and proposed.get("txn_type_id"):
            canonical = {
                "ctx_id": f"CTX-{item_id}", "txn_type_id": proposed["txn_type_id"],
                "payer_rbukrs": raw.get("payer_rbukrs"), "payee_rbukrs": raw.get("counterparty_rbukrs"),
                "tested_rbukrs": proposed.get("tested_rbukrs") or raw.get("payer_rbukrs"),
                "policy_ref": proposed.get("policy_ref"), "ica_ref": proposed.get("ica_ref"),
                "apa_ref": proposed.get("apa_ref"),
            }
        conn.execute(
            "INSERT INTO md_mapping (kind, raw_key, canonical_json, applied_by, applied_at) VALUES (?, ?, ?, ?, ?)",
            (kind, json.dumps(raw, sort_keys=True), json.dumps(canonical), applied_by, _now()),
        )
        if kind == "entity" and proposed.get("tp_function_code"):
            conn.execute(
                "INSERT INTO md_entity_function (rbukrs, tp_function_code, is_primary, tested_party, applies_to, status, created_at) "
                "VALUES (?, ?, 1, ?, ?, 'active', ?)",
                (raw["rbukrs"], proposed["tp_function_code"],
                 int(bool(proposed.get("tested_party"))),
                 json.dumps(proposed.get("applies_to") or []), _now()),
            )
        if kind == "unplanned_transaction" and canonical.get("ctx_id"):
            conn.execute(
                "INSERT OR IGNORE INTO md_overlay (ctx_id, policy_ref, ica_ref, apa_ref, updated_at) VALUES (?, ?, ?, ?, ?)",
                (canonical["ctx_id"], canonical.get("policy_ref"), canonical.get("ica_ref"),
                 canonical.get("apa_ref"), _now()),
            )
        conn.execute("UPDATE md_staging SET status='applied', updated_at=? WHERE id=?", (_now(), item_id))
        conn.commit()
        audit.record(
            actor=applied_by, actor_kind="human", process_id="MASTER-DATA",
            record_ref=f"mdmap:{item_id}", event_type="posted", after=canonical,
        )
    return {"id": item_id, "status": "applied"}
```

- [ ] **Step 5: Run tests, expect PASS** + full suite

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data_mapping.py -q && ../.venv/bin/python -m pytest -q`
Expected: PASS. (The existing entity-mapping flow test still passes — the `entity` branch is unchanged in behavior.)

- [ ] **Step 6: Commit**

```bash
git add backend/services/mapping_ai.py backend/state/master_data.py backend/tests/test_master_data_mapping.py
git commit -m "feat(md): map an unplanned flow into a covered transaction"
```

## Task 7: `promote` endpoint (stage a live-detected flow)

**Files:** Modify `backend/schemas/state.py`, `backend/routers/master_data.py`; Test `backend/tests/test_master_data_mapping.py`

- [ ] **Step 1: Write the failing test** — append to `backend/tests/test_master_data_mapping.py`:

```python
def test_promote_stages_a_detected_flow(state_db):
    md.seed_if_empty()
    r = api.post("/api/master-data/staging/promote", json={
        "flow_id": "UNPL-1000-4100", "payer_rbukrs": "1000",
        "counterparty_rbukrs": "4100", "label": "Unplanned IC flow", "amount": 500000.0})
    assert r.status_code == 200 and r.json()["id"] == "UNPL-1000-4100"
    items = api.get("/api/master-data/staging").json()
    it = [i for i in items if i["id"] == "UNPL-1000-4100"][0]
    assert it["kind"] == "unplanned_transaction" and it["status"] == "unmapped"
```

- [ ] **Step 2: Run, expect FAILURE**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data_mapping.py::test_promote_stages_a_detected_flow -q`
Expected: FAIL — 404/422 (endpoint absent).

- [ ] **Step 3: Add `PromoteFlowIn`** to `backend/schemas/state.py` (append):

```python
class PromoteFlowIn(BaseModel):
    flow_id: str
    payer_rbukrs: str
    counterparty_rbukrs: str
    label: str | None = None
    amount: float | None = None
```

- [ ] **Step 4: Add the endpoint** to `backend/routers/master_data.py` — extend the schemas import on line 7 to include `PromoteFlowIn`:

```python
from schemas.state import EntityFunctionIn, MappingDecisionIn, MappingSubmitIn, OverlayIn, PromoteFlowIn
```

Then add (after the `staging()` endpoint, before `simulate()`):

```python
@router.post("/api/master-data/staging/promote")
def promote(body: PromoteFlowIn):
    md.add_staging_batch([{
        "id": body.flow_id,
        "kind": "unplanned_transaction",
        "raw": {
            "payer_rbukrs": body.payer_rbukrs,
            "counterparty_rbukrs": body.counterparty_rbukrs,
            "label": body.label or "Unplanned intercompany flow",
            "amount": body.amount,
        },
    }])
    return {"id": body.flow_id, "status": "unmapped"}
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_master_data_mapping.py -q && ../.venv/bin/python -m pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/schemas/state.py backend/routers/master_data.py backend/tests/test_master_data_mapping.py
git commit -m "feat(md): promote endpoint to stage a detected unplanned flow"
```

## Task 8: Frontend types + client for unplanned

**Files:** Modify `src/shared/api/types.ts`, `src/shared/api/client.ts`

- [ ] **Step 1: Relax/extend `MdMatrixRow`** in `src/shared/api/types.ts` — replace the `MdMatrixRow` interface with (unmapped rows carry nulls; new flags added):

```ts
export interface MdMatrixRow {
  ctx_id: string;
  txn_type_id: string | null;
  txn_label: string | null;
  category: string | null;
  method: string | null;
  pli: string | null;
  lower: number | null;
  median: number | null;
  upper: number | null;
  unit: string | null;
  actual: number | null;
  status: 'in_range' | 'review' | 'na' | 'unmapped';
  planned: boolean;
  actual_amount: number | null;
  flow_id: string | null;
  staging_id: string | null;
  oecd_anchor: string | null;
  payer: MdMatrixParty;
  payee: MdMatrixParty;
  tested: MdMatrixParty;
  policy_ref: string | null;
  ica_ref: string | null;
  apa_ref: string | null;
  benchmark_set_id: string | null;
}
```

- [ ] **Step 2: Add `unplanned_transaction` to `MdStagingItem.kind`** — change the `kind` union:

```ts
  kind: 'entity' | 'account' | 'transaction' | 'field' | 'unplanned_transaction';
```

- [ ] **Step 3: Add the `mdPromoteFlow` client method** to the `api` object in `src/shared/api/client.ts` (next to `mdSimulate`):

```ts
  mdPromoteFlow: (body: { flow_id: string; payer_rbukrs: string; counterparty_rbukrs: string; label?: string; amount?: number }) =>
    sendJSON<{ id: string; status: string }>('POST', '/api/master-data/staging/promote', body),
```

- [ ] **Step 4: Verify** `npm run typecheck`

Expected: tsc reports errors in `TransactionMatrix.tsx` (because `r.method`/`r.txn_label` are now `string | null`, and `r[field]` indexing). **That is expected** — Task 9 fixes the matrix component. To confirm only-expected errors, check they are all in `TransactionMatrix.tsx`. (Do NOT commit yet; commit after Task 9 so the tree stays green.)

- [ ] **Step 5: (no commit — proceed to Task 9)**

## Task 9: Matrix renders unmapped rows + Map action

**Files:** Modify `src/features/master-data/TransactionMatrix.tsx`

- [ ] **Step 1: Replace `TransactionMatrix.tsx`** entirely with the version below (adds `useNavigate`, the `unmapped` status, the Map action, null-safe cells, and an `Unmapped` chip):

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  unmapped: { label: 'Unmapped', color: '#DC2626' },
};

type OverlayField = 'policy_ref' | 'ica_ref' | 'apa_ref';

export default function TransactionMatrix() {
  const user = useSessionUser();
  const toast = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<MdMatrixRow[] | null>(null);
  const [drill, setDrill] = useState<{ id: string; name: string } | null>(null);

  const load = () => api.mdMatrix().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const editOverlay = async (r: MdMatrixRow, field: OverlayField) => {
    const next = window.prompt(`Edit ${field} for ${r.txn_label}`, (r[field] as string) ?? '');
    if (next === null) return;
    const body: { policy_ref?: string; ica_ref?: string; apa_ref?: string; actor: string } = { actor: user.id };
    body[field] = next;
    try {
      await api.mdPutOverlay(r.ctx_id, body);
      toast.show('Overlay updated — audited', 'success');
      load();
    } catch (e) {
      toast.show(`Update failed: ${String(e)}`, 'error');
    }
  };

  const mapRow = async (r: MdMatrixRow) => {
    try {
      let sid = r.staging_id;
      if (!sid && r.flow_id) {
        const res = await api.mdPromoteFlow({
          flow_id: r.flow_id, payer_rbukrs: r.payer.rbukrs, counterparty_rbukrs: r.payee.rbukrs,
          label: r.txn_label ?? undefined, amount: r.actual_amount ?? undefined,
        });
        sid = res.id;
      }
      if (sid) navigate(`/master-data/mapping?focus=${encodeURIComponent(sid)}`);
    } catch (e) {
      toast.show(`Could not open mapping: ${String(e)}`, 'error');
    }
  };

  if (rows === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Paper variant="outlined">
      <Stack direction="row" alignItems="center" sx={{ p: 2, pb: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Master transaction matrix</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Planned covered transactions + unplanned flows detected from actuals (red = unmapped → Map it). Tinted = editable TP overlay (audited).
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
              const s = STATUS[r.status] ?? STATUS.na;
              if (r.status === 'unmapped') {
                return (
                  <TableRow key={r.ctx_id} hover sx={{ bgcolor: '#FEF2F2' }}>
                    <TableCell sx={{ fontWeight: 600 }}>{r.txn_label}</TableCell>
                    <TableCell>{r.payer.name} <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>({r.payer.role})</Typography></TableCell>
                    <TableCell>{r.payee.name} <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>({r.payee.role})</Typography></TableCell>
                    <TableCell>—</TableCell>
                    <TableCell sx={{ bgcolor: OVERLAY }}>{r.actual_amount != null ? `actual ${Math.round(r.actual_amount).toLocaleString()}` : '—'}</TableCell>
                    <TableCell><Chip size="small" label={s.label} sx={{ bgcolor: s.color, color: 'white', height: 20, fontWeight: 700 }} /></TableCell>
                    <TableCell colSpan={3} sx={{ bgcolor: OVERLAY }}>
                      <Button size="small" variant="contained" onClick={() => mapRow(r)}>Map →</Button>
                    </TableCell>
                  </TableRow>
                );
              }
              const range = r.lower != null ? `${r.lower}–${r.upper}${r.unit ?? ''}` : '—';
              const actual = r.actual != null ? `${r.actual}${r.unit ?? ''} vs ` : '';
              return (
                <TableRow key={r.ctx_id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{r.txn_label}{r.planned ? '' : ' ·mapped'}</TableCell>
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

- [ ] **Step 2: Verify** `npm run typecheck && npm run build`
Expected: both PASS (the Task-8 type errors are now resolved).

- [ ] **Step 3: Commit** (types + client from Task 8 + the matrix)

```bash
git add src/shared/api/types.ts src/shared/api/client.ts src/features/master-data/TransactionMatrix.tsx
git commit -m "feat(md): matrix renders unmapped rows with a Map action"
```

## Task 10: Inbound mapping focuses a promoted item

**Files:** Modify `src/features/master-data/InboundMapping.tsx`

- [ ] **Step 1: Read `?focus` and highlight the matching item.** Edit `InboundMapping.tsx`:
  - Add the import: `import { useSearchParams } from 'react-router-dom';`
  - Inside the component, after `const wf = ...`, add: `const [params] = useSearchParams(); const focus = params.get('focus');`
  - On the per-item `<Paper>` (line 42), make the border highlight when focused — change its props to:

```tsx
          <Paper key={it.id} variant="outlined" sx={{ p: 2, borderColor: it.id === focus ? '#7C3AED' : undefined, borderWidth: it.id === focus ? 2 : 1 }}>
```

- [ ] **Step 2: Verify** `npm run typecheck && npm run build`
Expected: both PASS.

- [ ] **Step 3: Manual end-to-end check.** With the stack running (`./scripts/dev.sh`), reset state (`cd backend && ../.venv/bin/python -m state.migrate --reset`), open `http://localhost:5173/master-data`:
  - **Matrix**: a red **Unmapped** row "Intra-group services - shared service charge" (3300→3400) with a **Map →** button.
  - Click **Map →** → lands on the Inbound tab with that item highlighted → **Propose** (SVC) → **Submit** → switch role (avatar) → **Approve & apply**.
  - Back on **Matrix**: the row is now a mapped covered transaction (CTX-UNPL-3300-3400, method TNMM), no longer red.
  - **Entities**: a participating entity shows the derived "Participates in" types.
  - **Home**: each lifecycle stage navigates to its process.

- [ ] **Step 4: Commit**

```bash
git add src/features/master-data/InboundMapping.tsx
git commit -m "feat(md): inbound mapping highlights a promoted flow via ?focus"
```

---

## Self-review (completed by the plan author)

**Spec coverage:** Home clickable + real stages (Task 1) ✓; OTP-10 stays stub (routes to it, renders informatively) ✓; entity participation derived (Tasks 2–3) ✓; planned set = covered transactions, unplanned auto-detected from journal RASSC (Task 5) ✓; unplanned surfaced as `unmapped` in the matrix (Task 5) ✓; mapped via the Inbound pipeline with maker-checker → covered transaction (Task 6) ✓; read-only detection + `promote` on Map (Tasks 7, 9) ✓; seed one guaranteed unplanned flow (Task 4) ✓; `?focus` (Task 10) ✓; matrix-row fields `planned/actual_amount/flow_id/staging_id` (Tasks 5, 8) ✓; testing per phase ✓.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** backend `matrix()` row keys (incl. `planned`, `actual_amount`, `flow_id`, `staging_id`, nullable `method`/`txn_label`/...) match `MdMatrixRow` (Task 8); `status` adds `'unmapped'` on both sides; `mapped_unplanned()` canonical keys (`ctx_id`, `txn_type_id`, `payer_rbukrs`, `payee_rbukrs`, `tested_rbukrs`, refs) match what `apply_mapping` writes and what `_covered_row` reads; `unplanned_transaction` kind consistent across proposer, apply, seed, promote, and `MdStagingItem`. `entity_participation` returns `dict[str,list[str]]`; `participates_in` is `string[]` in `MdEntityRow`.

**Note on live detection:** if the sample journal has no `RASSC`-populated IC postings, `unplanned_flows()` returns `[]` and only the **seeded** unplanned row shows — which is the intended demo-reliability fallback (Task 4). The `_unplanned_pairs` unit test covers the detection logic deterministically regardless of sample data.
