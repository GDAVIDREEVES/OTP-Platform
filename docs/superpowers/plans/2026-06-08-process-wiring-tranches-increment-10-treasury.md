# Increment 10 — Treasury suite: IC loan/cash-pool rates, accrual, invoicing & settlement (OTP-6, OTP-13, OTP-14)

## Goal
Wire the treasury suite into the platform: rate setting on intercompany loans from the
group financing company (entity 3400 Ireland Financing Co.), annual loan interest accrual
& invoicing, and cash-pool interest accrual & net settlement. Unlike prior increments,
**no loan/pool data exists in the warehouse**, so the loan register and pool positions are
**FABRICATED** seeds; the endpoint *computes* the arm's-length figures from them
(`principal × all_in_rate`, `balance × spread`) and checks every rate against the existing
BM-FIN CUP band.

## What I built
- **New treasury seed** `backend/seeds/finance/treasury.v1.json` — a fabricated **loan
  register** (3 IC loans from 3400 to operating entities: $80M→1000 US, €40M→3000 DE,
  €30M→3200 FR; each carries `{borrower, principal, currency, tenor_years, credit_rating,
  base_rate, credit_spread, all_in_rate}`) and a **cash pool** (header 3400, 5 participant
  balances +22M/+14M/+6M/−18M/−24M → net 0, with deposit/borrow spreads). Every `all_in_rate`
  (4.2% / 4.5% / 4.8% = base + rating-adjusted spread) sits inside the BM-FIN 3.5–5.5% band.
  The seed header carries a prominent FABRICATED note. Registered in the seeds registry
  (`backend/state/seeds.py`, key `treasury`) so it serves via the existing reference router at
  `GET /api/reference/treasury`.
- **Backend `GET /api/treasury`** (`backend/routers/treasury.py`, registered in `backend/main.py`).
  - Loads the `treasury` seed + the `BM-FIN` row from the `benchmarks` seed.
  - Per loan: `annual_interest = principal × all_in_rate / 100`, plus a `within_benchmark`
    flag (`lower ≤ all_in_rate ≤ upper`).
  - Per pool seat: `annual_interest = balance × spread / 100`, where `spread` is the deposit
    spread on a surplus (balance ≥ 0) or the borrow spread on a deficit; `position` is
    `deposit`/`borrow`. `net_position = Σ balances` (~0 by construction).
  - `totals` roll up loan principal/interest, count within-benchmark, pool net position and
    pool interest. Response carries `fabricated: true` so the UI can flag it.
- **Test** `backend/tests/test_treasury.py` (9 cases, TestClient mirror of `test_csa.py`):
  `fabricated` flag + lender 3400; register present with borrowers 1000/3000/3200; per-loan
  interest == principal × rate; `all_in_rate == base + spread`; every rate inside the BM-FIN
  (3.5, 5.5) band; **pool balances net to ~0**; per-seat interest == balance × spread; totals
  reconcile; and the register also serves via the reference router.
- **Frontend type + client**: `TreasuryLoan` / `TreasuryPoolSeat` / `TreasuryCashPool` /
  `TreasuryTotals` / `TreasuryModel` in `src/shared/api/types.ts`; `api.treasury()` in
  `src/shared/api/client.ts`.
- **OTP-6 binding** `src/kernel/bindings/marquee/otp6.tsx` (mirrors `otp3.tsx` wizard) — rate
  setting: prepare → set spreads → review/submit; rating-adjusted spread vs BM-FIN with an
  in-range chip per loan, `inputs` tab shows the full rate table. Prominent fabricated-data alert.
- **OTP-13 binding** `src/kernel/bindings/marquee/otp13.tsx` (mirrors `otp9.tsx` batch) — loan
  interest accrual & invoicing: accrue → review batch → **gated post**; each line is
  lender→borrower × all-in rate; `outputs` tab shows the staged accrual batch.
- **OTP-14 binding** `src/kernel/bindings/marquee/otp14.tsx` (mirrors `otp11.tsx` net settlement)
  — cash-pool accrual & settlement: compute → stage → **gated post**; signed per-seat interest
  (depositors green / borrowers red) netting against the 3400 header; `outputs` tab shows the
  settlement table.
- **Registration** in `src/kernel/bindings/index.ts`: added `OTP-6 → otp6`, `OTP-13 → otp13`,
  `OTP-14 → otp14`; every existing entry preserved.

## DATA DECISION (flag for user)
- **The loan register and cash-pool positions are FABRICATED** — there is no loan/pool source
  in the warehouse. They live entirely in `treasury.v1.json` and are easily edited.
- **Loan principal ~$150M total** (80 + 40 + 30M), **cash pool ~$50M gross** (+42M deposits /
  −42M borrows). Sized to be credible for the group; the warehouse shows **~$591M FY2026
  group revenue** (`segment_pl`), so $150M IC loan principal ≈ 25% of revenue — conservative and
  defensible. (Spec anchored to a ~$300M group; the live warehouse is larger, so the scale is
  comfortably within range.) **Please confirm the scale, like the CSA $120M call.**
- **Rates are internally consistent and benchmark-bound**: `all_in_rate = base_rate +
  credit_spread`, with the spread rating-adjusted (A → +1.2%, BBB → +2.0%/+2.3%), all landing
  inside the BM-FIN 3.5–5.5% CUP band.
- **Pool nets to zero by construction**: +22 +14 +6 −18 −24 = 0, so the header (3400) runs a
  flat book; the demonstrable output is the deposit/borrow interest spread, not a funding gap.
- **Only derived-from-the-warehouse element is the BM-FIN band** (from the existing `benchmarks`
  seed); everything else in this increment is fabricated-then-computed and flagged.

## Files
- `backend/seeds/finance/treasury.v1.json` (new fabricated seed)
- `backend/state/seeds.py` (registered `treasury`)
- `backend/routers/treasury.py` (new `GET /api/treasury`)
- `backend/main.py` (router import + include)
- `backend/tests/test_treasury.py` (new tests)
- `src/shared/api/types.ts` (`TreasuryModel` + sub-types)
- `src/shared/api/client.ts` (`api.treasury`)
- `src/kernel/bindings/marquee/otp6.tsx` / `otp13.tsx` / `otp14.tsx` (new bindings)
- `src/kernel/bindings/index.ts` (`OTP-6/13/14` wiring)

## Verification
- `cd backend && ../.venv/bin/python -m pytest -q` — full suite green.
- `npm run typecheck && npm run build` — both green.
