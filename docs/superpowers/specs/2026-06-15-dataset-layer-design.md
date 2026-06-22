# Phase 8 — Dataset / Data-Prep Layer (approved design)

**Ask (user):** "I need to see the ACDOCA fields and all G/L accounts, cost center and profit centers
as available to build the calculations. Additionally, I should be able to build more complex joins and
other methods of building out cost pools, datasets."

**Why the gap exists:** the cockpit's `measure()` term only reaches `segment_pl` (pre-aggregated
entity P&L) because `backend/calc/expr.py:MEASURE_TABLES` deliberately whitelists that one table. The
journal (ACDOCA — `RACCT` GL account, `RCNTR` cost center, `PRCTR` profit center, `HSL` amount, …) is
unreachable, and there are no join/aggregate/filter "data-prep" tools to build datasets or pools from
raw ACDOCA.

**Approved decisions (2026-06-15):**
1. **Full data-prep node layer** — Source + Filter + Aggregate + Join + Union + Derive/Select nodes,
   compiling to safe parameterized DuckDB SQL, with per-node tabular preview.
2. **First-class authored datasets** — a dataset is a saved, governed, reusable object (draft→tested→
   in_review→active, audited at `dataset:{id}`), feeding BOTH calculations and allocation pool cost
   bases.
3. **Expose real ACDOCA + the fabricated fine cost_lines, both provenance-flagged.**

## Core principle — DuckDB stays the engine (mirrors "no new evaluator")
The warehouse tables are already DuckDB views (`backend/db.py` `_VIEWS`: journal_entries, segment_pl,
supply_chain_flows, entity_roles) queried through a safe parameterized helper (`db.q(sql, params)`),
and `backend/calc/warehouse.py:aggregate()` is the template for a query builder. A dataset subgraph
**compiles to one safe parameterized DuckDB query** (a CTE chain) — column names always from an
allowlist, values always bound (the exact `MEASURE_TABLES` injection-safety discipline, generalized).
No new data engine. Money stays Decimal (DuckDB DECIMAL / SUM over `HSL`).

## Node families (a third family on the cockpit canvas)
Alongside calc-value nodes (Phase 7 MC1/2) and allocation stage nodes (MC3), add **dataset nodes** with
their own *relation* handles (distinct from value handles and stage handles; `isValidConnection`
keeps the families separate except at the defined bridges):
- **`source`** — one per warehouse view + the allocation `cost_lines`. The **journal/ACDOCA source
  exposes the full meaningful field set** (dimensions `RBUKRS, RACCT, RCNTR, PRCTR, GJAHR, POPER,
  SEGMENT, BLART, DRCRK`, measures `HSL` (+ `KSL/OSL` if useful), key doc/currency fields) and the
  real distinct GL/CC/PC value lists; each source carries provenance (journal/segment_pl/supply_chain/
  entity_roles = real; allocation cost_lines = fabricated). Output: a relation (named, typed columns).
- **`filter`** — predicates over allowlisted columns (`=, !=, <, >, <=, >=, IN, BETWEEN, LIKE`), values
  bound. **`aggregate`** — group-by columns + measures (`SUM/COUNT/AVG/MIN/MAX`). **`join`** — two
  relation inputs, inner/left on keys, selected output columns. **`union`** — stack two
  schema-compatible relations. **`derive`/`select`** — add safe computed columns (arithmetic over
  columns) / pick columns. Terminal output: a dataset relation.

Validation: DAG acyclic; columns/ops only from the allowlist; join keys exist on both inputs; union
schemas compatible; unknown column/op → precise error (no silent defaults).

## First-class authored datasets
`authored_datasets` SQLite table + `backend/state/authored_datasets.py` (mirror `authored_pools.py`/
`user_calcs.py`: lifecycle draft→tested→in_review→active, version, audited at `dataset:{id}`,
maker-checker via a new branch in `review.decide()`). Definition = the dataset subgraph `graph_json`
(compiled to SQL). `backend/routers/authored_datasets.py`: CRUD + validate + **preview** (compile +
run → columns / sample rows / row count, no persist) + **test** (full run, sets tested) +
submit-activation. An **active dataset is referenceable**: a `dataset` source node (and a `dataset()`
term where a calc needs it) resolves it.

## Bridges (the payoff)
- **Calc bridge:** a dataset → `aggregate` to a scalar/series → consumed by a calc-value node (so a
  formula/graph calc can use journal-grained GL/CC/PC data). expr.py/graph.py gain a `dataset` source
  resolution where a value is needed.
