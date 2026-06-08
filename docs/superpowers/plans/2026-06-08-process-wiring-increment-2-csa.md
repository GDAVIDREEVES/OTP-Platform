# Process Library — Increment 2 (CSA pair) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Wire **OTP-5** (CSA RAB share + PCT setting — guided wizard, ≈ `otp3`) and **OTP-11** (CSA in-period true-up — batch, ≈ `otp9`). Every figure is **reconciled by construction**: computed at runtime from `GET /api/segments/pl` (the same source OTP-20/21/dashboard read), so OTP-5/11 cannot drift from the rest of the demo.

**Architecture:** One read-only backend endpoint `GET /api/csa?year=` computes the whole CSA model from `segment_pl` + small config constants. Both bindings consume it. "Submit" reuses the existing review-queue + audit infra (no new SQLite table). Two frontend bindings (otp5 wizard, otp11 batch) mapped in `index.ts`.

**Tech Stack:** FastAPI + DuckDB (segment source, mirror `routers/pnl.py`) + pytest; React 18 + MUI 5 (mirror `otp3.tsx`/`otp9.tsx`, gate `npm run typecheck && npm run build`). Dev stack running (uvicorn `--reload`, Vite HMR).

**Spec:** `docs/superpowers/specs/2026-06-08-process-wiring-increment-2-csa-design.md` (full rationale + the $120M→$10.8M reconciliation flag).

**Branch:** `process-wiring-top15`.

## Reconciled model (config + formulas)
Config constants (top of `routers/csa.py`): `PARTICIPANTS = ["1000","3100","3800"]`, `GROWTH = 0.08`, `PCT_MULT = 3`.
For year `Y` (default 2026), from the `segment_pl` source aggregated by `RBUKRS` (revenue, opex_rd):
- `projected_sales_i = revenue_i * (1 + GROWTH)`
- `rab_share_i = projected_sales_i / Σ projected_sales`  (Σ = 1.0)
- `pool = Σ opex_rd_i`
- `target_i = rab_share_i * pool`; `actual_i = opex_rd_i`; `true_up_i = target_i - actual_i`  (Σ = 0)
- `platform_value = PCT_MULT * pool`; `pct_buyin_i = rab_share_i * platform_value`

## File structure
- **Create:** `backend/routers/csa.py`, `backend/tests/test_csa.py`, `src/kernel/bindings/marquee/otp5.tsx`, `src/kernel/bindings/marquee/otp11.tsx`.
- **Modify:** `backend/main.py` (mount), `src/shared/api/types.ts`, `src/shared/api/client.ts`, `src/kernel/bindings/index.ts` (map OTP-5, OTP-11).

---

## Task 1 — Backend `/api/csa` (TDD)
**Files:** Create `backend/routers/csa.py`, `backend/tests/test_csa.py`; Modify `backend/main.py`.

- [ ] **Step 1 — Router.** `routers/csa.py`: `GET /api/csa?year=2026` aggregates `segment_pl` by `RBUKRS` for `PARTICIPANTS` (reuse the exact DuckDB source/helper that `routers/pnl.py` `/api/segments/pl` uses — read it and mirror it; do NOT invent a second query path). Compute the model above. Return:
```json
{ "year": 2026, "pool": <float>, "platform_value": <float>, "growth": 0.08, "pct_mult": 3,
  "totals": { "revenue": <float>, "opex_rd": <float>, "true_up": <~0> },
  "participants": [ { "rbukrs","name","revenue","projected_sales","rab_share",
                      "opex_rd","target_contribution","true_up","pct_buyin" } ] }
```
`name` from `dim/entity_dim.json` `display_name`. Read-only; if the year has no data return zeros/empty gracefully.
- [ ] **Step 2 — Mount** in `backend/main.py` (`from routers import (... csa ...)` + `csa.router` in the include loop).
- [ ] **Step 3 — Tests** `backend/tests/test_csa.py` (TestClient): assert `len(participants)==3`; `Σ rab_share == 1.0` (±1e-6); `pool == Σ opex_rd`; `Σ true_up == 0` (±1.0); **reconciliation:** each participant's `revenue` and `opex_rd` equal the values from `GET /api/segments/pl?year=2026` for the same `RBUKRS` (this is the cross-process guarantee); `target_i == rab_share_i*pool`; `pct_buyin_i == rab_share_i*platform_value`.
- [ ] **Step 4 — Verify:** `cd backend && ../.venv/bin/python -m pytest tests/test_csa.py -q` then full `pytest -q` — all pass.

---

## Task 2 — Frontend types + client
**Files:** Modify `src/shared/api/types.ts`, `src/shared/api/client.ts`.
- [ ] Add `CsaParticipant` (rbukrs, name, revenue, projected_sales, rab_share, opex_rd, target_contribution, true_up, pct_buyin) and `CsaModel` (year, pool, platform_value, growth, pct_mult, totals, participants: CsaParticipant[]).
- [ ] `client.ts`: `csa: (year?: number) => getJSON<CsaModel>('/api/csa', year ? { year } : {})`.

## Task 3 — OTP-5 binding (setting wizard, ≈ otp3)
**Files:** Create `src/kernel/bindings/marquee/otp5.tsx`.
- [ ] Read `src/kernel/bindings/marquee/otp3.tsx` and the guided-workflow helpers it uses (`@/kernel/workflow/*`). Mirror its structure. If the guided framework is heavy, a clean KPIs + tabs binding is acceptable **provided** it shows the reconciled RAB shares + PCT and offers a gated "Set & submit" that posts to the review queue (reuse `api.reviewQueue`/the existing submit path otp3 uses).
- [ ] Fetch via `api.csa()` (alive-guard hook). KPIs: **Cost pool** (`formatCurrency`), **Participants**, **Top RAB share** (%), **PCT outstanding** (Σ pct_buyin). Tab(s): a table of participants — projected sales, RAB share %, target contribution, PCT buy-in. `export const otp5`.

## Task 4 — OTP-11 binding (true-up batch, ≈ otp9)
**Files:** Create `src/kernel/bindings/marquee/otp11.tsx`.
- [ ] Read `src/kernel/bindings/marquee/otp9.tsx`. Mirror the charge/batch structure (compute → stage → gated post to review). Fetch via `api.csa()`. KPIs: **Cost pool**, **Net true-up** (Σ |true_up|/2 or gross payable), **Payers / receivers**. Tab: per-participant table — target vs actual contribution, **true-up** (signed; red owe / green receive), with a "Post true-up batch" gated action (reuse otp9's review submit). Emphasise these are **live from segment_pl**.

## Task 5 — Register + verify + (caller commits)
**Files:** Modify `src/kernel/bindings/index.ts`.
- [ ] Import `otp5`, `otp11`; map `'OTP-5': otp5, 'OTP-11': otp11,` in `MARQUEE`.
- [ ] `npm run typecheck && npm run build` → PASS.
- [ ] Manual/live: OTP-5 & OTP-11 read **Live** on `/process`; figures match `/api/csa` and reconcile with OTP-21 segmented financials for 1000/3100/3800.

---
## Reconciliation acceptance (the bar)
1. `Σ rab_share == 1`, `Σ true_up == 0`, `pool == Σ opex_rd`.
2. Per participant, `/api/csa` `revenue` and `opex_rd` are byte-equal to `/api/segments/pl` for the same RBUKRS.
3. OTP-5/OTP-11 displayed pool/shares match `/api/csa`; the participant revenues match what OTP-21 shows.
4. Backend `pytest -q` green; frontend `typecheck && build` green.
