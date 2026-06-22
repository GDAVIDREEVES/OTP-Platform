# Phase 7 — Model Canvas Cockpit (approved design)

**Ask (user):** an Alteryx One–style drag-and-drop **visual canvas** for the calculation + allocation
engine — drag parameters / measures / calcs as nodes, drag operation nodes, wire them into a flow,
see results at each node. **Plus an overriding UX constraint:** reduce clicks and screens; the
calculation functionality must feel like a **command center / cockpit**, not a set of disjointed tabs.

**Approved decisions (2026-06-15):**
1. **One Model canvas spanning calc + allocation** (not calc-only).
2. **Allocation = typed stage nodes in canonical order** (Source → Pool → Benefit-test → Allocate →
   Markup → Charge → Recon); calc-value nodes can feed stage inputs. Connections type-checked so only
   valid orders are allowed.
3. **React Flow** (`@xyflow/react`) renders the canvas.
4. **Cockpit-first:** the canvas is the unifying home surface for the whole calc loop — not a 9th tab.

## Core principle — the canvas is a visual layer over the EXISTING engines (no new evaluator)
The canvas serializes to **graph JSON** that *compiles* to what we already have:
- a **calc subgraph → `backend/calc/expr.py` AST** (the safe Decimal evaluator) → it **is** a
  `user_calculations` record (`graph_json` stored alongside `expression`; the expression stays the
  source of truth, the graph is the visual layer). Canvas ⟷ Formula bar are two views of one calc.
- an **allocation subgraph → an `authored_pools` definition** (PB2) → runs through the existing
  allocation runner (Stages 1–7). Stage nodes' config = the Pool Builder fields.

So the canvas inherits the **entire governance stack unchanged**: validate, preview, draft→test→
maker-checker→active, per-node trace, scenario overlays, the allocation runner, the audit chain.
No duplicated evaluation logic; per-node "Results window" values come from the existing trace (calc)
and dry-run stage outputs (allocation).

## The cockpit (the UX heart of this phase)
A single surface — `/calc-studio/cockpit` (becomes the default Calc Studio landing) — replaces the
open-a-modal-Builder + tab-hopping loop:

```
┌────────────┬──────────────────────────────────────────┬───────────────┐
│  PALETTE   │             CANVAS (React Flow)            │   INSPECTOR   │
│ (searchable│  param ┐                                   │ (selected     │
│  draggable)│  measure├▶ × ─▶ if ─▶ output               │  node config, │
│  Params w/ │  calc  ┘         ▲                         │  INLINE — no  │
│  live vals │  Source→Pool→…→Charge→Recon                │  modal)       │
│  Measures  │                                            │               │
│  Calcs     │   [Base ⟷ Scenario]  [▶ Run/Preview]       │               │
│  Operations│                                            │               │
│  Alloc     ├────────────────────────────────────────────┴───────────────┤
│  stages    │  RESULTS / TRACE DOCK — per-node values, run output,        │
│            │  exceptions (V-rules), Base|Scenario Δ. Alteryx "Results".  │
└────────────┴─────────────────────────────────────────────────────────────┘
```

**Click-reduction rules (acceptance criteria, not aspirations):**
- Add a term = **one drag** from palette to canvas (no dialog).
- Configure a node = **inline in the inspector** (no modal dialogs anywhere in the build loop).
- **Run/Preview is one always-visible action** that paints values onto nodes + the dock.
- Save / Test / Submit-for-activation = **one split-button**, not three screens.
- **Drivers in place:** the param palette shows live governed values and allows a governed edit
  inline (routes through the existing `param:{key}` audit) — no trip to the Drivers tab for the
  common case.
- **Scenario in place:** a Base ⟷ Scenario toggle re-runs the graph under overrides and paints Δ on
  nodes — no trip to the Scenarios tab for the common case.
- The Builder modal is **retired** as the entry point; the cockpit is the home. Deep reference views
  (Runs job console, Lineage DAG, Data Catalog, Provenance) remain as drill-downs, not build-loop
  screens.

