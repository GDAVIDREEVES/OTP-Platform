# Process Library — Increment 1: Case Workspace (OTP-30/31/40/50)

> Part of the **Top-15 risk-coverage build**. Increment 0 (wiring badge + OTP-23) shipped.
> This is **Increment 1**: one shared **Case Workspace** binding that wires the four
> "case / tracker / playbook" top-15 processes from a single new pattern —
> OTP-40 (TP audit defense & IDR), OTP-50 (MAP filing & negotiation),
> OTP-30 (restructuring / exit charges), OTP-31 (M&A IC-flow integration).
> Increment 2 (CSA pair OTP-5/11) follows separately.

## Goal

Wire OTP-30/31/40/50 to a shared, data-backed **Case Workspace**: a governance-case
tracker (open controversy / restructuring / integration cases) with status, owner,
jurisdiction, due date, exposure, an interactive checklist, and an automatic audit
trail + evidence packet per case. **One** backend `cases` source (mutable SQLite state
+ seed) and **one** shared frontend binding cover all four processes.

## Why this shape

- All four share the catalog pattern *"Case workspace / tracker / playbook"* — they are
  case-managed, not period-computed. One binding object mapped to four ids mirrors the
  existing `otp21 → OTP-21/22/23` and `otp16 → OTP-16/17` precedents
  (`src/kernel/bindings/index.ts`).
- It **reuses infrastructure already present**: the hash-chained audit trail
  (`backend/state/audit.py`), the per-process Audit tab/rail, and the `/evidence/:ref`
  packet — all keyed by `record_ref`. A case logs every mutation to
  `record_ref="case:{id}"`, so its history and evidence packet light up with **no extra
  wiring**.
- Cases are governance objects (not ledger postings), so seeding a handful is
  defensible demo data, not fabricated financials.

## Backend — a `cases` mutable source (SQLite state)

Mutable state lives in SQLite (`backend/state/`), separate from the read-only DuckDB
warehouse. **No period filter applies** (state tables are not period-scoped).

### Data model — `cases` table (DDL appended to `backend/state/schema.sql`)

Typed hot columns for the worklist/KPI queries + a JSON column for the checklist:

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | app-generated, e.g. `CASE-1` |
| `process_id` | `TEXT NOT NULL` | one of OTP-30/31/40/50 |
| `kind` | `TEXT NOT NULL` | `audit_defense \| map \| restructuring \| mna_integration` |
| `title` | `TEXT NOT NULL` | |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | `CHECK (status IN ('open','in_progress','submitted','closed'))` |
| `owner` | `TEXT NOT NULL` | person |
| `counterparty` | `TEXT` | tax authority / competent authorities / acquired entity |
| `jurisdiction` | `TEXT` | country/region label |
| `exposure` | `REAL` | USD exposure (nullable) |
| `opened_at` | `TEXT NOT NULL` | ISO date |
| `due_at` | `TEXT` | ISO date (nullable) |
| `checklist_json` | `TEXT NOT NULL DEFAULT '[]'` | JSON array of `{key,label,done}` |
| `notes` | `TEXT` | nullable |
| `created_at` | `TEXT NOT NULL` | |
| `updated_at` | `TEXT` | |

Plus `CREATE INDEX IF NOT EXISTS ix_cases_process ON cases (process_id);`.

### State module — `backend/state/cases.py` (mirror `backend/state/review.py`)

- `list_cases(process_id=None, status=None) -> list[dict]` — ordered status-urgency then
  `due_at`.
- `get_case(case_id) -> dict | None`.
- `create_case(*, process_id, kind, title, owner, counterparty, jurisdiction, exposure,
  due_at, checklist, actor) -> dict` — insert, then
  `audit.record(actor=actor, actor_kind="human", process_id=process_id,
  record_ref=f"case:{id}", event_type="created", after=record)`.
- `set_status(case_id, status, actor) -> dict` — `ValueError` if the case is missing or
  the status is outside the enum; capture `before`/`after`; `event_type = "submitted"`
  when status→`submitted`, `"posted"` when →`closed`, else `"edited"`.
- `set_checklist_step(case_id, step_key, done, actor) -> dict` — toggle a step inside
  `checklist_json`; log `"edited"` with before/after.
- Helpers at top: `_now()` (ISO-8601 UTC), `_to_dict(row)`, `_DIR`/`_doc` seed loader,
  `seed_if_empty()` (insert seeds when `SELECT count(*) FROM cases == 0`).
- **Output shape:** the dicts returned by `list_cases`/`get_case`/mutators expose
  `checklist` as a **parsed list** (`json.loads(checklist_json)`) and omit the raw
  `checklist_json` column, so the API shape matches the frontend `Case` type directly.

### Request models — `backend/schemas/state.py`

- `CaseIn` (`process_id, kind, title, owner, counterparty?, jurisdiction?, exposure?,
  due_at?, checklist?: list[dict]`)
- `CaseStatusIn` (`status, actor`)
- `CaseStepIn` (`step_key, done, actor`)

### Router — `backend/routers/cases.py` (mirror `backend/routers/review.py`)

- `GET /api/cases?process_id=&status=` → `cases.list_cases(...)`
- `GET /api/cases/{case_id}` → `cases.get_case(...)`; **404** if `None`
- `POST /api/cases` (`CaseIn`) → `cases.create_case(...)`
- `PATCH /api/cases/{case_id}/status` (`CaseStatusIn`) → `set_status`; **404/409** on `ValueError`
- `PATCH /api/cases/{case_id}/checklist` (`CaseStepIn`) → `set_checklist_step`; **404** on `ValueError`

