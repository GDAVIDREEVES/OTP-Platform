# Increment 11 — BEAT base-erosion prep (OTP-36, OTP-38)

## Goal
Wire the US base-erosion suite: the BEAT (IRC §59A) computation (OTP-36) and the
Form 5471 / 8858 / 8975 data inputs (OTP-38). The US payer's related-party
deductible base is **REAL** — derived from `journal` (ACDOCA) RASSC postings — so
unlike a fully-fabricated tranche, the only fabricated element here is the
`RACCT → payment-type` classification that drives the §59A base-erosion split.

## What I built
- **Backend `GET /api/beat`** (`backend/routers/beat.py`, registered in `backend/main.py`).
  - **REAL base**: aggregates `journal` HSL for the US payer (`RBUKRS = 1000`) on
    lines posted against an affiliate trading partner (`RASSC` set, ≠ US payer),
    by G/L account (`RACCT`). Deductible lines are `HSL < 0` (expense). This is
    the same `journal` source behind `/api/journal-entries`, so it cannot drift.
  - **FABRICATED**: `_RACCT_TYPE` maps each distinct related-party `RACCT` to a
    §59A payment type by its account nature — `0510000`/`0820000` → `cogs`,
    `0810000` → `services`, `0855000` → `royalties`, `0925000` → `interest`;
    unmapped → `other`. COGS is the §59A(d)(1) exception (NOT base-eroding).
  - **Computes**: base-eroding payments (royalties + services + interest + other,
    excluding COGS); base-erosion % = base-eroding / total US deductions; the 3%
    threshold test (`threshold_met`); and the MTI build-up (regular taxable income
    = gross receipts − total deductions; MTI = regular TI + base-eroding add-back;
    BEAT base tax = MTI × 10%). Gross receipts proxy = `segment_pl` US revenue.
  - **OTP-38 Schedule M**: `_schedule_m` rolls the US payer's RASSC postings up
    per affiliate counterparty (CFC) — amounts paid-to / received-from + each
    counterparty's `segment_pl` foreign P&L (revenue, operating profit). All REAL.
  - Returns a graceful zero model for an empty year.
- **Test** `backend/tests/test_beat.py` (10 cases, TestClient mirror of `test_csa.py`):
  config echoed; related-party base and total deductions **reconcile byte-for-byte
  with raw `journal`**; payment types partition the related-party base; base-eroding
  excludes COGS and matches the typed sum; base-erosion % + threshold; MTI build-up
  formulas; per-RACCT breakdown reconciles to the per-type totals; **Schedule M
  reconciles with `journal` + `segment_pl`**; empty-year graceful.
- **Frontend type + client**: `BeatModel` + `BeatPaymentType` / `BeatAccountRow` /
  `BeatScheduleMRow` in `src/shared/api/types.ts`; `api.beat()` in `src/shared/api/client.ts`.
- **OTP-36 binding** `src/kernel/bindings/marquee/otp36.tsx` (mirrors `otp44.tsx`
  live-fetch + `otp35.tsx` table) — the base-erosion % test, a related-party-by-type
  table with base-eroding/excepted chips, and the MTI build-up; KPI strip shows
  base-erosion % (risk when ≥ 3%), the threshold verdict, base-eroding payments and MTI.
- **OTP-38 binding** `src/kernel/bindings/marquee/otp38.tsx` — overview = Form 5471/8858
  per-CFC Schedule M (live from `/api/beat`); calculation = Form 8975 (CbCR) which
  **reuses the `cbcr` seed exactly as OTP-34** (`useReference('cbcr')`).
- **Registration** in `src/kernel/bindings/index.ts`: added `OTP-36 → otp36` and
  `OTP-38 → otp38`; every existing entry preserved. (OTP-36/38 already exist in the
  process catalog, so no catalog edit — "register" = wire the binding.) No new seed
  file (Form 8975 reuses the existing `cbcr` seed), so the seeds registry is unchanged.

## DATA DECISION (flag for user)
- **The `RACCT → payment-type` classification is the FABRICATED element.** The
  underlying US RASSC payment base is **REAL** (from the journal). The mapping
  (`0510000`/`0820000` = COGS, `0810000` = services, `0855000` = royalties,
  `0925000` = interest) is an assumed mapping of generic SAP cost-of-sales codes
  by their account nature, confirmed against the line text (`SGTXT` shows
  `ROYALTY…` on `0855000`, `SERVICE…` on `0810000`, `GOODS…`/`COST_SHARE…` on the
  COGS accounts). Easy to re-map in one dict.
- **Resulting FY2026 magnitudes (US payer 1000):**
  - Related-party deductions (REAL): **$10,655,567**.
  - COGS exception (excluded): **$9,905,259** (accounts `0820000` + `0510000`).
  - **Base-eroding payments: $750,308** = royalties $73,575 + services $676,733
    (interest $0 — no related-party interest deduction posted on the US side).
  - Total US deductions (denominator, REAL): **$16,765,948**.
  - **Base-erosion % = 4.475% → ABOVE the 3% threshold** ⇒ the US payer is an
    applicable taxpayer for the period. (Driven by the COGS-vs-services/royalty
    split; if the demo prefers a "below threshold" story, re-classify `0810000`
    services → COGS.)
  - MTI = regular TI $152,797,324 + add-back $750,308 = **$153,547,633**; BEAT base
    (× 10%) = **$15,354,763**. (MTI is built on a gross-receipts proxy = `segment_pl`
    US revenue $169,563,273; this is an illustrative regular-TI base, not a filed
    figure — flag for review.)
- **Everything except the classification is derived from the warehouse**: the
  related-party base, total deductions, gross-receipts proxy, and the Schedule M
  per-CFC flows + foreign P&L all come from `journal` / `segment_pl`.

## Files
- `backend/routers/beat.py` (new `GET /api/beat`)
- `backend/main.py` (router import + include)
- `backend/tests/test_beat.py` (new tests)
- `src/shared/api/types.ts` (`BeatModel` + sub-types)
- `src/shared/api/client.ts` (`api.beat`)
- `src/kernel/bindings/marquee/otp36.tsx` / `otp38.tsx` (new bindings)
- `src/kernel/bindings/index.ts` (`OTP-36/38` wiring)

## Verification
- `cd backend && ../.venv/bin/python -m pytest -q` — full suite green.
- `npm run typecheck && npm run build` — both green.
