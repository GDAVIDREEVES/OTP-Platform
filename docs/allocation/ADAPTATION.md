# Allocation Engine — Demo Adaptation Plan (authoritative for this build)

`docs/allocation/SPEC.md` defines **behavior** (stages, algorithms, V-rules, golden run) and
`intercompany-allocation-schema.json` defines the **data model** — both are followed faithfully.
This document records the **explicitly instructed adaptations** to the OTP-Platform demo
(per SPEC §2 "change only with explicit instruction"; user decisions 2026-06-10).

## D1 — Stack: Python, in-demo (supersedes SPEC §2 TypeScript monorepo)
- Engine = `backend/allocation/` — **pure** Python package (no I/O): `stages/`, `algorithms/`,
  `validation/`, `generated/` (codegen output — never hand-edit).
- Money = Python `decimal.Decimal`, precision 28, ROUND_HALF_EVEN; rounding only at SPEC §5.6's
  three boundaries. **No float math on amounts, including tests** (pytest, not Vitest).
- Codegen (M1) = `backend/allocation/codegen.py`: schema.json → `generated/types.py`
  (TypedDicts + enums), `generated/ddl.sql` (SQLite dialect), seed validators. schema.json is the
  only source of truth for entity shapes.
- Persistence = house style: reference entities (sheets 2,3,4,5,6,8,9) as **seeds**
  (`backend/seeds/allocation/*.v1.json`, registered in `state/seeds.py`); append-only ledgers
  (1_CostLine, 7_KeyValue, 10_ChargeLedger, 11_Recon) + `allocation_runs` as **SQLite tables**
  (DDL from codegen, appended to schema.sql include path). Append-only enforced in the state layer
  (corrections = reversing rows). BigQuery adapter: out of scope for the demo (documented deviation).
- Orchestrator = `backend/services/allocation_runner.py`: loads + hashes input snapshot, runs
  stages, persists atomically, emits the documentation pack. Registered as calculation
  **`service_allocation`** in the Calc Studio registry → runs appear in the job console, audit
  `run` events at `calc:service_allocation`, shaped trace = the 7 stage outputs (PaPM value-flow).
- API = `backend/routers/allocation.py`: run launch (maker-checker optional), runs/charges/recon/
  exceptions/doc-pack reads, drill charge→cost lines.

## D2 — Demo dataset: reconciled to the demo (generator-derived, not hand-typed)
A committed generator (`backend/seeds/allocation/generate_seeds.py`) derives the seed set FROM the
warehouse at authoring time (reconciliation by construction, CbCR-style):
- Providers **1000** (US parent) + **3100** (CH RHQ). Recipients per actual SERVICE pairs:
  1000→3000; 3100→3200/3300/3800. Periods = the 4 actual SERVICE billing periods of FY2026.
- **Exact contracts (engine-enforced, test-asserted to the cent):**
  - Stage-4 allocated cost per (provider, recipient, FY) == `supply_chain` SERVICE pair
    `Σ STANDARD_COST×TOTAL_VOLUME` (key values = measured consumption units derived from pair cb).
  - Stage-3 exclusions == the OTP-15 stewardship register's flagged lines (fixed-amount,
    rationale carried over): 1000 = $4,250,000; 3100 = $2,700,000.
  - Recon: pooled(P) = charged cb(P) + exclusions(P), residual 0 (V-X1).
    (Pooled ≈ provider G&A + service-cost slice; opex_ga 1000=$10.98M, 3100=$10.19M.)
  - Stage-5 gross per (provider, recipient, FY) == SERVICE pair `Σ TOTAL_LEGAL_PRICE`, via
    **jurisdiction-benchmarked markup policies** set to the pair-effective rates
    (DE 5.6133%, FR 5.7887%, GB 5.4421%, NL 5.4219% — each "benchmarked study" per local file).
  - Per-period engine charges are policy-smooth; actual per-period postings are noisy →
    **FY totals tie to the cent; in-period differences are the policy-vs-posted story** (feeds OTP-43).
- Pools: IT-Infra (1000, benchmarked), Regional Shared Services (3100, benchmarked),
  Management (both, stewardship exclusions, LVAIGS where charged). Cost lines seeded at
  cost-center grain (fabricated beneath reconciled totals — flagged, like all demo seeds).
- Budget run data: budget cost lines/keys ≈ actual ±8–15% on selected pools → true-up demo
  fires V-X3 once.

## D3 — Golden run: test-only fixture (SPEC §9.2 verbatim)
The 6-entity golden fixture (LE-US, LE-NL hub, DE/FR/JP, LE-UK reciprocal) lives ONLY in
`backend/tests/allocation/golden/` — hand-computed, asserted to the cent, exercising cascade,
reciprocal (Tarjan SCC + Decimal Gaussian elimination), SCM US-leg, true-up, and hash
reproducibility. The demo dataset stays flat (the real SERVICE story has no cascade); cascade +
reciprocal are proven by the golden gate, not faked into demo data.

## D4 — UI: Calc Studio "Allocations" workbench (SPEC M7 adapted)
One new Calc Studio tab **Allocations** (`/calc-studio/allocations`) with an internal sub-nav:
**Run console** (launch budget/actual/true-up, status, input-hash) · **Pools & policies** (pools,
keys, markup policies, exclusions — read-mostly rule-card style, params link to Drivers) ·
**Recon dashboard** (pooled = exclusions + recovered + 0 tie-out per pool, true-up KPIs) ·
**Exceptions** (V-rule report, severity chips) · **Charges** (ledger w/ drill charge → cost lines)
· **Doc packs** (generated Markdown per pool/period). Thin wiring: OTP-10 binding gains a
"Powered by the allocation engine" link; OTP-15 links its register to the Stage-3 exclusions.

## D5 — Milestones (SPEC §10, gated; adapted gates)
- **M1** codegen + persistence + seeds generator → round-trip every entity (SQLite).
- **M2** stages 1–3 → unit tests + V-P/V-B rules green.
- **M3** stage 4 flat (largest remainder) → exact-sum property tests.
- **M4** stages 5–6 → V-M rules; **demo-reconciliation gate**: FY pair cb + gross tie to
  warehouse to the cent.
- **M5** cascade + reciprocal → golden reciprocal fixture matches hand solution.
- **M6** stage 7 (recon, true-up, doc pack, exceptions) → **full golden run green** incl.
  hash reproducibility; demo run recon Balanced/zero-residual.
- **M7** Allocations workbench UI + registry/OTP-10/OTP-15 wiring → typecheck/build + live walk.

All other SPEC content (stage contracts §4, algorithms §5, config §6, V-rules §7, outputs §8,
tests §9) applies as written. Decisions beyond this file go to `docs/allocation/DECISIONS.md`.