### Seed — `backend/seeds/cases/cases.v1.json`

~6 realistic governance cases across the four processes (USD exposures, 2026 due dates,
3–5 checklist steps each). Loaded by `cases.seed_if_empty()`, which is wired into
`backend/state/migrate.py run()` (`from state import cases; cases.seed_if_empty()`).
`python -m state.migrate --reset` reseeds automatically (reset deletes the DB file, then
`run()` re-applies the schema and re-runs every `seed_if_empty()`).

### Mount — `backend/main.py`

Add `cases` to the `from routers import (...)` block and `cases.router` to the
`include_router` loop.

### Tests — `backend/tests/test_cases.py` (pytest, `state_db` fixture)

Test the state module directly (not HTTP), matching `tests/test_review.py`:
seed populates → `create_case` returns `open` + logs a `created` audit event at
`record_ref="case:..."` → `list_cases` filters by `process_id`/`status` → `set_status`
to `submitted` advances and logs `submitted` → `set_checklist_step` toggles a step and
logs `edited`. Assert audit side-effects via `state.audit.list_events(record_ref=...)`.

## Frontend — shared `CaseWorkspace` binding

### Types — `src/shared/api/types.ts`
```ts
export interface CaseStep { key: string; label: string; done: boolean; }
export interface Case {
  id: string; process_id: string; kind: string; title: string;
  status: 'open' | 'in_progress' | 'submitted' | 'closed';
  owner: string; counterparty: string | null; jurisdiction: string | null;
  exposure: number | null; opened_at: string; due_at: string | null;
  checklist: CaseStep[]; notes: string | null;
}
```

### API client — `src/shared/api/client.ts`
`cases(params)`, `case(id)`, `createCase(body)`, `setCaseStatus(id, {status, actor})`,
`setCaseStep(id, {step_key, done, actor})` — GET via `getJSON`, mutations via `sendJSON`.

### Binding — `src/kernel/bindings/marquee/caseWorkspace.tsx`
- `useCases(processId)` hook: fetch `api.cases({ process_id })` (alive-guard pattern from
  `otp21.tsx`), returning `{ cases, loading, reload }` so mutations can refresh.
- `Kpis`: **Open cases** · **Due ≤ 30d** (`tone:'watch'`) · **Overdue** (`tone:'risk'`) ·
  **Total exposure**.
- `overview` tab: answer-first line ("N open cases · X overdue · $Y exposure for this
  process") + the most urgent cases.
- `worklist` tab: table — Status chip, Title, Owner, Jurisdiction, Due, Exposure, and a
  drill icon that opens the `CaseDrawer`. Header copy + filter keyed by `ctx.def.id`
  (OTP-40 "audit defense / IDR", OTP-50 "MAP", OTP-30 "restructuring", OTP-31 "M&A
  integration").

### Case detail — `src/kernel/data/CaseDrawer.tsx` (clone `src/kernel/data/DrillDrawer.tsx`)
Right-anchored drawer: case metadata (kind, owner, counterparty, jurisdiction,
opened/due, exposure), a **status** control (advance `open → in_progress → submitted →
closed` via `api.setCaseStatus`), an interactive **checklist** (each step a checkbox →
`api.setCaseStep`), and an **Evidence packet** button (`navigate('/evidence/case:'+id)`).
After any mutation, call the hook's `reload()`. A caption notes the full trail is on the
process's **Audit** tab.

### Register — `src/kernel/bindings/index.ts`
Import `caseWorkspace`; map `'OTP-30' | 'OTP-31' | 'OTP-40' | 'OTP-50'` → `caseWorkspace`.
(All four flip to **Live** on the library automatically via Increment 0's badge.)

### `primaryAction` note
`primaryAction` is **display-only** in the shell (the shell's button has no `onClick`).
All real actions live inside the worklist/drawer. The binding may set a static
`primaryAction` label or omit it.

## Out of scope (Increment 1)
- A "New case" creation **form** in the UI (the POST endpoint is built + tested; the demo
  flow reviews/advances existing cases).
- Filling catalog `steps` for the four processes (the checklist lives on the case, not
  the catalog).
- An evidence `_resolve_entity` branch for `case:` refs (the packet still shows event
  history + chain verify; entity postings simply come back empty — harmless).

## Verification
- **Backend:** `cd backend && ../.venv/bin/python -m pytest tests/test_cases.py -q`, then
  full `pytest -q` — all pass. After the dev server hot-reloads: `curl /api/cases`
  returns the seed; a PATCH status/checklist returns the updated case and
  `curl '/api/audit?record_ref=case:CASE-1'` shows the event.
- **Frontend:** `npm run typecheck && npm run build` pass. In the running app:
  OTP-30/31/40/50 read **Live** on `/process`; each opens to the case worklist; the
  drawer toggles a checklist step and advances status (persisting across reload); the
  Evidence button opens the packet; the process **Audit** tab shows the case events.

## Files
**Create:** `backend/state/cases.py`, `backend/routers/cases.py`,
`backend/seeds/cases/cases.v1.json`, `backend/tests/test_cases.py`,
`src/kernel/bindings/marquee/caseWorkspace.tsx`, `src/kernel/data/CaseDrawer.tsx`.
**Modify:** `backend/state/schema.sql`, `backend/schemas/state.py`,
`backend/state/migrate.py`, `backend/main.py`, `src/shared/api/types.ts`,
`src/shared/api/client.ts`, `src/kernel/bindings/index.ts`.
