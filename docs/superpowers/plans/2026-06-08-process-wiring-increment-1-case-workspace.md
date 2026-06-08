# Process Library — Increment 1 (Case Workspace) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire OTP-30/31/40/50 to one shared, data-backed **Case Workspace** — a governance-case tracker with status, owner, due date, exposure, an interactive checklist, and an automatic audit trail + evidence packet per case.

**Architecture:** A new backend `cases` SQLite-state source (DDL + `state/cases.py` + `routers/cases.py` + seed), every mutation hash-chained into the audit trail at `record_ref="case:{id}"`. One shared frontend `caseWorkspace` binding (KPIs + worklist + overview) + a `CaseDrawer` (status control, checklist toggles, evidence link), mapped to all four OTP ids.

**Tech Stack:** FastAPI + SQLite state + **pytest** (backend, real red→green tests); React 18 + MUI 5 + Vite (frontend, gate = `npm run typecheck && npm run build` + manual — no unit runner). Dev stack is running with hot-reload (uvicorn `--reload`, Vite HMR).

**Spec:** `docs/superpowers/specs/2026-06-08-process-wiring-increment-1-case-workspace-design.md` (full design + rationale).

**Patterns to mirror (from the architecture brief):** `backend/state/review.py` (lock + `audit.record` inside the lock), `backend/routers/review.py` (thin router, `ValueError`→HTTPException), `backend/state/master_data.py` `seed_if_empty()`, `backend/tests/test_review.py` + `conftest.py` `state_db` fixture; frontend `src/kernel/bindings/marquee/otp20.tsx` (KPIs + worklist + drill), `otp21.tsx` (`useSegments` alive-guard fetch), `src/kernel/data/DrillDrawer.tsx` (right drawer).

**Branch:** `process-wiring-top15`. Backend commands from `backend/` via `../.venv/bin/python`.

**Key decisions (locked in spec):**
- `cases` is mutable SQLite state — **no period filter**.
- Status enum: `open → in_progress → submitted → closed`. `event_type` mapping on status change: `submitted`→`"submitted"`, `closed`→`"posted"`, else `"edited"`. Create→`"created"`. Checklist toggle→`"edited"`.
- `record_ref="case:{id}"` is the join key — gets the Audit tab + `/evidence/:ref` packet for free.
- State dicts expose `checklist` **parsed** (`json.loads(checklist_json)`), raw column omitted, so API shape == frontend `Case`.
- `primaryAction` is **display-only** (shell button has no onClick) — all actions live in the worklist/drawer.

---

## File structure
- **Create:** `backend/state/cases.py`, `backend/routers/cases.py`, `backend/seeds/cases/cases.v1.json`, `backend/tests/test_cases.py`, `src/kernel/bindings/marquee/caseWorkspace.tsx`, `src/kernel/data/CaseDrawer.tsx`.
- **Modify:** `backend/state/schema.sql`, `backend/schemas/state.py`, `backend/state/migrate.py`, `backend/main.py`, `src/shared/api/types.ts`, `src/shared/api/client.ts`, `src/kernel/bindings/index.ts`.

---

## Task 1 — Backend `cases` state layer + tests (pytest TDD)

**Files:** Create `backend/state/cases.py`, `backend/seeds/cases/cases.v1.json`, `backend/tests/test_cases.py`; Modify `backend/state/schema.sql`, `backend/schemas/state.py`, `backend/state/migrate.py`.

- [ ] **Step 1 — DDL.** Append the `cases` table to `backend/state/schema.sql`:
```sql
-- Governance cases (Case Workspace — OTP-30/31/40/50): controversy, restructuring,
-- and integration matters with status, owner, due date, checklist + audit trail.
CREATE TABLE IF NOT EXISTS cases (
  id             TEXT PRIMARY KEY,
  process_id     TEXT NOT NULL,
  kind           TEXT NOT NULL,
  title          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','submitted','closed')),
  owner          TEXT NOT NULL,
  counterparty   TEXT,
  jurisdiction   TEXT,
  exposure       REAL,
  opened_at      TEXT NOT NULL,
  due_at         TEXT,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_cases_process ON cases (process_id);
```

