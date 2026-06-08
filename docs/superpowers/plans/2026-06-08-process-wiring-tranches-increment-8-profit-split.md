# Increment 8 — Profit-split engine (OTP-44, OTP-12)

## Goal
Wire the residual profit-split method (PSM) into the platform: a design/allocation-key
workpaper (OTP-44) and a calc-&-invoicing true-up (OTP-12), both deriving live from
the DuckDB `segment_pl` warehouse so every displayed number reconciles by construction
with `/api/csa`, `/api/segments/pl`, and the dashboard.

## What I built
- **Backend `GET /api/profit-split`** (added to `backend/routers/csa.py`, alongside `/api/csa`).
  - Participants = the three non-routine parties `['1000','3100','3000']` (US IP, CH IP, DE Manufacturer).
  - `combined_profit` = Σ their `segment_pl` `operating_profit`.
  - Selectable allocation `key`: `opex_rd` (default, R&D value-driver) or `sga` (`opex_sm + opex_ga`).
  - `residual_share_i = key_i / Σ key` (full precision); `allocated_profit_i = share_i * combined_profit`;
    `true_up_i = allocated_i − operating_profit_i`.
  - Unknown `key` falls back to the default; empty year returns a graceful zero model.
  - Constants `PS_PARTICIPANTS`, `PS_DEFAULT_KEY`, `PS_KEYS` at the top of the module.
- **Test** `backend/tests/test_profit_split.py` (10 cases, TestClient): shares sum to 1 for both keys,
  Σ allocated == combined_profit, Σ true_up == 0, formula checks, key-toggle is meaningful, bad-key
  fallback, operating_profit reconciles with `/api/segments/pl`, empty-year graceful.
- **Frontend type + client**: `ProfitSplitModel` / `ProfitSplitParticipant` / `ProfitSplitKey` in
  `src/shared/api/types.ts`; `api.profitSplit({ year?, key? })` in `src/shared/api/client.ts`.
- **OTP-44 binding** `src/kernel/bindings/marquee/otp44.tsx` (mirrors `otp35.tsx`): calc workpaper with
  a R&D / SG&A `ToggleButtonGroup`, KPI strip (combined residual / parties / default key), and a table of
  key value · residual share · allocated profit. Bound to `overview` + `calculation`.
- **OTP-12 binding** `src/kernel/bindings/marquee/otp12.tsx` (mirrors `otp11.tsx`): feeds the split into an
  allocated-vs-actual balancing-invoice true-up via `useGuidedWorkflow` (compute → stage → **gated** post to
  the maker-checker review queue), plus an `outputs` tab. Positive true-up = receives a balancing invoice;
  negative = pays.
- **Registration** in `src/kernel/bindings/index.ts`: added `OTP-44 → otp44` and `OTP-12 → otp12`; every
  existing entry preserved.

## DATA DECISION (flag for user)
- **Default allocation key = `opex_rd`** (R&D value-driver). Alternative `sga = opex_sm + opex_ga`.
  Note: in the current seed, `opex_sm` is 0 for these three entities, so the SG&A key resolves to `opex_ga`.
- **Participants = the 3 non-routine entities** `1000` (US IP), `3100` (CH IP), `3000` (DE Manufacturer).
- Both the participant set and the key are **configurable** via the constants at the top of `routers/csa.py`
  (and `key` is selectable per-request). The OTP-44 toggle exposes the key choice in the UI; the OTP-12
  invoicing run uses the default R&D key.

## Files
- `backend/routers/csa.py` (new endpoint + constants)
- `backend/tests/test_profit_split.py` (new)
- `src/shared/api/types.ts`, `src/shared/api/client.ts`
- `src/kernel/bindings/marquee/otp44.tsx` (new), `src/kernel/bindings/marquee/otp12.tsx` (new)
- `src/kernel/bindings/index.ts`

## Verification
- `cd backend && ../.venv/bin/python -m pytest -q` → **146 passed**.
- `npm run typecheck` → clean; `npm run build` → built OK.
