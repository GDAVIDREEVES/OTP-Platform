# OTP Platform

> Operational Transfer Pricing "close cockpit" — a working demo of an enterprise
> TP operations suite: **50 wired processes**, a governed **Calc Studio** with
> scenarios and traceable calculations, and a deterministic **intercompany
> allocation engine** (OECD Ch. VII / §1.482-9) — all on a hash-chained audit
> spine where every number traces to a governed source.

Built on **React 18 + MUI** (Vite, :5173) and **FastAPI** (:8000) over a
read-only **DuckDB/Parquet** warehouse (ACDOCA-style journal, segmented P&L,
supply-chain flows) and a mutable **SQLite** state store (drafts, reviews,
cases, parameters, scenarios, runs, ledgers — all audit-logged).

**See [README-WORKFLOW.md](README-WORKFLOW.md) for the end-to-end usage flow,**
and [DEMO.md](DEMO.md) for the runbook.

---

## Quick start

```bash
./scripts/dev.sh                                    # FastAPI :8000 + Vite :5173 (hot reload)
# open http://localhost:5173 → "Enter Demo Workspace"

./scripts/serve.sh                                  # ONE port: builds dist/ and serves app + API
# open http://localhost:8000

cd backend && ../.venv/bin/python -m state.migrate --reset   # pristine demo state

cd backend && ../.venv/bin/python -m pytest -q      # backend tests
npm run typecheck && npm run build                  # frontend gate
```