- [ ] **Step 2 — Request models.** Add to `backend/schemas/state.py`: `CaseIn` (process_id, kind, title, owner, counterparty?, jurisdiction?, exposure?: float, due_at?, checklist: list[dict]=[], **actor**: str), `CaseStatusIn` (status, actor), `CaseStepIn` (step_key, done: bool, actor).

- [ ] **Step 3 — Seed.** Create `backend/seeds/cases/cases.v1.json` — `{ "version": "1", "cases": [ … ] }` with **6 realistic cases**: 2× OTP-40 (audit_defense), 2× OTP-50 (map), 1× OTP-30 (restructuring), 1× OTP-31 (mna_integration); statuses spanning open/in_progress/submitted/closed; USD `exposure`; 2026 `due_at`; 3–5 checklist steps `{key,label,done}` each. (Scenarios per the spec — German field audit, US–DE MAP, EU principal restructuring, NovaTher acquisition, India AMP, Canada–US MAP.)

- [ ] **Step 4 — State module.** Create `backend/state/cases.py` mirroring `state/review.py`'s lock+audit pattern. Functions: `list_cases(process_id=None, status=None)` (sorted by status-rank then due_at), `get_case(id)`, `create_case(*, …, actor)` (→`event_type="created"`), `set_status(id, status, actor)` (ValueError if missing/invalid; before/after; event mapping above), `set_checklist_step(id, step_key, done, actor)` (toggle in checklist_json; `"edited"`; ValueError if step/case missing), `seed_if_empty()` (insert seeds when `count(*)==0`). Helpers `_now()`, `_to_dict(row)` (**parses `checklist_json`→`checklist`, drops the raw key**), `_doc(name)` (lru_cache seed loader), `_next_id(conn)` (`CASE-{count+1}`). Every mutation calls `audit.record(actor=…, actor_kind="human", process_id=…, record_ref=f"case:{id}", event_type=…, before=…, after=…)` **inside** the `with LOCK` block (exactly as review.py does).

- [ ] **Step 5 — Wire seeding.** In `backend/state/migrate.py` `run()`, after `master_data.seed_if_empty()`, add `from state import cases` / `cases.seed_if_empty()`.

- [ ] **Step 6 — Tests.** Create `backend/tests/test_cases.py` (uses the `state_db` fixture). Cover: seed populates + `checklist` is a parsed list; `list_cases` filters by process_id and status; `create_case` returns `open` and logs exactly one `created` event at `record_ref="case:{id}"`; `set_status("submitted")` logs `submitted`; `set_status("closed")` logs `posted`; unknown case raises `ValueError`; `set_checklist_step` toggles + persists + logs `edited`.

- [ ] **Step 7 — Run tests.** `cd backend && ../.venv/bin/python -m pytest tests/test_cases.py -q` → expect PASS, then `../.venv/bin/python -m pytest -q` (full suite) → PASS.

- [ ] **Step 8 — Commit.**
```bash
git add backend/state/schema.sql backend/schemas/state.py backend/state/cases.py backend/seeds/cases/cases.v1.json backend/state/migrate.py backend/tests/test_cases.py
git commit -m "feat(cases): cases SQLite state + seed + audit-logged mutations (OTP-30/31/40/50)"
```

---

## Task 2 — Backend router + mount

**Files:** Create `backend/routers/cases.py`; Modify `backend/main.py`.

