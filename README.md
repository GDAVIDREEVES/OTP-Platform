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
./scripts/dev.sh                                    # FastAPI :8000 + Vite :5173
# open http://localhost:5173 → "Enter Demo Workspace"

cd backend && ../.venv/bin/python -m state.migrate --reset   # pristine demo state

cd backend && ../.venv/bin/python -m pytest -q      # backend tests
npm run typecheck && npm run build                  # frontend gate
```

---

## What's in the box

| Area | What it is |
| --- | --- |
| **Process library** (`/process`) | All 50 OTP processes (OTP-1…50, categories A–G), **every one live-wired** to real data: pricing wizards, charge/invoice batches, monitoring worklists, workpaper grids, case workspaces, compliance calcs. ⌘K command palette. |
| **Close-cycle loops** | Processes hand off to each other and **loop back**: monitoring → adjustment → approval → re-validation; benchmark refresh → stale-price flags; DEMPE → price design; docs ⇄ controversy cases. Every hand-off is an audit event. |
| **Inbox** (`/inbox`) | One cross-process worklist: drafts, items awaiting your review, out-of-range exceptions, open cases — urgency-sorted with deep links. |
| **Calc Studio** (`/calc-studio`) | The calculation-management module (Anaplan/PaPM/Oracle-EPM-style). Its home is the **Cockpit** — an Alteryx-style **drag-and-drop canvas** (React Flow) that is the single build surface for the whole calc loop: drag governed **parameters / warehouse measures / composable calcs** and **operation** nodes onto the canvas, wire them into a flow, hit **Run** and watch per-node values paint live; configure any node **inline** (no modals), flip **Base ⟷ Scenario** to paint the Δ, and **Save / Test / Submit-for-activation** from one split-button. The same canvas hosts the typed **allocation pipeline** (Source → Pool → Benefit-test → Allocate → Markup → Charge → Recon). **Crucially the canvas adds no new evaluator** — a calc subgraph compiles to the same `calc/expr.py` expression and lands as a `user_calculations` record; an allocation subgraph compiles to the same `authored_pools` definition and runs through the existing Stages 1-7 — so it inherits validation, preview/trace, scenarios, maker-checker activation, and the audit chain unchanged. The reference tabs remain as drill-downs: **Calculations** registry, **Drivers & Assumptions** (governed parameter store), **Scenarios** (what-if with Base \| Scenario \| Δ and maker-checker promotion), **Runs** (job console), **Waterfall** (the TP charge sequence console: apply service / royalty / CSA / profit-split charges to entity P&L as an append-only double-entry overlay — group net zero, rollback by reversing rows), **Lineage** (sources → parameters → calculations → processes DAG), **Data Catalog** & **Provenance** (real / assumed / fabricated per source), and **Allocations** (the engine workbench with a **Pool Builder** to author your own cost pools from cost center / profit center / GL account). |
| **Allocation engine** (`backend/allocation/`) | A deterministic cost-to-charge engine per [`docs/allocation/SPEC.md`](docs/allocation/SPEC.md): capture → pool → benefit-test gate → allocate (largest remainder; cascade + reciprocal) → markup → charge-out → reconcile/true-up. Decimal-only money, append-only ledgers, V-rule validation catalogue, input-snapshot hashing, doc packs as run byproducts. Its output **reconciles to the warehouse to the cent** (FY $13,586,402.70 cost / $14,344,773.26 gross == the demo's service flows). **Author your own pools** (the Allocations workbench Pool Builder, per [`docs/superpowers/specs/2026-06-11-allocation-pool-builder-design.md`](docs/superpowers/specs/2026-06-11-allocation-pool-builder-design.md)): select cost centers / profit centers / GL accounts (a cost-capture rule over the richer fabricated cost-center layer), preview the captured cost, set a benefit-tested beneficiary population + allocation key + exclusions + per-jurisdiction markup, then test → activate via maker-checker → run through the **real** Stages 1-7 in isolation. Authored pools are governed **experiments** flagged `authored` — balanced to zero residual with their own charges/recon/trace/doc pack, and they **never** perturb the governed cent-exact tie-out above. |
| **Master Data** (`/master-data`) | Entity × function master, covered-transaction matrix, inbound SAP-delta mapping with AI-proposed, human-approved characterization (maker ≠ checker). |
| **Review queue** (`/review`) | Maker-checker approvals for everything: adjustments, wizard submissions, scenario promotions. Rejected work routes back to its origin. |
| **Director** (`/director`) | Group exposure: IC flows, Pillar Two, TP reserve, jurisdiction risk. |
| **Audit & evidence** | Append-only, hash-chained audit trail on every record (`backend/state/audit.py`). Any record's `/evidence/:ref` packet shows event history, before/after diffs, linked postings, a **process-lineage timeline**, and one-click chain verification. |

## Architecture

```
React (Vite :5173) ── /api/* ──▶ FastAPI (:8000)
                                   ├─▶ DuckDB ▶ Parquet warehouse (read-only)
                                   │     journal · segment_pl · supply_chain · entity_roles
                                   ├─▶ SQLite state (mutable, audited)
                                   │     drafts · reviews · cases · parameters · scenarios
                                   │     calc_runs · user calculations · allocation ledgers
                                   │     P&L overlays (append-only)
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

## Data honesty

The catalog (`/api/catalog/provenance`) classifies every source and parameter
as **real** (warehouse-derived), **assumed**, or **fabricated** (seeded for the
demo, flagged in-UI). All fabricated magnitudes are governed parameters or
isolated seeds — editable and audited, never buried in code.

## Docs

- [README-WORKFLOW.md](README-WORKFLOW.md) — how to *use* the solution, end to end
- [DEMO.md](DEMO.md) — demo runbook, reset, AI surfaces
- [docs/allocation/](docs/allocation/) — allocation-engine spec set (SPEC, schema, adaptation, decisions)
- [docs/superpowers/](docs/superpowers/) — per-increment design specs and plans
