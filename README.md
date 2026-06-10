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
| **Calc Studio** (`/calc-studio`) | The calculation-management module (Anaplan/PaPM/Oracle-EPM-style): **Calculations** registry (every computed endpoint as a managed object) · **Drivers & Assumptions** (governed parameter store) · **Scenarios** (what-if with Base \| Scenario \| Δ and maker-checker promotion) · **Runs** (job console) · **Lineage** (sources → parameters → calculations → processes DAG) · **Data Catalog** & **Provenance** (real / assumed / fabricated per source) · **Allocations** (the engine workbench, below). |
| **Allocation engine** (`backend/allocation/`) | A deterministic cost-to-charge engine per [`docs/allocation/SPEC.md`](docs/allocation/SPEC.md): capture → pool → benefit-test gate → allocate (largest remainder; cascade + reciprocal) → markup → charge-out → reconcile/true-up. Decimal-only money, append-only ledgers, V-rule validation catalogue, input-snapshot hashing, doc packs as run byproducts. Its output **reconciles to the warehouse to the cent** (FY $13,586,402.70 cost / $14,344,773.26 gross == the demo's service flows). |
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
                                   │     calc_runs · allocation ledgers (append-only)
                                   └─▶ Seeds (versioned JSON reference data + catalog)
```

Key subsystems:
- `src/kernel/` — process shell, bindings registry (one binding can serve many
  processes), guided workflows, audit/evidence components, review queue.
- `backend/calc/` + `backend/services/calc_registry.py` — the shared calculation
  engine and registry; every calc is runnable, traceable, and scenario-capable.
- `backend/state/parameters.py` — the governed parameter store; scenario
  overrides apply through a contextvar overlay without touching governed values.
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