- [ ] **Step 1 — Router.** Create `backend/routers/cases.py` mirroring `routers/review.py`: `GET /api/cases?process_id=&status=`; `GET /api/cases/{id}` (404 if None); `POST /api/cases` (`CaseIn` → `create_case(**body.model_dump(exclude={"actor"}), actor=body.actor)`); `PATCH /api/cases/{id}/status` (`CaseStatusIn`; `ValueError`→404 if "unknown" else 409); `PATCH /api/cases/{id}/checklist` (`CaseStepIn`; `ValueError`→404 if "unknown" else 400).

- [ ] **Step 2 — Mount.** In `backend/main.py`, add `cases,` to the `from routers import (...)` block and `cases.router,` to the `include_router` loop.

- [ ] **Step 3 — Reseed + verify live** (uvicorn `--reload` picks up the new router; reseed so the table exists with data):
```bash
cd backend && ../.venv/bin/python -m state.migrate --reset && cd ..
curl -s 'http://127.0.0.1:8000/api/cases' | ../.venv/bin/python -m json.tool | head -40   # 6 cases
curl -s -X PATCH 'http://127.0.0.1:8000/api/cases/CASE-1/checklist' -H 'Content-Type: application/json' -d '{"step_key":"econ","done":true,"actor":"u_demo"}'
curl -s 'http://127.0.0.1:8000/api/audit?record_ref=case:CASE-1'   # shows an "edited" event
```
Expected: list returns the seed; PATCH returns the updated case with `checklist` parsed; audit shows the event. (Note: `migrate --reset` from the repo root path may differ — run from `backend/`. The dev server reconnects to the rebuilt DB on next request.)

- [ ] **Step 4 — Commit.**
```bash
git add backend/routers/cases.py backend/main.py
git commit -m "feat(cases): /api/cases router (list/get/create/status/checklist) + mount"
```

---

## Task 3 — Frontend types + API client

**Files:** Modify `src/shared/api/types.ts`, `src/shared/api/client.ts`.

- [ ] **Step 1 — Types.** Append to `src/shared/api/types.ts`:
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

- [ ] **Step 2 — Client.** Add `Case`/`CaseStep` to the `./types` import in `src/shared/api/client.ts`, then add to the `api` object: `cases(params)`→`getJSON<Case[]>('/api/cases', params)`, `case(id)`→`getJSON<Case>(...)`, `setCaseStatus(id,{status,actor})`→`sendJSON<Case>('PATCH', …/status, …)`, `setCaseStep(id,{step_key,done,actor})`→`sendJSON<Case>('PATCH', …/checklist, …)`. (`createCase` optional — not used by the UI this increment.)

- [ ] **Step 3 — Verify.** `npm run typecheck` → PASS. (No commit yet — committed with Task 5 so the tree stays green; `index.ts` will import the new binding.)

---

## Task 4 — `caseWorkspace` binding + `CaseDrawer`

**Files:** Create `src/kernel/bindings/marquee/caseWorkspace.tsx`, `src/kernel/data/CaseDrawer.tsx`.

