# Process Wiring (tranches) — Increment 3: Governed ERP→master-data wizards (OTP-27, OTP-41)

## Goal
Wire OTP-41 (ERP master-data maintenance) and OTP-27 (new IC flow onboarding) to
two guided-wizard bindings that REUSE the existing master-data staging pipeline
(promote → propose → submit → approve → apply, SoD enforced in `review.py`:
maker≠checker, AI-never-checker). No pipeline rebuilt, no new backend endpoints.

## What I built
- **Frontend** (`src/kernel/bindings/marquee/otp41.tsx`): OTP-41 binding mirroring
  `otp16.tsx`'s prepare→review→submit shape via
  `useGuidedWorkflow('OTP-41', 'mdmap:<id>', STEPS)`. Drives off the inbound SAP
  delta (`GET /api/master-data/staging`), filtered to definitional maintenance
  kinds (`entity`/`account`/`transaction`/`field`) — e.g. new entity 3500
  (Spain Distribution Co.) and GL account 417000 (Royalty expense – trademark).
  - *Characterise* runs the EXISTING AI proposer (`api.mdPropose` →
    `/staging/{id}/propose`), which writes the proposal into `md_staging` and logs
    a `prepared` audit event; the wizard also calls `researchBrainPrepare` to log
    the agentic hand-off and capture the summary.
  - *Review* shows the proposed mapping table + rationale/confidence (all from the
    proposer).
  - *Submit* (gate) routes into the master-data maker-checker queue via
    `api.mdSubmitMapping` (existing `/staging/{id}/submit`), then `g.submit()`
    enqueues review and clears the draft.
  - A primary "Open Master Data to review" button deep-links to
    `/master-data/mapping` for the full review/approve/apply cycle.
  - KPIs (all backend-sourced from `md_staging`): open SAP deltas, awaiting
    approval, applied this cycle.
- **Frontend** (`src/kernel/bindings/marquee/otp27.tsx`): OTP-27 binding, same
  guided shape via `useGuidedWorkflow('OTP-27', 'mdmap:<id>', STEPS)`. Drives off
  the existing unplanned-flow detection: reads `GET /api/master-data/matrix` and
  filters to rows with `status === 'unmapped'` (both seeded
  `unplanned_transaction` staging items like `UNPL-3300-3400`, and flows detected
  straight from ACDOCA actuals).
  - *Characterise* → *Map* → *Submit*. For a flow detected in actuals (has
    `flow_id`, no `staging_id`), the wizard first **promotes** it into the staging
    pipeline (`api.mdPromoteFlow` → `/staging/promote`, id == `flow_id`), then
    runs `api.mdPropose` to map it to a covered transaction type, then
    `api.mdSubmitMapping`. Already-staged flows skip the promote.
  - KPIs (all from `master-data/matrix`): uncovered IC flows, detected-in-actuals,
    in-intake, and uncovered exposure (Σ `actual_amount`, compact-formatted).
- **Registry** (`src/kernel/bindings/index.ts`): registered `'OTP-27': otp27` and
  `'OTP-41': otp41`, preserving every existing entry (OTP-23, the OTP-30/31/40/50
  caseWorkspace ones, OTP-5/11 csa, etc.).

## Data decision
- Both wizards key their workflow draft/record-ref on `mdmap:<staging_id>` — the
  SAME `record_ref` the master-data router uses for review/audit
  (`review.create_item(record_ref=f"mdmap:{item_id}")`). This means the evidence
  packet and audit trail line up whether the item is driven from the OTP-27/41
  wizard or the `/master-data` Inbound mapping workspace; the two surfaces are two
  doors onto one pipeline, not parallel state.
- OTP-41 deliberately scopes its picker to definitional kinds and **excludes**
  `unplanned_transaction` (that is OTP-27's domain). This keeps the two wizards
  driving disjoint slices of the same `md_staging` table — no double-handling.
- Every displayed figure (delta counts, flow amounts, uncovered exposure) is read
  live from `md_staging` / `master-data/matrix` — no hardcoded numbers. The AI
  proposal text/confidence come from the existing `services/mapping_ai.py`.

## Files
- src/kernel/bindings/marquee/otp41.tsx (new)
- src/kernel/bindings/marquee/otp27.tsx (new)
- src/kernel/bindings/index.ts (registered OTP-27, OTP-41; existing entries preserved)

## Verification
- `cd backend && ../.venv/bin/python -m pytest -q` → 109 passed (no backend
  changes; reused existing endpoints).
- `npm run typecheck` → clean; `npm run build` → built ok.
- No exact-count binding assertions exist in the frontend to relax.
