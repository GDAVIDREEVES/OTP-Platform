# SPEC — Intercompany Cost Allocation Engine (OTP Services Module)

> Implementation specification for an operational transfer pricing (OTP) cost-to-charge engine covering intra-group services under OECD TPG Chapter VII and US Treas. Reg. §1.482-9. This spec is written for execution by Claude Code. The companion files `intercompany-allocation-schema.json` (machine source of truth) and `intercompany-allocation-schema.md` (human rendering) define the data model; this document defines behavior, algorithms, validations, APIs, and acceptance criteria.

---

## 0. Reading order for Claude Code

1. Read `CLAUDE.md` (conventions, source-of-truth rules).
2. Read `intercompany-allocation-schema.json` — generate types and DDL from it, never hand-write entity shapes.
3. Read this `SPEC.md` end to end before writing code.
4. Implement in the milestone order of §10. Do not skip ahead: each milestone's tests gate the next.

---

## 1. Goal and non-goals

**Goal.** A deterministic, auditable engine that transforms source cost lines into intercompany service charges:

```
GL/ACDOCA cost lines → pool → benefit-test gate → allocate (key or direct)
→ cost base + markup → charge-out (FX, VAT/WHT attrs) → reconcile & true-up
```

Every output charge must be **reconstructable from immutable inputs**. Documentation is a **byproduct of the run**, not a separate step.

**Non-goals (v1).**
- Tangible goods pricing, royalties, CSAs, and financing returns. The engine must *classify and reject* these flows (route to a holding table), not process them.
- Benchmarking studies themselves (the engine consumes a markup %, it does not derive one).
- Actual invoice generation / ERP write-back (v1 produces a charge ledger + posting file; integration is v2).
- Statutory VAT/WHT calculation engines (v1 stores treatment attributes and simple rate-based amounts).

---

## 2. Stack and repo layout

Decisions (chosen to match the existing Next.js / DuckDB / BigQuery toolchain — change only with explicit instruction):

- **Language:** TypeScript (strict mode) end to end. The engine is a **pure, side-effect-free library**; persistence and UI are adapters around it.
- **Local/dev database:** DuckDB. **Production warehouse:** BigQuery. One SQL dialect adapter layer; engine logic never embeds dialect-specific SQL.
- **App shell:** Next.js (App Router) for the review UI and API routes. Engine runs in Node (API route / worker), never in the browser.
- **Validation:** Zod schemas **generated from** `intercompany-allocation-schema.json`.
- **Money:** integer minor units (e.g., cents) or `decimal.js` — never IEEE floats for amounts. Pick `decimal.js`; precision 28; rounding HALF_EVEN. All rounding happens at defined boundaries only (§5.6).
- **Testing:** Vitest. Golden-run fixture tests are the primary acceptance mechanism (§9).

```
/otp-allocation
  /packages
    /engine            # pure library: stages, algorithms, validations
      /src
        /stages        # stage1_capture ... stage7_reconcile
        /algorithms    # apportionment, cascade, reciprocal, trueup
        /validation    # rule catalogue (§7)
        /types         # GENERATED from schema.json — do not hand-edit
      /test
        /golden        # golden-run fixtures (§9.2)
    /persistence       # DuckDB + BigQuery adapters, migrations (DDL generated from schema.json)
    /codegen           # schema.json -> types, zod, DDL, dbt schema.yml
  /apps
    /web               # Next.js review UI (runs view, recon dashboard, exceptions)
  /docs
    SPEC.md            # this file
    intercompany-allocation-schema.json
    intercompany-allocation-schema.md
  CLAUDE.md
```

---

## 3. Data model

The 11 entities + enumerations are defined in `intercompany-allocation-schema.json`. Implementation notes that go beyond the schema file:

1. **Immutability.** `1_CostLine`, `7_KeyValue`, `10_ChargeLedger`, `11_Recon` are append-only. Corrections are reversing rows, never updates. Reference entities (`2,3,4,5,6,8,9`) are versioned via `effective_from`/`effective_to` (+ `version` where present); a run resolves reference data **as-of the run period**, and re-running a historic period must reproduce historic results bit-for-bit.
2. **Run scoping.** Add a `run_id` column to every engine-written table (already on `11_Recon`; extend to `10_ChargeLedger` rows written by a run). A `runs` table records: `run_id`, period, scope (pools/entities), engine version, schema version, input snapshot hashes, started/finished, status.
3. **Multi-provider pools.** v1 keeps `provider_entity_id` on `3_Pool` (single provider per pool). Enforce with a validation, and model multi-provider needs as separate pools per provider. (Documented design decision; revisit in v2 via `9_Participation.role = Provider`.)
4. **Self-referencing FK.** `10_ChargeLedger.true_up_parent_charge_id` references the same table; enforce in application logic (BigQuery has no FK constraints anyway — *all* referential integrity is engine-enforced, see §7).

---

## 4. Engine architecture

Each stage is a pure function: `(inputs, refData, config) -> { outputs, exceptions[], log[] }`. Stages compose into a `Run`. No stage reads the database directly — a thin orchestration layer loads inputs, snapshots them (hash recorded on the run), executes stages, and persists outputs atomically (all-or-nothing per run).

```
orchestrator
  ├─ loadInputs(period, scope)         // snapshot + hash
  ├─ stage1_captureAndClassify
  ├─ stage2_pool
  ├─ stage3_benefitTestGate
  ├─ stage4_allocate                   // direct + indirect, cascade-aware
  ├─ stage5_costBaseAndMarkup
  ├─ stage6_chargeOut                  // FX, VAT/WHT attrs, posting file
  ├─ stage7_reconcileAndTrueUp
  └─ persistRun                        // atomic; emits documentation pack
```

### Stage contracts

**Stage 1 — Capture & classify.** Input: raw cost lines. Behavior: validate against schema; derive `function` and candidate `pool_id` via `2_CCMapping` (apply `allocation_split_pct` by splitting the line into child lines whose amounts sum exactly to the parent — remainder cent assigned to the largest split); tag `flow_type`; route non-`Service` flows to `excluded_flows` holding table with reason. Output: classified cost lines.

**Stage 2 — Pool.** Group classified lines into pools per `3_Pool`. Separate three streams: (a) **direct-charge** lines (`charge_method = Direct`, `traceable_recipient_id` set) — bypass Stage 4 apportionment; (b) **pass-through** lines (`pass_through_flag = TRUE`) — bypass markup, charge at cost to the traceable recipient; (c) **poolable** lines. Emit pool totals with full lineage (pool → constituent line IDs).

**Stage 3 — Benefit-test gate.** Apply `5_Exclusions` per pool: percentage carve-outs reduce the pool pro-rata across constituent lines (lineage preserved); fixed-amount exclusions deduct from the pool with a documented basis. A pool may have multiple exclusions; apply percentage exclusions to the *original* pool total (not compounding) unless the exclusion row says otherwise, and validate combined exclusions ≤ 100%. Output: chargeable pool base + exclusion ledger (amount, type, rationale) per pool.

**Stage 4 — Allocate.** For each pool: resolve beneficiary population from `9_Participation` (as-of period, role = Beneficiary, entity active per `8_Entity` effective dates). Resolve key (`3_Pool.default_key_id` → `6_KeyDef` → `7_KeyValue` rows for the period). Compute `allocation_ratio = factor_value / total_factor_value` where `total_factor_value` is recomputed by the engine over the *resolved* beneficiary set (never trusted from input — see V-K3). Apportion using the largest-remainder method so allocated amounts sum exactly to the chargeable base. Cascading and reciprocal handling per §5.2–5.3.

**Stage 5 — Cost base & markup.** Resolve `4_MarkupPolicy` by (pool, recipient jurisdiction, period). Apply `markup_pct` to the allocated cost. Regime rules: `LVAIGS` fixed 5% (warn if policy says otherwise); `SCM` and `Pass-through` must be 0%; `Benchmarked` requires `benchmark_study_ref` non-null. Missing policy for a (pool, jurisdiction) is a blocking exception — never default a markup.

