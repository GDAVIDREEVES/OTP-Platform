# OTP Platform — demo runbook

The platform is an operational transfer-pricing "close cockpit": one reusable
module shell across 50 processes (OTP-1…50), a role-aware home, guided
AI-assisted workflows with a visible hand-off, an append-only hash-chained audit
trail, and a director exposure view. Built on React/MUI + FastAPI + DuckDB/Parquet,
with SQLite for mutable state.

## Run it

```bash
./scripts/dev.sh          # FastAPI :8000 + Vite :5173, one Ctrl-C stops both
```

- Boots out of the box on the committed sample dataset (`data/parquet/`).
- For full-fidelity data, set `DATA_DIR` in `backend/.env` to a full ACDOCA export.
- Open http://localhost:5173 → **Enter Demo Workspace**.

## Reset to a pristine demo

Verification/usage leaves records in the audit stream, drafts, and review queue.
To start clean (server stopped):

```bash
cd backend && ../.venv/bin/python -m state.migrate --reset
```

This wipes `backend/state/otp_state.db` (git-ignored), recreates the schema, and
re-imports the seeds. The ACDOCA Parquet data is untouched.

## AI surfaces (graceful degradation)

Two AI surfaces; both degrade gracefully — the demo never breaks if a service or
key is missing.

- **Agentic prepare** (OTP-16 step 1, and the OTP-3 / OTP-9 / OTP-25 wizards) is
  always real: it computes from the warehouse server-side (real posting counts,
  gap-to-range) and logs an assisted "prepared" event to the audit trail. No
  external service required.
- **TP Q&A** (the Research Brain panel) calls the separate **researchbrain**
  service for citation-backed retrieval. To run the live path:

  ```bash
  # 1. Qdrant vector DB on :6333  (researchbrain dependency)
  # 2. in the researchbrain repo:
  export ANTHROPIC_API_KEY=sk-ant-...   # Claude synthesis
  export VOYAGE_API_KEY=pa-...          # embeddings + rerank
  npm start                              # serves :3000
  curl http://127.0.0.1:3000/api/health  # verify
  ```

  Point the OTP backend at it with `RESEARCH_BRAIN_BASE_URL` (default
  `http://127.0.0.1:3000`), and set `ANTHROPIC_API_KEY` for the OTP backend too if
  you want it to synthesise the retrieved chunks into prose. Without researchbrain
  the panel shows a shaped "offline" answer with a clear live/offline indicator.

## The walkthrough (operator → reviewer → director)

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
1. **Home** (`/home`) — role-aware operating-cadence home. Switch persona from
   the top-right avatar (Operator / Reviewer / Director).
2. **Process library** (`/process`) — all 50 processes by lifecycle category A–G;
   ⌘K / Ctrl-K opens the command palette. **All 50 are wired to live data** —
   rich, process-specific bindings (pricing wizards, charge/invoice batches,
   monitoring worklists, workpaper grids, case workspaces, compliance calcs).
3. **OTP-20 Operating-margin monitoring** — answer-first KPIs, exceptions-first
   worklist, drill any margin to its ACDOCA postings. Click **Adjust** on a flag.
4. **OTP-16 Adjustment** (guided) — Research Brain prepares (pulls postings,
   applies policy, quantifies the gap) → **visible hand-off** → you quantify →
   gated submit with rationale. Leaving and returning resumes at the exact step.
5. **Review queue** (`/review`) — switch to **Reviewer**, approve/return. A maker
   cannot approve their own work.
6. **Audit** — any process's Audit tab shows the append-only stream
   (created → submitted → approved, assistant logged distinctly) with one-click
   chain verification.
7. **Director** (`/director`) — group exposure: IC flow, Pillar Two top-up, TP
   reserve, jurisdictional risk, top-15 health; board-pack from live data.
8. **Audit rail & evidence** — the history icon by the tabs toggles a live event
   rail on any module. From a submitted record (OTP-16 confirmation, a
   review-queue item, or a wizard completion) open the **Evidence packet**: event
   history, before/after diffs, linked ACDOCA postings, chain-verify, Print/export.
9. **Guided wizards** — OTP-3 (rate setting), OTP-9 (charge → stage → post), and
   OTP-25 (benchmarking refresh) each run a prepare → … → gated-submit path that
   lands in the review queue.

## Calculation management (Calc Studio, `/calc-studio`)

Beyond the close cycle, Calc Studio is the governed engine room. Everything here
is runnable, traceable, scenario-capable and maker-checker-governed on the same
audit chain. See **[README-WORKFLOW.md](README-WORKFLOW.md)** for the step-by-step
flows; the headline surfaces:

- **Cockpit** (`/calc-studio/cockpit`, the default) — an Alteryx-style
  drag-and-drop **canvas** that *is* the build loop: drag governed parameters /
  warehouse measures / composable calcs / operation nodes, wire them, hit **Run**
  and watch per-node values paint live; configure inline (no modals), flip
  **Base ⟷ Scenario** to paint the Δ, and Save → Test → Submit from one
  split-button. The canvas adds **no new evaluator** — a calc subgraph compiles to
  the same `calc/expr.py` expression, an allocation subgraph to an `authored_pools`
  definition, a dataset subgraph to one safe parameterized DuckDB query.
- **Data-prep over the full ACDOCA journal** — the *Datasets / ACDOCA* palette
  exposes the journal's **GL accounts, cost centers, profit centers and amounts**
  down to the field and value (draggable), with **Filter / Aggregate / Join /
  Union / Derive** nodes. Save a governed **dataset** that can feed a calc or
  become an allocation pool's cost base — build cost pools by joining/filtering
  ACDOCA.
- **Allocation engine** (`/calc-studio/allocations`) — the OECD Ch. VII /
  §1.482-9 cost-to-charge pipeline (capture → pool → benefit-test → allocate →
  markup → charge-out → reconcile/true-up). Reconciles to the warehouse to the
  cent (FY **$13,586,402.70** cost / **$14,344,773.26** gross). A **Pool Builder**
  lets you author your own pools from cost centers / profit centers / GL accounts
  (or a saved dataset) and run them through the real Stages 1-7 as governed,
  `authored`-flagged experiments that never perturb the governed tie-out.
- **TP waterfall** (`/calc-studio/waterfall`) — applies service / royalty / CSA /
  profit-split charges to each entity's P&L as an append-only double-entry overlay
  (`pl.use_post_charge`), so monitoring / adjustments / pricing read *post-charge*
  margins — charges before decisions.
- **Registry · Drivers · Scenarios · Runs · Lineage · Provenance** — every managed
  calc with its trace; the governed parameter store; Base|Scenario|Δ what-if with
  maker-checker promotion; the run job console; the sources→params→calcs→processes
  dependency DAG; and the real/assumed/fabricated provenance rollup.

## Tests

```bash
cd backend && ../.venv/bin/python -m pytest tests   # backend  (774 passing)
npm run typecheck && npm run build                  # frontend
```
