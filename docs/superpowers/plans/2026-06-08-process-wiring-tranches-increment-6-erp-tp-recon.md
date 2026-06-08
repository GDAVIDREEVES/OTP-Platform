# Process Wiring (tranches) — Increment 6: ERP↔TP reconciliation + billing control (OTP-43, OTP-42)

## Goal
Wire the two ERP-control processes to live bindings over a single new
warehouse-derived endpoint:
- **OTP-43 — Data reconciliation ERP ↔ TP**: tie every priced intercompany flow
  to what actually posted in the GL and classify the gap.
- **OTP-42 — IC billing automation & controls**: re-use the same source to
  frame each flow as a billing state (billed / due-to-bill / blocked) with the
  control gate as an exceptions queue.

Every displayed number traces to `GET /api/reconciliation`; nothing is
hardcoded.

## What I built
- **Backend** (`backend/routers/reconciliation.py`): new `GET /api/reconciliation`
  (modelled on `routers/flows.py` query style + `PeriodFilter`). Joins the
  planned IC price book (`supply_chain`: `TOTAL_LEGAL_PRICE`, `TP_METHOD`, entity
  pair, `CHALLENGED_FLAG`, keyed by **`AWREF`**) to the posted value in ACDOCA
  (`journal`: `HSL` by `AWREF`). The journal is aggregated per AWREF first
  (`posted = MAX(ABS(HSL))`), then `LEFT JOIN`ed so unposted flows survive as
  `NULL` posted. Per flow it returns `{awref, seller/buyer (+names), tpMethod,
  planned, posted, delta, postings, challenged, apa, status}` plus a `summary`
  with the four KPI counts and planned/posted/delta totals. Status (priority):
  `challenged` (CHALLENGED_FLAG) → `unposted` (no posting) → `value-break`
  (`|posted − planned| > VALUE_BREAK_TOLERANCE`) → `reconciled`.
- **Backend** (`backend/routers/journal_entries.py`): added an optional `awref`
  filter param and `AWREF` to the projection, so the OTP-43 posting drill can
  pull exactly the postings behind one reference (vs. fetching by entity and
  filtering client-side). Backward compatible.
- **Backend test** (`backend/tests/test_reconciliation.py`): TestClient against
  `main.app`, mirroring `test_csa.py`/`test_flows.py`. Asserts shape, valid
  status set, **one row per AWREF**, row count == distinct `supply_chain` AWREFs
  (LEFT JOIN never drops an unposted flow), the four counts partition the total
  and match the rows, unposted has `posted=None`, reconciled/value-break delta
  vs. tolerance, that `posted` equals the journal `MAX(ABS(HSL))` for the AWREF
  (**derived, not copied**), challenged-takes-priority, year filter empties
  cleanly, and the `journal-entries?awref=` drill contract. 13 tests, all green.
- **Backend wiring** (`backend/main.py`): imported + registered
  `reconciliation.router` (alongside `csa`/`evidence`); preserved every router.
- **Frontend types/client** (`src/shared/api/types.ts`, `client.ts`): added
  `ReconStatus`/`ReconRow`/`ReconSummary`/`Reconciliation` and
  `api.reconciliation(period)`; added `AWREF` to `JournalEntryRow` and an
  `awref` param to `api.journalEntries`.
- **Frontend binding — OTP-43** (`src/kernel/bindings/marquee/otp43.tsx`):
  mirrors OTP-20 — answer-first `KpiStrip` (reconciled / unposted / value-breaks
  / challenged), an exceptions-first **Overview** break list, a **Worklist**
  table, and a `DrillDrawer`-style **PostingsDrawer** that drills into the ACDOCA
  postings for the selected AWREF. Alive-guarded `useReconciliation()`.
- **Frontend binding — OTP-42** (`src/kernel/bindings/marquee/otp42.tsx`):
  **reuses the same `/api/reconciliation` source** and rolls the four recon
  statuses into three billing states — `billed` ← reconciled, `due-to-bill` ←
  unposted, `blocked` ← value-break | challenged. OTP-20 layout: KPIs (IC
  invoices / billed / due-to-bill / blocked, with $ values), a blocked-first
  Overview exceptions list with the control note that fired, and a Worklist queue.
- **Registry** (`src/kernel/bindings/index.ts`): registered `'OTP-42': otp42` and
  `'OTP-43': otp43`. Preserved every existing entry (OTP-23, caseWorkspace
  30/31/40/50/39, csa 5/11, otp34, otp10, otp27, otp41, OTP-1/2/3/4, 9, 16/17,
  20/21/22, 24/25/29/35, 45/48).

## Data decision (to flag)
- **Posted amount per AWREF = `MAX(ABS(HSL))`** across the document's postings —
  the largest single P&L line, i.e. the booked value of the IC charge. This was
  chosen over summing a signed debit/credit side because the same charge posts
  on different sides for different flow types (the seller's revenue isn't always
  present on its own books); `MAX(ABS(HSL))` matches the planned legal price
  **exactly for all 172 posted flows** in the demo, so a non-zero delta is a
  genuine value break, not a sign/aggregation artefact.
- **Join key is `AWREF`.** Of 427 priced flows, **172** carry an ACDOCA posting;
  the demo today resolves to **167 reconciled, 244 unposted, 16 challenged, 0
  value-breaks** (challenged takes priority over the 5 posted-but-challenged
  flows). The value-break path is real and tested via the tolerance rule
  (`VALUE_BREAK_TOLERANCE = 1.0`); it simply has no instances in the current
  warehouse because every posted flow posts at the TP price. The 244 unposted
  flows are the OTP-42 "due to bill" backlog.
- **OTP-42 reuses OTP-43's source** rather than a separate endpoint, so the
  reconciliation screen and the billing screen can never disagree about a flow.

## Files
- `backend/routers/reconciliation.py` (new)
- `backend/routers/journal_entries.py` (add `awref` filter + `AWREF` column)
- `backend/main.py` (register router)
- `backend/tests/test_reconciliation.py` (new)
- `src/shared/api/types.ts`, `src/shared/api/client.ts` (types + client methods)
- `src/kernel/bindings/marquee/otp43.tsx` (new binding)
- `src/kernel/bindings/marquee/otp42.tsx` (new binding)
- `src/kernel/bindings/index.ts` (register OTP-42, OTP-43)

## Verification
- `cd backend && ../.venv/bin/python -m pytest -q` — full suite green (133).
- `npm run typecheck && npm run build` — both green.