**Stage 6 — Charge-out.** Build `10_ChargeLedger` rows: convert to recipient currency using the configured `fx_rate_type` (rate table is an input snapshot, rate + date logged per charge); attach `vat_gst_treatment`, `wht_rate`/`wht_amount` from a simple jurisdiction-pair rules table (v1: lookup table, no tax engine); emit a posting file (CSV/JSON) per provider entity. v1 does **not** write to any ERP.

**Stage 7 — Reconcile & true-up.** Per (pool, provider, period): `total_pooled_cost − total_exclusions − total_cost_recovered = unallocated_residual`; status `Balanced` iff residual is zero *after* largest-remainder apportionment (a nonzero residual means a logic or participation gap, not rounding). True-up: recompute the full year on actuals, subtract booked in-year (Budget) charges per (pool, provider, recipient), and emit delta rows with `budget_or_actual = True-up` and `true_up_parent_charge_id` populated. Emit the documentation pack (§8).

---

## 5. Algorithms

### 5.1 Apportionment (largest remainder)

```
function apportion(base: Decimal, ratios: Map<recipient, Decimal>): Map<recipient, Decimal>
  raw[r]   = base * ratios[r]
  floor[r] = round_down(raw[r], minor_unit)
  residual = base - sum(floor)
  distribute residual one minor unit at a time to recipients in descending
  order of (raw[r] - floor[r]); tie-break by recipient_entity_id ascending (determinism)
  assert sum(result) == base exactly
```

### 5.2 Cascading (multi-tier) allocation

Tiers come from `8_Entity.tier`. Build a directed graph: node = (provider entity, pool); edge = charge into a recipient that is itself a provider of a downstream pool. Run pools in **topological order**; a tier-1 charge received by a hub becomes a cost line in the hub's books (`cost_nature = Intercompany charge received`, full lineage to the originating charge) and joins the hub's own pool for tier-2 allocation.

**Margin policy:** config flag `cascadeMarkupPolicy: "single" | "perTier"`, default `"single"` — the received charge passes through downstream tiers at its already-marked-up amount with **no further markup on that component** (the hub's *own* costs in the pool still get the hub's markup). Implement by carrying a `markup_exempt_component` amount on pooled costs originating from upstream charges. `"perTier"` re-margins everything and must emit a warning on every run (double-margining must be deliberate).

### 5.3 Reciprocal allocation (simultaneous equations)

If the graph has cycles (A provides to B, B provides to A), topological ordering fails. Detect cycles (Tarjan SCC). For each strongly connected component, solve the standard reciprocal-method system:

```
Let S_i = total cost of service department i = direct pool cost_i + Σ_j (S_j × a_ji)
where a_ji = share of department j's services consumed by department i (from keys).
Solve the linear system S = C + AᵀS  →  S = (I − Aᵀ)⁻¹ C
then charge external (non-SCC) recipients from the solved S_i at their key shares.
```

Use Gaussian elimination on Decimal (SCCs are small — handful of entities); fall back to iterative substitution with convergence tolerance 1e-10 if a matrix is near-singular, and raise a blocking exception if not converged in 1,000 iterations. Markup applies once on each department's *own* cost component, consistent with §5.2 `"single"`.

### 5.4 True-up

In-year runs use `budget_or_actual = Budget` pools and keys. The annual true-up run: (1) recompute all periods on Actuals; (2) per (pool, provider, recipient, year): `delta = actual_full_year − Σ booked Budget charges`; (3) emit one True-up charge per triple with FX at the configured true-up rate (default: year-end closing rate; config). Record `true_up_delta` on `11_Recon` and flag pools where `|delta| / actual_full_year > trueUpWarnThreshold` (default 10%) as a KPI exception.

### 5.5 Effective-dating resolution

`resolveAsOf(refTable, period)`: a row is in scope iff `effective_from ≤ period_end` and (`effective_to` is null or `≥ period_start`). Entities entering/leaving mid-period participate pro-rata only if config `midPeriodProration = true` (default false: in/out per whole period, the common practical convention).

### 5.6 Rounding boundaries

