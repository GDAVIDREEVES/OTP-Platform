# Process Wiring (tranches) — Increment 2: Service cost-allocation charge batch (OTP-10)

## Goal
Wire OTP-10 (service cost-allocation charge & invoice batch) to a marquee binding
that mirrors OTP-9's guided royalty batch, surfacing the SERVICE invoice batch
(cost base × markup ~5.5%, ~$14.3M across 72 source lines) via the existing
guided generate → review → post workflow.

## What I built
- **Backend** (`backend/routers/invoices.py`): added optional `material_type`
  query param to `GET /api/invoices`. When supplied (e.g. `SERVICE`), the SQL
  filters to that `MATERIAL_TYPE` and the submitted-adjustments rows are omitted
  (they are not material-type buckets). Existing behavior is preserved when the
  param is absent. Every bucket now also returns `costBase`
  (Σ STANDARD_COST × TOTAL_VOLUME), the implied blended `markup`, `lines`
  (source row count), and `materialType` — so all KPIs are backend-sourced.
- **Backend test** (`backend/tests/test_smoke_endpoints.py`): added
  `test_invoices_material_type_filter_service` — asserts SERVICE-only buckets,
  no submitted rows, blended markup in [0.04, 0.07], and that the filtered set
  equals the SERVICE subset of the unfiltered response.
- **Frontend** (`src/kernel/bindings/marquee/otp10.tsx`): new binding mirroring
  `otp9.tsx`. Reuses `useInvoices()` filtered to SERVICE. Guided wizard via
  `useGuidedWorkflow('OTP-10', 'OTP10-service-batch', STEPS)` → generate / review
  / post to the review queue. KPIs: service lines, total charge, blended markup %,
  payee count. Batch table shows per-line cost base, markup, and charge.
- **Types** (`src/shared/types/transaction.ts`): added optional `materialType`,
  `costBase`, `markup`, `lines` to `Invoice` (backend extensions).
- **Registry** (`src/kernel/bindings/index.ts`): registered `'OTP-10': otp10`,
  preserving all existing entries.

## Data decision
- The grouped invoice model collapses the 72 raw SERVICE supply_chain rows into
  **8 invoice buckets** ($14.34M total, 2 payees, 5.58% blended markup). The
  batch table therefore shows 8 invoice lines, while the "Service lines" KPI
  reports the **72 source lines** (Σ `lines` from the backend) to match the spec's
  "~72 lines". Both numbers come from the backend — no hardcoding.
- Blended markup is derived backend-side from STANDARD_COST × TOTAL_VOLUME vs.
  TOTAL_LEGAL_PRICE rather than averaging per-row MARKUP_RATE, so it reconciles
  exactly to the displayed charge total.

## Files
- backend/routers/invoices.py
- backend/tests/test_smoke_endpoints.py
- src/kernel/bindings/marquee/otp10.tsx
- src/kernel/bindings/index.ts
- src/shared/types/transaction.ts

## Verification
- `cd backend && ../.venv/bin/python -m pytest -q` → 109 passed.
- `npm run typecheck` → clean; `npm run build` → built ok.
- Manual: `GET /api/invoices?material_type=SERVICE` → 8 buckets, $14,344,773.26,
  costBase $13,586,402.70, blended markup 5.58%, 72 lines, 2 payees;
  `GET /api/invoices` (no param) → unchanged (52 rows, 200).
