# Phase 6 — Allocation Pool Builder (approved)

**Problem (user, viewing the scalar Calculation Builder):** "I don't see a way to build allocation
pools based on cost center / profit center / GL account." Correct — the scalar Builder's `measure()`
only reaches `segment_pl` (pre-aggregated entity P&L). Building a *pool* (cost-capture rule + key +
exclusion + markup) is the **allocation engine's** domain, which today is **seed-configured and
read-only** in the Allocations workbench. This phase adds an **authoring layer** on top of the
existing engine.

**User decisions (2026-06-11):** build the **Allocation Pool Builder** (not the scalar-palette
expansion); **full pipeline** (cost-capture mapping + exclusions + key + markup, author end-to-end +
run); **seed richer cost centers**, flagged fabricated, reconciling up to the real entity totals.

**Data reality (verified):** the journal (ACDOCA) carries real RCNTR/PRCTR/RACCT (8/8/17, 100%
populated, but coarse — one G&A cost center per entity). The allocation engine's cost lines are
fabricated at cost-center grain (`backend/seeds/allocation/cost_lines.v1.json`) beneath
warehouse-reconciled totals. So the richer CC layer is a *finer decomposition of the same totals*.

**Integration seams (from exploration):**
- `backend/services/allocation_runner.py:load_demo_dataset()` builds the dataset from seeds;
  `_execute_period()` assembles `ref` (entities/cc_mapping/pools/markup_policies/exclusions/
  key_defs/participation/key_values) before stages 1–7 → **the overlay injection point.**
- `backend/seeds/allocation/generate_seeds.py` `SERVICE_POOLS[*]["pure_ccs"]` (weights sum to 1.0,
  largest-remainder preserves totals) → **the richer-CC enrichment point.**
- Lifecycle template = `backend/state/user_calcs.py` (draft→tested→in_review→active) +
  `backend/state/review.py:decide()` hook (mirror the `ucalc:`/`scenario:` branches for `allocpool:`).
- V-rules already cover authored config (V-P1/2/5, V-B1/3, V-K1/3, V-M1/2/3) — same data shapes.
- UI: `src/features/calc-studio/tabs/AllocationsTab.tsx` `VIEWS` sub-nav → add a **Build pool** view.

## Design — authored pools are governed *experiments*, never corrupting the reconciled set
The seeded governed allocation (cent-exact to the warehouse) is **untouched**. An authored pool is a
self-contained, internally-consistent allocation (engine invariant pooled = exclusions + recovered +
**0 residual** still holds), governed by maker-checker, run through the **real Stages 1–7**, and
flagged **authored** (provenance-honest — it is not claimed to tie to the warehouse SERVICE pairs).
This delivers the full "build a pool from cost centers → run it → see charges/recon/trace/doc-pack"
experience without risking the existing tie-outs.

## Increments (gated PB1→PB4; stacked on `author-and-apply`)

### PB1 — Richer cost-center seed layer (backend)
Extend `generate_seeds.py`: (a) finer, function-realistic `pure_ccs` per pool (IT → IT-OPS-ERP /
IT-OPS-SUPPORT / IT-HOST-CLOUD / IT-HOST-COLO / IT-NET-MPLS / IT-NET-INET; RSS similarly), (b)
decompose the impure CORP center into Finance/HR/Legal/Facilities sub-centers, (c) add
**profit_center** + a realistic **cost_element/GL-account** to every cost line so pools can be built
by CC **and** PC **and** GL account. All weights sum to 1.0 → per-pool/per-entity/per-period totals
preserved. Regenerate cost_lines + cc_mapping seeds; flag fabricated; surface the richer layer in the
provenance dashboard. **GATE:** existing M4 cent-exact tie-outs (FY cb $13,586,402.70 / gross
$14,344,773.26, exclusions $4.25M/$2.70M) stay green; new test asserts richer CCs sum to the prior
totals; cost lines now carry cost_center + profit_center + cost_element; full pytest + typecheck/build.

### PB2 — Authored-pool store + engine integration (backend)
`authored_pools` SQLite table + `backend/state/authored_pools.py` (mirror `user_calcs.py`:
draft→tested→in_review→active, version, audited at `allocpool:{id}`, maker-checker via a new branch in
`review.decide()`). An authoring object = {name, provider, service_line, characterization,
cost_base_definition, **cost_capture_rule** (predicates over cost_center / profit_center /
cost_element, optional split %), beneficiaries (entity ids), **key** (key_factor ∈ {Equal, Revenue,
Cost} → factor values computed from the warehouse per beneficiary, total recomputed by the engine —
V-K3), exclusions [{type, amount|pct, rationale}], markup_policies [{jurisdiction, regime, pct}]}.
`backend/routers/authored_pools.py`: CRUD + `validate` + **`preview`** (evaluate the capture rule over
cost lines → captured $ / line count / by-entity, no persist) + **`test`** (dry-run the authored pool
through Stages 1–7 in isolation → charges/recon/exceptions/trace, no governed run; sets tested) +
`submit-activation`. Runner: a new authored allocation run (`run_type="authored"` or a flag) overlays
active authored pools into `_execute_period`'s `ref` and runs them, flagged authored. **GATE:** preview
captured-cost correct for a CC/PC/GL rule (tie to a hand-summed subset of cost lines); test dry-run →
internal zero-residual recon + V-rule exceptions surface; maker≠checker enforced; authored run balanced
+ flagged authored; **existing governed runs byte-identical (golden)**; full pytest.

### PB3 — Pool Builder UI (frontend)
`AllocationsTab.tsx` gains a **Build pool** view (7th sub-nav entry): pool-metadata form (name,
provider, service line, characterization, cost-base); a **cost-capture rule builder** — multiselect
cost centers / profit centers / GL accounts (from a new `/api/allocation/dimensions` listing the
distinct values with their cost), with a **live preview** card ("captures $X across N cost lines →
these entities"); beneficiary multiselect; key-factor picker (Equal / Revenue / Cost); exclusion rows;
markup-policy rows per jurisdiction; **Preview** + **Test run** (renders the dry-run charges/recon/
exceptions + a TraceTree); Save draft → Submit for activation (review-queue toast, maker-checker);
authored-pool list with status chips; "Run authored allocation" → charges/recon visible (reuse the
existing Recon/Charges renderers). Authored rows carry an **authored** chip everywhere. **GATE:**
typecheck/build; live: build a pool from cost centers → preview shows captured cost → test → activate
(approve as different actor) → run → recon Balanced.

### PB4 — e2e verify + docs
Full loop live (richer CCs → build pool from CC/PC/GL → preview → test → maker-checker activate → run
→ recon balanced → doc pack). README + README-WORKFLOW (Flow 3 gains the authoring path, or a new
"build & run a pool" flow). Provenance dashboard shows the richer CC layer + authored pools as
fabricated/authored. Append a Decisions section here.

House rules: Decimal money; append-only; no silent defaults (missing key/markup = BLOCK, never
defaulted); audit every mutation; mirror existing patterns; golden non-regression (governed allocation
+ all existing endpoints unchanged); full pytest + typecheck/build gates per increment; never hand-edit
`backend/allocation/generated/`.