Rounding occurs at exactly three points: (1) apportionment output (largest remainder, exact-sum), (2) markup amount per charge (HALF_EVEN to minor unit), (3) FX conversion per charge (HALF_EVEN to minor unit of target currency). All intermediate math is full-precision Decimal. Never round inside a loop accumulator.

---

## 6. Configuration

Single typed config object per run (persisted with the run):

```ts
{
  period: string;                  // "2026-03" or "2026" for true-up
  runType: "budget" | "actual" | "trueup";
  scope: { poolIds?: string[]; providerEntityIds?: string[] }; // default: all active
  cascadeMarkupPolicy: "single" | "perTier";   // default "single"
  midPeriodProration: boolean;                  // default false
  fxRateType: "spot" | "monthly_average" | "fixed_budget";
  trueUpFxRateType: "year_end_closing" | "annual_average";
  trueUpWarnThreshold: number;                  // default 0.10
  unallocatedResidualTolerance: 0;              // hard zero in v1
}
```

---

## 7. Validation catalogue

Every rule has an ID, severity (`BLOCK` halts the run for the affected pool; `WARN` logs an exception, run continues), and a test. Implement as composable rule functions; the run report lists every fired rule.

**Referential & schema**
- V-R1 `BLOCK` — every FK in `schema.json` `references` must resolve (engine-enforced; warehouse has no constraints).
- V-R2 `BLOCK` — enum fields validate against `enumerations`.
- V-R3 `BLOCK` — amounts non-negative except explicit reversal rows.

**Pooling & mapping**
- V-P1 `BLOCK` — every Service cost line maps to exactly one pool (post split); unmapped cost centers → exception queue.
- V-P2 `BLOCK` — `allocation_split_pct` per cost center sums to 100%.
- V-P3 `WARN` — pool homogeneity drift: a pool receiving lines from > N (default 25) distinct cost centers or > 1 function.
- V-P4 `BLOCK` — pass-through lines must have `traceable_recipient_id` and must never receive markup.
- V-P5 `BLOCK` — single provider per pool (v1 constraint, §3.3).

**Benefit test**
- V-B1 `BLOCK` — combined exclusions on a pool ≤ 100% of pool.
- V-B2 `WARN` — pool with `service_line ∈ {Management}` and no stewardship exclusion row (likely missing carve-out).
- V-B3 `BLOCK` — every exclusion row has non-empty `basis_rationale`.

**Keys**
- V-K1 `BLOCK` — key values exist for every beneficiary in the resolved population for the period (no silent zeroes).
- V-K2 `BLOCK` — `as_of_date` within freshness window (config; default: within the run period for dynamic keys, within 12 months for static).
- V-K3 `BLOCK` — engine-recomputed `total_factor_value` equals Σ `factor_value` over the resolved population; ratios sum to 1 within 1e-12 before apportionment.
- V-K4 `WARN` — key changed vs. prior year for the same pool (consistency scrutiny).

**Markup**
- V-M1 `BLOCK` — markup policy exists for every (pool, recipient jurisdiction).
- V-M2 `BLOCK` — regime/markup coherence: SCM & Pass-through = 0%; LVAIGS = 5%; Benchmarked requires `benchmark_study_ref`.
- V-M3 `BLOCK` — SCM policies require `scm_eligibility_basis ≠ n/a` and non-empty `business_judgment_conclusion`.
- V-M4 `WARN` — same pool charged under LVAIGS in one jurisdiction and Benchmarked > 5% elsewhere without a documentation_ref (divergence is fine; undocumented divergence is not).

**Cascade & reciprocal**
- V-C1 `BLOCK` — cycle detected and reciprocal solver disabled/unconverged.
- V-C2 `WARN` — `perTier` margin policy in effect (every run).
- V-C3 `BLOCK` — upstream charge lineage missing on a received-charge cost line.

**Reconciliation**
- V-X1 `BLOCK` — `unallocated_residual ≠ 0` (v1 hard zero).
- V-X2 `BLOCK` — Σ charges out (cost component) per pool = chargeable base exactly.
- V-X3 `WARN` — true-up exceeds `trueUpWarnThreshold`.
- V-X4 `BLOCK` — historic re-run hash mismatch (same inputs must yield identical outputs).