- [ ] **Step 1 — `useCases` + binding.** Create `caseWorkspace.tsx`:
  - `useCases(processId)` — alive-guard fetch of `api.cases({ process_id })` (mirror `otp21.tsx` `useSegments`), returning `{ cases, loading, reload }` (a `reload` bump re-fetches after mutations).
  - `Kpis` (FC<BindingCtx>): **Open**, **Due ≤30d** (`tone:'watch'`), **Overdue** (`tone:'risk'`), **Total exposure** (`formatCurrency`) — computed from `useCases(ctx.def.id)`.
  - `Overview` (FC): answer-first line (`N open · X overdue · $Y exposure`) + the most urgent open cases (reuse the worklist row, or a compact list).
  - `Worklist` (FC): MUI `Table` — Status chip, Title, Owner, Jurisdiction, Due, Exposure (`formatCurrency`), and a row drill icon opening `CaseDrawer`. Header copy keyed by `ctx.def.id` (40→"Audit defense / IDR", 50→"MAP", 30→"Restructuring", 31→"M&A integration"). Loading→`<CircularProgress/>`; empty→`<Alert severity="info">No open cases.</Alert>`.
  - Export `export const caseWorkspace: ProcessBinding = { kpis: Kpis, tabs: { overview: Overview, worklist: Worklist } };` (no `primaryAction` — it's display-only).
  - Status colors: reuse a small local map (open=slate, in_progress=blue, submitted=amber, closed=green) or `@/shared/utils/status` if it fits.

- [ ] **Step 2 — `CaseDrawer`.** Create `CaseDrawer.tsx` by cloning `DrillDrawer.tsx`'s right-anchored shell. Props `{ open, onClose, caseItem: Case | null, onChanged: () => void }`. Body:
  - Header: title + status chip; metadata grid (kind, owner, counterparty, jurisdiction, opened/due, exposure).
  - **Status control:** buttons/`ToggleButtonGroup` to set `open|in_progress|submitted|closed` → `await api.setCaseStatus(id,{status, actor:'u_demo'})` then `onChanged()`.
  - **Checklist:** each step a `FormControlLabel`+`Checkbox` → `await api.setCaseStep(id,{step_key:step.key, done:!step.done, actor:'u_demo'})` then `onChanged()`.
  - **Evidence packet** button → `navigate('/evidence/' + encodeURIComponent('case:' + id))`.
  - Caption: "Full history on the Audit tab."
  - (`actor:'u_demo'` is the demo actor; acceptable for the demo. Mutations are optimistic-after-confirm: await the API, then `onChanged()` triggers the hook's `reload()`.)

- [ ] **Step 3 — Verify.** `npm run typecheck` → PASS (drawer + binding compile; types align with `Case`).

---

## Task 5 — Register the binding + full verify + commit

**Files:** Modify `src/kernel/bindings/index.ts`.

- [ ] **Step 1 — Register.** Import `caseWorkspace`; add to `MARQUEE`: `'OTP-30': caseWorkspace, 'OTP-31': caseWorkspace, 'OTP-40': caseWorkspace, 'OTP-50': caseWorkspace,` with a comment.

- [ ] **Step 2 — Gate.** `npm run typecheck && npm run build` → both PASS.

- [ ] **Step 3 — Manual check** at `http://localhost:5173/process`: OTP-30/31/40/50 now read **Live**; open OTP-40 → case worklist (2 cases); open a case → drawer; toggle a checklist step and advance status (persists across a reload); **Evidence packet** opens; the OTP-40 **Audit** tab lists the case events.

- [ ] **Step 4 — Commit.**
```bash
git add src/shared/api/types.ts src/shared/api/client.ts src/kernel/bindings/marquee/caseWorkspace.tsx src/kernel/data/CaseDrawer.tsx src/kernel/bindings/index.ts
git commit -m "feat(cases): shared Case Workspace binding + CaseDrawer; wire OTP-30/31/40/50"
```

---

## Self-review (plan author)
**Spec coverage:** cases DDL/state/router/seed/tests (Tasks 1–2) ✓; audit at record_ref=case:{id} (Task 1 Step 4) ✓; types+client (Task 3) ✓; shared binding + drawer with checklist/status/evidence (Task 4) ✓; register all four ids (Task 5) ✓; verification backend pytest + curl + frontend typecheck/build/manual ✓; out-of-scope (new-case form, catalog steps, evidence resolver) excluded ✓.
**Sequencing:** frontend types/client (T3) and components (T4) land before the `index.ts` import (T5), so `typecheck` only sees the new binding once it exists — tree stays green at each commit.
**Type consistency:** backend dict (`checklist` parsed) == `Case`; `api.cases/case/setCaseStatus/setCaseStep` signatures match the router bodies; `record_ref` string `case:{id}` identical in `state/cases.py` and the drawer's evidence `navigate`. `actor_kind` ∈ {human}. Status enum identical across DDL CHECK, `_STATUSES`, and the `Case` union.
