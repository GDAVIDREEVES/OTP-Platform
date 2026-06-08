# Process Library — Increment 2: CSA pair (OTP-5 + OTP-11)

> Part of the **Top-15 risk-coverage build**. Increments 0 (badge + OTP-23) and 1
> (Case Workspace, OTP-30/31/40/50) shipped. This is **Increment 2** — the last two
> top-15 targets: OTP-5 (CSA RAB share + PCT) and OTP-11 (CSA in-period true-up).
>
> **STATUS: SPEC ONLY — implementation intentionally deferred.** Increments 0–1 reused
> real warehouse / governance data. The CSA pair is the only one of the seven targets
> that needs **fabricated financial demo data** (cost-sharing pool, RAB shares, PCT
> buy-ins, true-up amounts). In a transfer-pricing demo the credibility of those
> mechanics matters, so the data model below is framed as **decisions to confirm**
> rather than guessed during the unattended run. Ready to build on your nod.

## Goal
Wire OTP-5 (CSA RAB share + PCT setting) and OTP-11 (CSA in-period true-up), mirroring
the existing guided patterns: **OTP-5 ≈ `otp3`** (rate-setting wizard), **OTP-11 ≈
`otp9`** (charge & invoice batch).

## Background (what these processes are)
A **Cost Sharing Arrangement (CSA)** has affiliated participants jointly fund the
development of intangibles, sharing pooled development costs in proportion to each
participant's **Reasonably Anticipated Benefits (RAB)**. New or contributing participants
owe **Platform Contribution Transaction (PCT)** buy-in payments for pre-existing
contributions. OTP-5 sets the RAB shares + PCT; OTP-11 periodically **trues up** the cost
shares as actual benefits diverge from anticipated.

## Approach
- **New CSA data source** — `backend/seeds/csa/csa.v1.json` + a thin module (read-only
  reference, or SQLite state if the wizard mutates). One CSA pool (the group R&D
  arrangement) with participants, RAB shares, annual cost pool, and PCT terms.
- **OTP-5 binding** (`marquee/otp5.tsx`) — guided setting wizard mirroring `otp3`:
  prepare (compute RAB shares from a benefit measure) → review → gated submit → review
  queue. KPIs: pool size, participants, top RAB share, PCT outstanding.
- **OTP-11 binding** (`marquee/otp11.tsx`) — true-up batch mirroring `otp9`: compute
  actual-vs-anticipated benefit delta → per-participant true-up → stage → post; lands in
  the review queue.

## DECISIONS TO CONFIRM (before implementation)
1. **RAB benefit measure** — *recommend* **projected sales** (defensible, common).
   Alternatives: units, operating income, headcount.
2. **Participants** — *recommend* reusing existing `entity_dim.json` entities (e.g.
   1000 US principal, 3000 DE, 4100 toller, + the IP owner) as CSA participants. Confirm
   which 3–4.
3. **Cost pool + PCT magnitudes** — the fabricated figures (e.g. a ~$120M annual R&D
   pool; a PCT buy-in for the platform contributor). Confirm a realistic scale.
4. **OTP-5 shape** — full guided wizard (prepare→gate→submit, like `otp3`) vs. a lighter
   setting view. *Recommend* the full wizard for consistency with the marquee set.
5. **True-up basis (OTP-11)** — derive "actual benefits" from the warehouse
   (`segment_pl` revenue by entity) vs. a seeded actuals figure. *Recommend* deriving
   from `segment_pl` so the true-up reads as live.

## Anticipated files
**Create:** `backend/seeds/csa/csa.v1.json`, `backend/state/csa.py` (or a read-only
`routers/csa.py` if the only mutation is the wizard's review-queue submission),
`backend/routers/csa.py`, `backend/tests/test_csa.py`,
`src/kernel/bindings/marquee/otp5.tsx`, `src/kernel/bindings/marquee/otp11.tsx`.
**Modify:** `backend/main.py`, `src/shared/api/types.ts`, `src/shared/api/client.ts`,
`src/kernel/bindings/index.ts` (map `OTP-5`, `OTP-11`).

## Verification (when built)
Backend pytest (RAB share math + true-up calc + any audit), frontend typecheck/build,
live curl of the CSA endpoints, and OTP-5 / OTP-11 reading **Live** on `/process` with
working wizard / batch flows that land in the review queue (maker ≠ checker preserved).

## Why deferred
The five decisions above shape fabricated financial figures that a TP audience will
scrutinise. A short confirmation is worth more than an unreviewed guess. Everything else
(the pattern to mirror, the file plan, the verification) is settled — implementation can
proceed immediately once the data model is agreed.

---

## RESOLVED (2026-06-08) — decisions locked + reconciled data model

**Decisions:** (1) RAB = **projected sales**; (2) participants **1000** US IP Principal,
**3100** Swiss IP Principal, **3800** NL Distribution; (3) **figures derived from
`segment_pl`** (see the $120M flag below); (4) OTP-5 = full guided wizard (≈ `otp3`);
(5) true-up actuals **live from `segment_pl`**.

**Reconciliation by construction.** Every CSA dollar is computed at runtime from the same
`GET /api/segments/pl?year=2026` warehouse data that OTP-20/21/dashboard read, so the
figures cannot drift between processes:

- `projected_sales_i = revenue_i × (1 + g)`, `g = 0.08`
- `rab_share_i = projected_sales_i / Σ projected_sales` (= revenue share; g cancels). Σ = 1.
- `pool = Σ opex_rd_i` (the shared development cost being cost-shared)
- `actual_contribution_i = opex_rd_i`
- `target_i = rab_share_i × pool`; `true_up_i = target_i − actual_i` (Σ true_up = 0)
- `platform_value = PCT_MULT × pool` (config, e.g. 3); `pct_buyin_i = rab_share_i × platform_value`

Real figures (FY2026): participants 1000/3100/3800 → revenue $169.6M / $77.4M / $53.8M;
`opex_rd` $3.2M / $3.8M / $3.8M; **pool ≈ $10.8M**; RAB shares 56.4% / 25.7% / 17.9%;
true-ups +$2.9M / −$1.0M / −$1.9M (Σ ≈ 0).

**⚠️ $120M flag (for review).** You confirmed "~$120M pool," but the warehouse's actual
R&D for these three entities is only **~$10.8M**. Honoring the overriding reconciliation
requirement, the pool is built from real data (~$10.8M) so OTP-5/11 reconcile with
OTP-21/dashboard. A $120M-scale CSA would require scaling up `segment_pl` R&D
group-wide — a larger, cross-process data change I won't make unattended. Say the word
and I'll do it. Blueprint: `docs/superpowers/plans/2026-06-08-process-wiring-increment-2-csa.md`.