---

## 8. Outputs of a run

1. **Charge ledger rows** (`10_ChargeLedger`) + **recon rows** (`11_Recon`).
2. **Posting file** per provider (CSV + JSON): provider, recipient, period, gross amount, currency, account hints, invoice-required flag.
3. **Documentation pack** (Markdown per pool per period, generated, stored under `runs/{run_id}/docs/`): pool description & characterization; cost composition by nature; exclusions applied with rationale; beneficiary population & benefit rationale; key used, source, values, ratios; cost base, regime, markup & basis; resulting charges; recon tie-out. This is the local-file support artifact — treat its generator as production code with tests.
4. **Exception report**: every V-rule fired, severity, affected objects, suggested remediation.

---

## 9. Testing & acceptance

### 9.1 Unit tests
Per stage and per algorithm. Mandatory edge cases: zero-cost pool; single-beneficiary pool; beneficiary with zero key value; pool that is 100% excluded; pass-through inside a marked-up pool; entity entering mid-year; split cost center remainder cent; FX to a zero-decimal currency (JPY).

### 9.2 Golden run (primary acceptance)
A hand-computed fixture in `/packages/engine/test/golden/`, asserted to the cent:

- 6 entities: US parent (LE-US, provider, tier 1), EU hub (LE-NL, tier 2, provider *and* recipient), 3 OpCos (DE, FR, JP), plus LE-UK which both provides Finance to LE-NL and receives IT from it (**reciprocal pair**).
- 3 pools: IT-Infra (LVAIGS 5% in EU, **SCM 0% for the US-leg recipient**), Management (30% stewardship carve-out, multi-factor key), Finance SSC (transactions key, cascades through the hub).
- 12 Budget months + Actual year + true-up, with actuals diverging ~8% on one pool and 15% on another (one under, one over the warn threshold).
- Assertions: every charge amount; every recon row balanced with zero residual; reciprocal solution matches the hand-solved linear system; true-up deltas; exactly the expected V-rules fire (V-X3 once, V-C2 never under default config); re-run reproduces identical hashes.

### 9.3 Property tests
For random pools/keys: Σ allocations = chargeable base exactly; apportionment determinism under input reordering; reciprocal solver conservation (total cost in = total charged out across the SCC).

---

## 10. Milestones (gated)

1. **M1 Codegen & persistence** — `schema.json` → types/Zod/DDL (DuckDB + BigQuery), migrations, `runs` table. *Gate:* round-trip insert/load of every entity in both dialects.
2. **M2 Stages 1–3** — capture/classify, mapping splits, pooling, exclusions. *Gate:* unit tests + V-P/V-B rules green.
3. **M3 Stage 4 flat** — single-tier apportionment, largest remainder, key validations. *Gate:* exact-sum property tests.
4. **M4 Stages 5–6** — markup policy resolution, FX, charge ledger, posting file. *Gate:* V-M rules; golden subset (flat pools) to the cent.
5. **M5 Cascade & reciprocal** — topo ordering, received-charge cost lines, SCC solver, margin policy. *Gate:* reciprocal fixture matches hand solution.
6. **M6 Stage 7** — recon, true-up, documentation pack, exception report. *Gate:* full golden run green, including hash-reproducibility.
7. **M7 Review UI** — Next.js: run launcher, recon dashboard (residuals, true-up KPIs), exception queue, charge drill-down to cost-line lineage, documentation pack viewer.

---

## 11. Out-of-scope guardrails for Claude Code

- Do not hand-edit anything under `/packages/engine/src/types` — regenerate from `schema.json`.
- Do not introduce float arithmetic for amounts anywhere, including tests.
- Do not add a default markup, default key, or default jurisdiction policy "to make the run pass" — missing policy is a blocking exception by design.
- Do not collapse Budget/Actual/True-up into recomputed-in-place rows — the ledger is append-only.
- Any change to the data model goes through `schema.json` first, then codegen, then code.
