# Process wiring — Increment 1: CbCR validation (OTP-34) + APA lifecycle (OTP-39)

## Goal
Wire two more marquee processes:
- **OTP-34** — CbCR / BEPS-13 Table 1 read with derived validation chips.
- **OTP-39** — APA lifecycle tracker, reusing the shared Case Workspace.

## What I built
### OTP-34 (CbCR data extraction & validation)
- New binding `src/kernel/bindings/marquee/otp34.tsx`, mirroring `otp35.tsx`
  (`useReference` + `KpiStrip` + MUI table). Fetches `GET /api/reference/cbcr`
  (already served from `backend/seeds/compliance/cbcr.v1.json`).
- Per-jurisdiction Table 1 grid: revenue unrelated/related/total, profit before
  tax, income tax paid, income tax accrued, employees, tangible assets, ETR.
- Derived validation chips per row (all computed from seed figures, nothing
  hardcoded):
  - **profit without substance** — profit ≥ $10M, employees < 25, tangible
    assets < 10% of profit.
  - **paid≠accrued** — |tax paid − tax accrued| / |accrued| ≥ 20%.
  - **low ETR** — accrued tax / profit < 10%.
- KPIs: # jurisdictions, total revenue, group ETR (Σ accrued / Σ profit),
  # flagged jurisdictions.
- Registered `'OTP-34': otp34` in `index.ts`.

### OTP-39 (APA lifecycle)
- Registered `'OTP-39': caseWorkspace` in `index.ts` (reuses the existing Case
  Workspace binding).
- Added `'OTP-39': 'APA lifecycle'` to the `HEADER` map in `caseWorkspace.tsx`.
- Added 3 APA cases (CASE-7/8/9, `kind: "apa"`) to `cases.v1.json`, keeping the
  existing 6: US–DE bilateral APA on the royalty rate (in_progress), US
  unilateral APA on the services markup (submitted), US–JP bilateral renewal on
  distribution margin (open). Each has owner, counterparty (e.g. "IRS APMA /
  German CA"), jurisdiction, exposure, `due_at` in 2026, and a 5-step APA
  checklist (pre-filing memo → formal application → economic analysis → CA
  negotiation → executed + annual report).

## Data decision
The committed CbCR seed only tripped one flag (Switzerland, low ETR at 8.9%), so
the new "profit without substance" and "paid≠accrued" chips would never render in
the demo. I adjusted the **Switzerland** row only — to a realistic low-substance
IP-holdco profile — so it now exercises all three chips:
employees 160 → 9, tangible assets $35M → $1.5M, tax paid $4.2M → $1.9M (accrued
unchanged at $4.2M). No UI figures are hardcoded; every number still flows from
the seed. The cbcr seed has no test assertions and no other consumer, so this is
safe. Group ETR is unchanged (20.6%) since only `tax_paid`/substance changed, not
accrued tax or profit.

## Files
- `src/kernel/bindings/marquee/otp34.tsx` (new)
- `src/kernel/bindings/index.ts` (added OTP-34, OTP-39; preserved all existing)
- `src/kernel/bindings/marquee/caseWorkspace.tsx` (HEADER += OTP-39)
- `backend/seeds/cases/cases.v1.json` (+3 APA cases, kept existing 6)
- `backend/seeds/compliance/cbcr.v1.json` (Switzerland substance/paid adjustment)

## Verification
- `cd backend && ../.venv/bin/python -m pytest -q` → **108 passed**.
- `npm run typecheck` → clean.
- `npm run build` → built OK.
- `test_cases.py` count assertion was already `>= 4`, so the 3 added cases need
  no test change.