First-time setup (any machine with Python 3.11+ and Node 20+):

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
npm install
```

## Run it from any computer

The browser only ever talks to one origin — `/api/*` is proxied by Vite in dev,
and in production FastAPI serves the built SPA itself — so there is no CORS or
host configuration to get right. Three ways to get a running URL:

| Where | How | URL |
| --- | --- | --- |
| **GitHub Codespaces** (nothing to install) | Open [codespaces.new/GDAVIDREEVES/OTP-Platform?quickstart=1](https://codespaces.new/GDAVIDREEVES/OTP-Platform?quickstart=1). The devcontainer installs deps, builds the app and starts `scripts/serve.sh` on port 8000; the forwarded port opens in your browser (~3-4 min first boot). | the forwarded port-8000 URL |
| **Docker** | `docker build -t otp-platform . && docker run --rm -p 8000:8000 otp-platform` | http://localhost:8000 |
| **Laptop** | `./scripts/serve.sh` (after first-time setup above) | http://localhost:8000 |

Demo state (drafts, reviews, audit events) lives in a git-ignored SQLite file
inside the running instance; reset it with the `migrate --reset` command above.

---

## What's in the box

| Area | What it is |
| --- | --- |
| **Process library** (`/process`) | All 50 OTP processes (OTP-1…50, categories A–G), **every one live-wired** to real data: pricing wizards, charge/invoice batches, monitoring worklists, workpaper grids, case workspaces, compliance calcs. ⌘K command palette. |
| **Close-cycle loops** | Processes hand off to each other and **loop back**: monitoring → adjustment → approval → re-validation; benchmark refresh → stale-price flags; DEMPE → price design; docs ⇄ controversy cases. Every hand-off is an audit event. |
| **Home — "My work"** (`/home`) | One cross-process worklist: drafts, items awaiting your review, out-of-range and watch exceptions, open cases — urgency-sorted with deep links (`/inbox` redirects here). |
| **Calc Studio** (`/calc-studio`) | The calculation-management module (Anaplan/PaPM/Oracle-EPM-style). Its home is the **Cockpit** — an Alteryx-style **drag-and-drop canvas** (React Flow) that is the single build surface for the whole calc loop: drag governed **parameters / warehouse measures / composable calcs** and **operation** nodes onto the canvas, wire them into a flow, hit **Run** and watch per-node values paint live; configure any node **inline** (no modals), flip **Base ⟷ Scenario** to paint the Δ, and **Save / Test / Submit-for-activation** from one split-button. The same canvas hosts the typed **allocation pipeline** (Source → Pool → Benefit-test → Allocate → Markup → Charge → Recon) **and an Alteryx-style data-prep layer over the full ACDOCA journal**: drag a **Datasets / ACDOCA** source and **expand it in the palette down to the field and the value** — the journal exposes its **37 ACDOCA fields, grouped** (entity, account, cost & profit center, amounts, currency, document, dates), each a draggable chip, and you can browse a dimension to its actual values (all **17 GL accounts `RACCT`**, **8 cost centers `RCNTR`**, **8 profit centers `PRCTR`**, …) and **drag a specific value as a filter** (e.g. `RACCT = 0810000`, bound as a parameter). Wire **Filter / Aggregate / Join / Union / Derive / Select** nodes into a dataset, preview the tabular result per node, then **save it as a governed authored dataset** (draft → tested → in_review → active, maker-checker at `dataset:{id}`) — which can then **feed a calc** (a journal-grained number into a formula) or become an **allocation pool's cost base** (build a cost pool by joining/filtering ACDOCA). **Crucially the canvas adds no new evaluator** — a calc subgraph compiles to the same `calc/expr.py` expression and lands as a `user_calculations` record; an allocation subgraph compiles to the same `authored_pools` definition and runs through the existing Stages 1-7; a **dataset subgraph compiles to ONE safe parameterized DuckDB query** (column/op names from an allowlist, values always bound) run via `db.q` — DuckDB stays the engine. So everything inherits validation, preview/trace, scenarios, maker-checker activation, and the audit chain unchanged. The reference tabs remain as drill-downs: **Calculations** registry, **Drivers & Assumptions** (governed parameter store), **Scenarios** (what-if with Base \| Scenario \| Δ and maker-checker promotion), **Runs** (job console), **Waterfall** (the TP charge sequence console: apply service / royalty / CSA / profit-split charges to entity P&L as an append-only double-entry overlay — group net zero, rollback by reversing rows), **Lineage** (sources → parameters → calculations → processes DAG), **Data Catalog** & **Provenance** (real / assumed / fabricated per source — the real ACDOCA journal vs the fabricated finer cost-center `allocation_cost_lines`), and **Allocations** (the engine workbench with a **Pool Builder** to author your own cost pools from cost center / profit center / GL account or a saved dataset). |
| **Allocation engine** (`backend/allocation/`) | A deterministic cost-to-charge engine per [`docs/allocation/SPEC.md`](docs/allocation/SPEC.md): capture → pool → benefit-test gate → allocate (largest remainder; cascade + reciprocal) → markup → charge-out → reconcile/true-up. Decimal-only money, append-only ledgers, V-rule validation catalogue, input-snapshot hashing, doc packs as run byproducts. Its output **reconciles to the warehouse to the cent** (FY $13,586,402.70 cost / $14,344,773.26 gross == the demo's service flows). **Author your own pools** (the Allocations workbench Pool Builder, per [`docs/superpowers/specs/2026-06-11-allocation-pool-builder-design.md`](docs/superpowers/specs/2026-06-11-allocation-pool-builder-design.md)): select cost centers / profit centers / GL accounts (a cost-capture rule over the richer fabricated cost-center layer), preview the captured cost, set a benefit-tested beneficiary population + allocation key + exclusions + per-jurisdiction markup, then test → activate via maker-checker → run through the **real** Stages 1-7 in isolation. Authored pools are governed **experiments** flagged `authored` — balanced to zero residual with their own charges/recon/trace/doc pack, and they **never** perturb the governed cent-exact tie-out above. |
| **Master Data** (`/master-data`) | Entity × function master, covered-transaction matrix, inbound SAP-delta mapping with AI-proposed, human-approved characterization (maker ≠ checker). |
| **Review queue** (`/review`) | Maker-checker approvals for everything: adjustments, wizard submissions, scenario promotions. Rejected work routes back to its origin. |
| **Director** (`/director`) | Group exposure: IC flows, Pillar Two, TP reserve, jurisdiction risk. |
| **Audit & evidence** | Append-only, hash-chained audit trail on every record (`backend/state/audit.py`). Any record's `/evidence/:ref` packet shows event history, before/after diffs, linked postings, a **process-lineage timeline**, and one-click chain verification. |
| **Research Brain** (AI assistant) | An in-app side-panel assistant reachable from every screen, scoped to the current entity / flow / method. It **prepares** — computes gap-to-range, pulls the underlying ACDOCA postings, proposes inbound-mapping characterizations — and logs an *assisted* event to the audit trail, but **never approves** (the human is always the checker). Citation-backed TP Q&A calls the separate `researchbrain` service and **degrades gracefully** — without it you get a shaped offline answer with a clear live/offline indicator. |

## Architecture

```
React (Vite :5173) ── /api/* ──▶ FastAPI (:8000)
                                   ├─▶ DuckDB ▶ Parquet warehouse (read-only)
                                   │     journal (full ACDOCA: GL/CC/PC/amounts)
                                   │     segment_pl · supply_chain · entity_roles
                                   │     ▲ dataset subgraph ▶ ONE parameterized CTE query
                                   ├─▶ SQLite state (mutable, audited)
                                   │     drafts · reviews · cases · parameters · scenarios
                                   │     calc_runs · user calculations · authored datasets
                                   │     allocation ledgers · P&L overlays (append-only)
                                   └─▶ Seeds (versioned JSON reference data + catalog)
```

Key subsystems:
- `src/kernel/` — process shell, bindings registry (one binding can serve many
  processes), guided workflows, audit/evidence components, review queue.
- `backend/calc/` + `backend/services/calc_registry.py` — the shared calculation
  engine and registry; every calc is runnable, traceable, and scenario-capable.
- `backend/state/parameters.py` — the governed parameter store; scenario
  overrides apply through a contextvar overlay without touching governed values.
- `backend/calc/expr.py` + `backend/state/user_calcs.py` — the Calculation
  Builder's safe expression engine (tokenizer → AST → Decimal evaluator, no
  eval/exec) and the draft → tested → in-review → active lifecycle.
- `backend/services/waterfall_runner.py` + `backend/state/pl_overlays.py` — the
  TP waterfall: intercompany charges applied to entity P&L as an append-only
  double-entry overlay (`/api/pl/adjusted`), governed by `pl.use_post_charge`.
- `backend/allocation/` — the pure allocation engine; types/DDL **generated**
  from `docs/allocation/intercompany-allocation-schema.json` (never hand-edit
  `generated/`).
- `backend/calc/dataset.py` + `backend/state/authored_datasets.py` — the
  Alteryx-style data-prep layer: a `source/filter/aggregate/join/union/derive/
  select` subgraph compiles to **one safe parameterized DuckDB query** (allowlist
  identifiers, bound values — the `expr.py` injection discipline generalized) run
  via `db.q`; saved as a governed authored dataset (draft → tested → in_review →
  active, audited at `dataset:{id}`) that feeds calcs and allocation pool cost
  bases. The journal source exposes the full ACDOCA field set (GL/CC/PC + amounts).

## Data honesty

The catalog (`/api/catalog/provenance`) classifies every source and parameter
as **real** (warehouse-derived), **assumed**, or **fabricated** (seeded for the
demo, flagged in-UI). All fabricated magnitudes are governed parameters or
isolated seeds — editable and audited, never buried in code. The dataset layer
keeps the distinction honest at the source: the real ACDOCA journal
(`warehouse:journal`) and the fabricated finer cost-center grain
(`seed:allocation_cost_lines`) are separate, provenance-tagged sources in the
palette and the rollup — never silently mixed in a join.

## Docs

- [README-WORKFLOW.md](README-WORKFLOW.md) — how to *use* the solution, end to end
- [DEMO.md](DEMO.md) — demo runbook, reset, AI surfaces
- [docs/allocation/](docs/allocation/) — allocation-engine spec set (SPEC, schema, adaptation, decisions)
- [docs/superpowers/](docs/superpowers/) — per-increment design specs and plans