- **Allocation bridge:** an authored dataset whose columns map to cost-line shape (provider,
  cost_center, profit_center, cost_element, amount, period) can be an allocation **Source stage's cost
  base** — `authored_pools` cost_capture_rule gains an optional `dataset_id` source (vs the current
  `cost_lines` seed). So you **build a cost pool by joining/filtering the ACDOCA journal**.

## Cockpit integration
Palette gains a **"Datasets / ACDOCA"** group (source tables w/ provenance chips + the data-prep ops +
saved active datasets). Canvas renders dataset nodes (distinct visual family, relation handles).
Inspector configures each inline (column pickers from the allowlist, join keys, group-by + measures,
filter predicates). Results dock shows the **tabular preview** (columns + sample rows + row count) per
node. No modal dialogs (cockpit rule holds).

## Increments (gated DS1→DS4)
- **DS1 — Dataset compiler + source registry (backend):** `backend/calc/dataset.py` (graph→safe
  DuckDB SQL for source/filter/aggregate/join/union/derive/select via `db.q`), a `DATASET_TABLES`
  allowlist exposing all 4 warehouse views (full ACDOCA journal fields + dims) + allocation
  `cost_lines` (flagged), `POST /api/dataset/preview` (compile + run → columns/rows/count) + validate,
  `GET /api/dataset/sources` (palette: tables, columns, provenance, distinct GL/CC/PC values).
  **GATE:** SQL builds + injection-safe (allowlist enforced, values bound); a journal filter+aggregate
  by RACCT/RCNTR/PRCTR matches a hand DuckDB query to the cent on `HSL`; a journal×entity_roles join
  works; full pytest + typecheck/build.
- **DS2 — Authored-datasets store + lifecycle (backend):** `authored_datasets` table + state module +
  router (CRUD/validate/preview/test/submit-activation, maker-checker `dataset:{id}`); node-types
  catalog (`/api/calc-graph/node-types`) gains the dataset family + active authored datasets as
  sources. **GATE:** lifecycle + maker≠checker; an active dataset resolves as a source; full pytest.
- **DS3 — Cockpit dataset nodes + bridges (frontend + backend bridge):** palette Datasets group,
  dataset node components (relation handles, distinct family), inline inspector pickers, tabular
  preview in the dock; the **calc bridge** (dataset→aggregate→value) and the **allocation bridge**
  (authored dataset → pool Source cost base; `authored_pools` cost_capture_rule optional `dataset_id`).
  **GATE:** typecheck/build; live: build journal source→filter(GL/CC)→aggregate(by PRCTR) → preview
  shows rows; a dataset feeds a calc; a dataset becomes a pool cost base; governed allocation still
  cent-exact ($14,344,773.26) — golden.
- **DS4 — e2e + docs:** full loop (join+filter+aggregate over ACDOCA GL/CC/PC → preview → save →
  maker-checker activate → use in a calc AND as a pool cost base → run); README/README-WORKFLOW;
  provenance dashboard shows real ACDOCA sources vs fabricated cost_lines. Append a Decisions section.

## Reuses, doesn't rebuild
`db.q` + the DuckDB views (the engine), `calc/warehouse.aggregate` pattern, `expr.py`/`graph.py`
(the cockpit graph model + node-types catalog), `authored_pools`/`user_calcs` lifecycle templates,
`review.decide()` maker-checker, the audit chain, `ProvenanceChip`, the cockpit panes. New: the
dataset family + `calc/dataset.py` + `authored_datasets`.

## Risks
- **ACDOCA field sprawl** — the journal has hundreds of mostly-null SAP columns; expose a curated,
  generous, real subset (dimensions + meaningful measures), NOT every column. Documented allowlist.
- **Join correctness/perf** — small demo data (58k journal rows); inner/left only in v1; keys from the
  allowlist; preview row-capped.
- **Provenance honesty** — real ACDOCA (coarse real CCs) vs fabricated fine cost_lines are distinct,
  clearly tagged sources; never silently mixed.
- **Decimal** — all money via DuckDB DECIMAL / Python Decimal; no float on amounts incl. tests.

House rules: Decimal money; append-only; no silent defaults; audit every mutation; golden
non-regression (governed allocation + existing endpoints unchanged); injection-safety tested; full
pytest + typecheck/build per increment; never hand-edit `backend/allocation/generated/`.
