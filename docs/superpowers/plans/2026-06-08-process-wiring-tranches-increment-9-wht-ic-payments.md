# Increment 9 — Withholding tax on IC payments (OTP-46)

## Goal
Wire withholding tax on intercompany royalty & service payments into the platform: a
per-corridor tabular calc (OTP-46) showing treaty WHT due and the treaty-vs-statutory
saving. The withholdable base derives live from the DuckDB `supply_chain` warehouse
(royalty + service legs), so the gross numbers reconcile by construction with
`/api/transactions/royalties` and the dashboard; only the bilateral treaty-rate matrix
is a seed.

## What I built
- **New treaty seed** `backend/seeds/compliance/wht_treaty.v1.json` — compact bilateral
  matrix keyed by *source* (payer) country, with OECD-model-aligned **reduced treaty** royalty/
  service WHT rates and a **statutory** fallback per corridor (e.g. DE→US 0%, FR/GB/NL→CH 0%,
  IE/US 0%, CH 0%, IN 10%), plus a catch-all `default` (statutory 20% / treaty 10%). Registered
  in the seeds registry (`backend/state/seeds.py`, key `wht_treaty`) so it serves via the
  existing reference router at `GET /api/reference/wht_treaty`.
- **Backend `GET /api/wht`** (`backend/routers/wht.py`, registered in `backend/main.py`).
  - Derives the withholdable legs from `supply_chain WHERE MATERIAL_TYPE IN ('ROYALTY','SERVICE')`,
    grouped by `MATERIAL_TYPE, BUYER_LAND1 (source/payer country), SELLER_LAND1 (residence/payee country)`.
    The **buyer is the source-country payer**; the **seller is the payee/recipient**.
  - Resolves rates per corridor: exact `(source, residence)` → source-country wildcard
    (`residence == '*'`) → seed default.
  - Per row: payer/payee country, payment type, `gross` (Σ `TOTAL_LEGAL_PRICE`), `treaty_rate`,
    `statutory_rate`, `wht_due = gross × treaty`, `treaty_saving = (statutory − treaty) × gross`,
    plus a treaty `basis` note. `totals` roll the rows up (incl. `statutory_due = wht_due + saving`).
  - Honours the standard `year / periodFrom / periodTo` `PeriodFilter`.
- **Test** `backend/tests/test_wht.py` (3 cases, TestClient): seed serves via the reference router
  with the expected reduced/statutory rates; rows derive the real base (~$16.6M gross, royalty
  ~$2.3M) with the `wht_due` / `treaty_saving` formulas verified per row; totals reconcile the rows.
- **Frontend type + client**: `WhtRow` / `WhtTotals` / `WhtModel` in `src/shared/api/types.ts`;
  `api.wht(period?)` in `src/shared/api/client.ts`.
- **OTP-46 binding** `src/kernel/bindings/marquee/otp46.tsx` (mirrors `otp35.tsx` tabular calc with the
  alive-guarded fetch pattern from `otp44.tsx`): KPI strip (withholdable base / treaty WHT due /
  treaty saving) and a per-corridor table of gross payment · treaty rate · statutory rate · WHT due ·
  treaty saving, with a totals row. Bound to `overview` + `calculation`.
- **Registration** in `src/kernel/bindings/index.ts`: added `OTP-46 → otp46`; every existing entry
  preserved (OTP-23, caseWorkspace 30/31/40/50/39, csa 5/11, otp34, otp10, otp27, otp41, otp45/48, etc.).

## DATA DECISION (flag for user)
- **The treaty/statutory WHT matrix is illustrative and seeded** (OECD-model-aligned reduced treaty
  royalty/service rates with a statutory fallback) — not legal advice. It lives entirely in
  `wht_treaty.v1.json` and is easily edited.
- **The withholdable base is real**: ~$2.3M royalty + ~$14.3M service ≈ $16.6M gross, derived straight
  from `supply_chain`.
- **All corridors in the current data are fully treaty-relieved (treaty rate 0%)** — DE→US, FR/GB/NL→CH —
  so `wht_due` totals **$0** and the headline output is the **~$3.23M treaty saving vs. statutory**. This
  is the realistic outcome for these specific EU/US-treaty corridors. The seed still carries a non-zero
  statutory fallback and an `IN 10%` treaty corridor to demonstrate a positive-WHT case; no India
  royalty/service legs exist in the seed data, so that branch is exercised by the corridor seed/test only.
- **Direction convention**: WHT is levied by the **source (payer) country** on the outbound payment, so the
  rate is keyed off `BUYER_LAND1`. Documented inline in `routers/wht.py`.

## Files
- `backend/seeds/compliance/wht_treaty.v1.json` (new seed)
- `backend/state/seeds.py` (registered `wht_treaty`)
- `backend/routers/wht.py` (new `GET /api/wht`)
- `backend/main.py` (router import + include)
- `backend/tests/test_wht.py` (new tests)
- `src/shared/api/types.ts` (`WhtRow` / `WhtTotals` / `WhtModel`)
- `src/shared/api/client.ts` (`api.wht`)
- `src/kernel/bindings/marquee/otp46.tsx` (new binding)
- `src/kernel/bindings/index.ts` (`OTP-46 → otp46`)

## Verification
- `cd backend && ../.venv/bin/python -m pytest -q` — full suite green.
- `npm run typecheck && npm run build` — both green.
