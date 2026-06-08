# Process Wiring (tranches) — Increment 4: Goods & services price-setting wizards (OTP-4, OTP-1, OTP-2)

## Goal
Wire OTP-4 (service cost-plus markup), OTP-1 (goods beginning-of-year price) and
OTP-2 (in-period goods price reset) to guided-wizard bindings that set
intercompany prices off a new warehouse-derived endpoint. Every displayed number
traces to `/api/transactions/pricing`; the benchmarking bands come from the
committed `benchmarks.v1.json` seed (BM-SVC / BM-TOLL / BM-LRD). No hardcoded
financials.

## What I built
- **Backend** (`backend/routers/transactions.py`): new
  `GET /api/transactions/pricing`. Aggregates `supply_chain` **per chain +
  material** (NOT per role like `/flows`) for `SERVICE`/`FG`/`SEMI`/`RAW`. Each
  row is the price a controller actually sets: `standardCost` (AVG STANDARD_COST),
  `markupRate` (AVG MARKUP_RATE → %), `totalLegalPrice` (SUM TOTAL_LEGAL_PRICE),
  `tpMethod`/`pli` (via existing `services.labels`), the entity pair (resolved to
  display names from `ENTITY_DIM`), and the benchmarking band. Band is selected by
  `_benchmark_id_for(material, seller_role, buyer_role)` — `SERVICE` → BM-SVC,
  goods into an LRD buyer → BM-LRD, inbound goods to a toll mfr/principal →
  BM-TOLL — and the lower/median/upper numbers are read live from the
  benchmarking seed (`_benchmarks()`), never hardcoded. `withinBenchmark` is the
  derived range test. Honours the standard `PeriodFilter` (year/periodFrom/To).
- **Backend test** (`backend/tests/test_transactions.py`): TestClient against
  `main.app`, mirroring `test_flows.py`/`test_reference.py`. Asserts shape +
  derivation, that rows are unique per `(chainId, materialType)` (not per role),
  that service rows test on BM-SVC and goods on BM-LRD/BM-TOLL, and that
  `withinBenchmark` matches the live band from `/api/reference/benchmarks`.
- **Frontend** (`src/shared/api/types.ts`, `client.ts`): added `PricingRow` type
  and `api.pricing(period)` (`GET /api/transactions/pricing`).
- **Frontend** (`src/kernel/bindings/marquee/otp4.tsx`): OTP-4 service binding,
  mirroring `otp5.tsx` — alive-guarded `useServicePricing()` (pricing filtered to
  `transactionType === 'service'`), `useGuidedWorkflow('OTP-4',
  'OTP4-service-cost-plus', STEPS)` with prepare → review markups → gated submit
  to the review queue. KPIs and tables (overview wizard + `inputs` review) are all
  from the endpoint; markups tested against BM-SVC.
- **Frontend** (`src/kernel/bindings/marquee/otp1.tsx`): OTP-1 goods binding,
  same guided shape over `useGoodsPricing()` (`transactionType === 'goods'`),
  markups vs BM-LRD/BM-TOLL per chain's TP method. The binding is **id-aware**
  via `ctx.def.id`: under OTP-2 it reframes as an in-period **reset** (record ref
  `OTP2-goods-reset`, reset copy) and routes review/audit under `OTP-2`; under
  OTP-1 it is the BOY price-set (`OTP1-goods-boy`). One binding, two ids.
- **Registry** (`src/kernel/bindings/index.ts`): registered `'OTP-1': otp1`,
  `'OTP-2': otp1` (REUSE, like OTP-16→16/17), and `'OTP-4': otp4`. Preserved every
  existing entry (OTP-23, caseWorkspace 30/31/40/50/39, csa 5/11, otp34/10/27/41,
  etc.).

## Data decision
- **Band mapping by role, not stored on the row.** `supply_chain` has no
  benchmark id, so the wizard must choose which band a price tests against.
  Decision: `SERVICE` → BM-SVC; goods sold **to an LRD buyer** → BM-LRD; all other
  inbound goods (to a toll mfr / principal) → BM-TOLL. This matches the seed's
  `applies_to` text and the LRD/TOLL roles in the data. The band's numbers are
  still read live from the seed — only the *selection* is rule-based.
- **`withinBenchmark` on raw markup vs the cost-plus band.** Many goods chains use
  RPM/CUP (resale/price methods) yet are tested against a net-cost-plus band, so a
  number of goods rows read "Out of range". That is faithful to the warehouse data
  (FG markups are near zero/negative against a 2–4% LRD band) and is exactly the
  kind of drift these wizards exist to surface — surfaced, not silently hidden.

## Files
- `backend/routers/transactions.py` (new endpoint + helpers)
- `backend/tests/test_transactions.py` (new)
- `src/shared/api/types.ts`, `src/shared/api/client.ts` (PricingRow + api.pricing)
- `src/kernel/bindings/marquee/otp4.tsx` (new)
- `src/kernel/bindings/marquee/otp1.tsx` (new, reused for OTP-2)
- `src/kernel/bindings/index.ts` (registered OTP-1/2/4)
- `docs/superpowers/plans/2026-06-08-process-wiring-tranches-increment-4-pricing-wizards.md`

## Verification
- `cd backend && ../.venv/bin/python -m pytest -q` → 112 passed.
- `npm run typecheck` → clean. `npm run build` → built OK.
