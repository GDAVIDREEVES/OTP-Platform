# Process Wiring (tranches) — Increment 5: Latest-Estimate forecast workpaper (OTP-24)

## Goal
Wire OTP-24 ("Forecast preparation (LE & segmentation)") to a binding that
presents a full-year **Latest Estimate (LE)** per tested party, built from a new
warehouse-derived endpoint. The LE is **derived from real monthly `segment_pl`
actuals via run-rate** — actuals-to-date plus a run-rate projection of the
remaining months — and each party's projected full-year margin is tested against
its arm's-length band for early warning. Every displayed number traces to
`/api/forecast`; there is no seeded budget.

## What I built
- **Backend** (`backend/routers/forecast.py`): new `GET /api/forecast?year=`.
  Aggregates `segment_pl` per `RBUKRS` for the year (`SUM(revenue)`,
  `SUM(operating_profit)`, `COUNT(DISTINCT POPER)` as months posted) — the same
  source as `/api/segments/pl` / OTP-20 / OTP-21. Per tested party (universe +
  arm's-length band from `entity_roles.OM_LOW_PCT/OM_HIGH_PCT`, exactly what
  OTP-20 uses) it computes:
  - `actuals` (revenue / operating_profit / margin) summed over posted months,
  - `forecastRemainder` = run-rate = `(actuals / months_posted) * months_remaining`,
    where `months_remaining = 12 - months_posted`,
  - `latestEstimate` = `actuals + forecastRemainder`,
  - `fullYearMargin` = LE operating_profit / LE revenue,
  - target band (`targetMarginLabel` via shared `services.status.fmt_pct_band`) and
  - projected `status` + `variance` via the shared `services.status.compute_status`
    so the in/watch/out verdict matches the monitoring screen byte-for-byte.
  Returns a graceful model with one zeroed/`no-data` row per entity when the year
  has no postings.
- **Backend test** (`backend/tests/test_forecast.py`): TestClient against
  `main.app`, mirroring `test_csa.py`. Asserts shape/basis, one row per tested
  party (8), the identity `LE = actuals + remainder`, the run-rate remainder
  formula and `months_posted + months_remaining == 12`, **reconciliation with
  `/api/segments/pl`** (with a full 12-month year the remainder is 0, so LE must
  equal the segment aggregate per entity — proves it is derived, not seeded),
  the full-year-margin definition, that `status` matches `compute_status`, and the
  empty-year graceful path. 8 tests, all green.
- **Backend wiring** (`backend/main.py`): imported and registered
  `forecast.router` (alongside `flows`/`kpis`); preserved every existing router.
- **Frontend types/client** (`src/shared/api/types.ts`, `client.ts`): added
  `ForecastParty` / `ForecastModel` and `api.forecast(year)` (`GET /api/forecast`).
- **Frontend binding** (`src/kernel/bindings/marquee/otp24.tsx`): OTP-24 binding
  extending the OTP-21 segmented-grid pattern (`useEntities`/`usePeriod`,
  `formatCurrency`, `KpiStrip`, `DrillDrawer`) and the OTP-20 status idiom
  (`statusColor`/`statusLabel`, `exceptionsFirst`). Alive-guarded `useForecast()`
  off `api.forecast`. KPIs: LE revenue, LE blended margin, projected out-of-range,
  projected on-watch. `overview` = narrative + early-warning list; `calculation`
  /`outputs` = the workpaper grid showing **Actuals-to-date + Forecast-remainder =
  Latest-Estimate** per entity, full-year margin vs target band, variance, status
  chip, and a drill to ACDOCA postings. Exceptions sorted first.
- **Registry** (`src/kernel/bindings/index.ts`): registered `'OTP-24': otp24`.
  Preserved every existing entry (OTP-1/2, OTP-3/4/5, OTP-9/10/11, OTP-16/17,
  OTP-20/21/22/23, caseWorkspace 30/31/39/40/50, OTP-25/27/29/34/35/41, OTP-45/48).

## Data decision (to flag)
- **LE is derived from real actuals via run-rate, NOT a separate seeded budget.**
  `forecast_remainder = (actuals_to_date / months_posted) * months_remaining`, and
  `latest_estimate = actuals_to_date + forecast_remainder`. The demo warehouse has
  all **12 months posted for 2026**, so today the run-rate remainder is **zero**
  and the LE equals the full-year actuals (and reconciles exactly with
  `/api/segments/pl`). The run-rate machinery is still real and tested: when fewer
  than 12 months are posted, the remaining months are projected at the
  month-to-date average. Simple run-rate (flat seasonality on actuals-to-date) was
  chosen over a seasonal/weighted curve to keep the LE traceable and reconcilable
  with the segmented P&L. The arm's-length band and status rule are the same as
  OTP-20 (`entity_roles` band + `services.status.compute_status`).

## Files
- `backend/routers/forecast.py` (new)
- `backend/main.py` (register router)
- `backend/tests/test_forecast.py` (new)
- `src/shared/api/types.ts`, `src/shared/api/client.ts` (type + client method)
- `src/kernel/bindings/marquee/otp24.tsx` (new binding)
- `src/kernel/bindings/index.ts` (register OTP-24)

## Verification
- `cd backend && ../.venv/bin/python -m pytest -q` — full suite green.
- `npm run typecheck && npm run build` — both green.
