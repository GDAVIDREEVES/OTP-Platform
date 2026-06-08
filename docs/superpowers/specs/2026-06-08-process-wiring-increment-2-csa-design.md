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