## Graph model
Nodes: `{id, type, config, position}`; edges: `{source, sourceHandle, target, targetHandle}`.
Two node families with **typed handles** (React Flow `isValidConnection` enforces compatibility):
- **Calc-value nodes** (output a Decimal scalar or Series): `param`, `measure`, `calc`, `const`,
  `op` (+ − × ÷), `func` (sum/min/max/abs), `if` (cond, then, else), `compare` (for conditions),
  `output` (terminal — the calc's result).
- **Allocation stage nodes** (typed, canonical order): `source` (cost-capture rule over CC/PC/GL),
  `pool`, `benefit_test` (exclusions), `allocate` (key), `markup` (policy), `charge`, `recon`. Each
  carries the Pool Builder config; a stage's value inputs (e.g. `markup.pct`, `allocate.key`) accept
  an edge from a calc-value subgraph.

Validation: DAG acyclic; exactly one `output` per calc graph; allocation handles enforce stage order;
unknown/under-specified config → the same V-rule BLOCK behavior (no silent defaults).

## Backend
- `backend/calc/graph.py` — the graph model + **bidirectional compiler**: `graph_to_expr(graph)` →
  expression string (compile a calc subgraph to `expr.py`), `expr_to_graph(expression)` → graph
  (auto-layout an existing formula calc for visualization), plus DAG/type validation. Stdlib +
  Decimal only; no new evaluation.
- Extend `backend/state/user_calcs.py`: store `graph_json`; `create`/`update`/`preview`/`test` accept
  EITHER an expression OR a graph (graph compiles to expression first — one code path downstream).
  Round-trip endpoint to fetch a calc's graph (compiled from its expression when only text exists).
- Extend `backend/state/authored_pools.py`: store `graph_json`; the stage-node graph compiles to the
  authored-pool `definition`; calc-bound stage inputs stored as expressions evaluated at run time.
- `backend/routers/calc_graph.py`: `GET /api/calc-graph/node-types` (palette catalog: node types +
  handle/config schemas), `POST /api/calc-graph/validate`, `POST /api/calc-graph/preview` (compile +
  evaluate, return per-node values + trace + exceptions). Calc graphs reuse user-calc preview;
  allocation graphs reuse authored-pool preview/test.

## Frontend
- Add `@xyflow/react`. `src/features/calc-studio/cockpit/` — `CockpitPage.tsx` (the 3-pane shell),
  `NodePalette.tsx`, `Canvas.tsx` (React Flow + custom node components per type + typed-handle
  `isValidConnection`), `NodeInspector.tsx` (inline config per node type), `ResultsDock.tsx`
  (per-node values, run output, exceptions, Base|Scenario Δ), `useGraphModel.ts` (graph state ↔ API).
- Route `/calc-studio/cockpit` becomes the default Calc Studio view; the existing Builder dialog is
  removed from the authoring path (its term-picker logic is reused by the inspector). Existing tabs
  remain reachable as drill-downs.

## Increments (gated MC1→MC4)
- **MC1 — Graph model + compiler (backend):** `calc/graph.py` graph↔expr compiler + validation;
  `user_calcs` graph_json + graph preview/test; node-types catalog. **GATE:** round-trip tests
  (graph→expr→eval == the equivalent formula's eval, Decimal-exact; expr→graph→expr semantically
  identical); a graph user-calc tests/activates/scenarios exactly like a formula one; full pytest.
- **MC2 — Cockpit + calc canvas (frontend):** the 3-pane cockpit with React Flow, palette, inline
  inspector, results dock, one-gesture add, one-action Run/Preview, split-button save/test/submit,
  inline driver edit, Base⟷Scenario toggle. Calc graphs round-trip with the formula bar. **GATE:**
  typecheck/build; live: drag param+measure+op → Run paints per-node values → split-button test →
  appears in registry; zero modal dialogs in the build loop.
- **MC3 — Allocation stage nodes:** typed stage nodes (Source→…→Recon) compiling to an authored-pool
  def; stage-order `isValidConnection`; calc-value nodes binding into stage numeric inputs; per-stage
  results from the dry-run; run via the existing authored-pool path. **GATE:** build an allocation
  graph on the canvas → preview captured cost → test (zero-residual recon, V-rule exceptions) →
  activate → run; governed allocation still cent-exact ($14,344,773.26) — golden.
- **MC4 — e2e + docs:** full cockpit loop both families; README/README-WORKFLOW (the cockpit becomes
  the calc story); provenance. Append a Decisions section.

## Reuses, doesn't rebuild
`expr.py` (eval/trace/scenario), `user_calcs` + `authored_pools` lifecycles, the allocation runner,
`review.decide()` maker-checker, the audit chain, the term-picker logic (lifted into the inspector),
`ProvenanceChip`, the existing scenario overlay. New: React Flow, `calc/graph.py`, the cockpit panes.

## Risks
- **React Flow bundle** (~45kB gz) — acceptable; lazy-load the cockpit route.
- **expr↔graph round-trip fidelity** — covered by identity tests; the expression remains the source
  of truth so the graph can always be regenerated.
- **Scope creep into a full tab-ectomy** — explicitly OUT: we add the cockpit as the home + retire the
  Builder modal; we do NOT delete the reference tabs this phase.
- **Allocation stage-graph validity** — typed handles + V-rules prevent invalid runs; no silent
  defaults.

House rules: Decimal money; append-only; no silent defaults; audit every mutation; golden
non-regression (governed allocation + existing endpoints unchanged); full pytest + typecheck/build per
increment; never hand-edit `backend/allocation/generated/`.
