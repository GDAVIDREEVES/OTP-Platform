# OTP Platform — Home & Master Data improvements (design spec)

- **Date:** 2026-06-02
- **Status:** Approved design (pre-implementation)
- **Branch context:** builds on `demo-readiness` (Phases 0–5 + Master Data)
- **Builds on spec:** `docs/superpowers/specs/2026-06-01-master-data-management-design.md`

## Context

Iterative review of the OTP Platform tabs, starting with **Home** and **Master Data**.
Three improvements, validated in brainstorming:

1. **Home** — the lifecycle stepper is presentational; make every stage **clickable**
   (navigates to its process) and split it into the real close-cycle stages.
2. **Master Data — entity master** — the "Applies to" column wrongly shows the seeded
   `applies_to` categories; it should list **every transaction type the entity
   participates in**, derived from the covered transactions.
3. **Master Data — matrix governance** — today the matrix is the planned list only.
   It should be **planned + unplanned**: the TP department's planned transactions
   (the curated covered transactions) **plus** intercompany transactions the business
   actually ran that weren't planned — detected from the ACDOCA actuals, surfaced as
   **`unmapped`** rows, and mapped (PLI/method/policy/ICA/APA) through the existing
   Inbound-mapping pipeline.

## Decisions (settled in brainstorming)

- **Home lifecycle** = Master Data → Price Setting → Royalty Calculation →
  Service Allocations → Monitor margins → Adjust & true-up → Reserve & provision.
  Each stage links to its process. "Set rates" → "Price Setting"; "Charge & invoice"
  splits into "Royalty Calculation" + "Service Allocations".
- **Service allocations IS in the tool** (OTP-10 "Service cost allocation calc &
  invoicing"). **OTP-10 stays an informative stub** this round (clicking still renders
  the standard module shell); wiring it fully is deferred.
- **Planned set = the curated covered transactions** (the TP department's planned list).
- **Unplanned auto-detected from actuals**: scan the `journal` for intercompany
  postings (`RASSC` = an affiliated entity); any entity-pair not covered by a planned
  (or already-mapped) covered transaction surfaces in the matrix as `unmapped`.
- **Mapping routes through the existing Inbound-mapping pipeline** (agentic propose →
  human review → maker-checker → applied), reusing everything built in the Master Data
  feature. The matrix's unmapped row has a **"Map"** action into it; applying creates a
  covered transaction so the row flips to `mapped`.

## Goals / Non-goals

**Goals**
- Home stage = a clickable entry into the relevant process; stages mirror the cycle.
- Entity master shows real participation (derived), not hand-seeded categories.
- The matrix tells the truth: planned coverage **and** the gaps the actuals reveal,
  closed through one auditable mapping workflow.

**Non-goals (YAGNI this round)**
- Wiring OTP-10 (or OTP-1/2/4) as rich marquee modules — stubs are fine targets.
- A separate "planning" artifact distinct from covered transactions.
- Fine-grained account-level transaction typing in the detector (coarse entity-pair
  grain is enough; the mapping step assigns the precise type).
- Per-line journal drill on unplanned rows beyond the existing tested-party drill.

## A. Home — clickable close-cycle stepper

`src/kernel/home/OperatingCadenceHome.tsx`:
- Change `CYCLE` from `string[]` to `{ label: string; route: string }[]`:
  | label | route |
  |---|---|
  | Master Data | `/master-data` |
  | Price Setting | `/process/OTP-3` |
  | Royalty Calculation | `/process/OTP-9` |
  | Service Allocations | `/process/OTP-10` |
  | Monitor margins | `/process/OTP-20` |
  | Adjust & true-up | `/process/OTP-16` |
  | Reserve & provision | `/process/OTP-45` |
- `CURRENT = 4` (Monitor margins).
- In `LifecycleStepper`, each node becomes clickable (`useNavigate()` → `node.route`;
  cursor pointer + hover affordance). The numbered-circle + label stay; only
  interactivity + the new labels/sequence change. Keep the existing "Open Master Data"
  button (now redundant with the clickable first node — remove it to avoid duplication).
- All routes resolve: OTP-3/9/20/16/45 are wired marquees; OTP-10 renders the
  informative module shell.

## B. Master Data — entity master "Applies to" → derived participation

Backend `state/master_data.py`:
- Add `entity_participation() -> dict[str, list[str]]`: for each rbukrs, the set of
  transaction-type **labels** from every covered transaction (seed + mapped, see §C)
  where the entity is `payer_rbukrs`, `payee_rbukrs`, or `tested_rbukrs`. De-duped,
  stable order.
- `entity_master()` rows gain `participates_in: list[str]` (entity-level; identical
  across an entity's function rows). The seeded `md_entity_function.applies_to` stays
  for mapping-proposal defaults but is **no longer shown** in this column.

Frontend `src/features/master-data/EntityMaster.tsx`:
- Rename the column **"Applies to"** → **"Participates in"**; render `participates_in`
  chips (shown once per entity group, on the first row).

`src/shared/api/types.ts`: `MdEntityRow` gains `participates_in: string[]`.

## C. Master Data — planned + unplanned matrix

### Detection (backend)
- `unplanned_flows() -> list[dict]` in `state/master_data.py`:
  - Query the `journal` view for intercompany postings:
    ```sql
    SELECT RBUKRS, RASSC, SUM(HSL) AS amount, COUNT(*) AS lines
    FROM journal
    WHERE RASSC IS NOT NULL AND RASSC <> RBUKRS AND RASSC IN (<entity rbukrs set>)
    GROUP BY RBUKRS, RASSC
    ```
    (entity set from `entity_dim` ∪ onboarded). Coarse entity-pair grain.
  - `planned_pairs` = the set of unordered `{payer, payee}` pairs from the planned
    covered transactions **plus** mapped-unplanned covered transactions (§ mapping).
  - An actual IC pair **not** in `planned_pairs` → an **unplanned flow**:
    `{ flow_id: "UNPL-<RBUKRS>-<RASSC>", payer_rbukrs, counterparty_rbukrs, amount, lines }`.
- **Demo reliability:** seed one guaranteed unplanned flow as a staging item so the loop
  always demos even if the sample journal surfaces none — `backend/seeds/master_data/
  inbound/sap_delta.v1.json` gains a `kind:"unplanned_transaction"` item (e.g. an
  unexpected management-fee flow between an entity pair with no planned covered
  transaction). The live detector adds any real ones on top.

### Matrix composition (backend)
`matrix()` returns the union, each row tagged `planned: bool` + `status`:
- **Planned/mapped** — seed covered transactions **and** mapped-unplanned covered
  transactions (reconstructed from `md_mapping` where `kind` ∈ {`transaction`,
  `unplanned_transaction`}); full method/PLI/range/refs as today; `status` in
  {`in_range`,`review`,`na`}.
- **Unplanned/unmapped** — detected flows + seeded unplanned staging items not yet
  mapped; `status:"unmapped"`, `planned:false`, method/PLI/policy/ICA/APA null, the
  **actual amount** shown, parties + roles from the entity master, and a `flow_id` /
  `staging_id` so the UI can offer **Map**.

### Mapping (reuses the Inbound pipeline)
- **Detection is read-only** (computed inside `matrix()` — no writes during a GET). The
  **seeded** unplanned flow ships as a `md_staging` item, so it shows in the **Inbound
  mapping** queue + badge from the start. **Live-detected** flows appear in the matrix as
  unmapped rows but enter `md_staging` only when the user clicks **Map**, which calls
  `POST /api/master-data/staging/promote {flow}` (idempotent on `flow_id`) to create the
  `kind:"unplanned_transaction"` staging item and returns its `staging_id`.
- `services/mapping_ai.propose_mapping` handles `kind:"unplanned_transaction"`: proposes
  `{ txn_type_id, policy_ref?, ica_ref?, apa_ref? }` (txn type carries method/PLI/
  benchmark; by-analogy from the parties' functions, optional Claude).
- `apply_mapping` (extended) for this kind writes `md_mapping` with `canonical_json` =
  the covered-transaction definition `{ctx_id, txn_type_id, payer_rbukrs, payee_rbukrs,
  tested_rbukrs, policy_ref, ica_ref, apa_ref}` and seeds `md_overlay` for that `ctx_id`.
  `matrix()` then includes it as a **mapped** row, and the entity-pair joins
  `planned_pairs` so the detector stops flagging it. Audited `posted` as today; the
  maker-checker guards are unchanged.
- The matrix unmapped row's **"Map"** action: if the row already has a `staging_id`
  (seeded/previously-promoted) it deep-links straight to `/master-data/mapping?focus=<staging_id>`;
  otherwise it first calls `promote` to stage the live-detected flow, then deep-links with
  the returned `staging_id`.

### Frontend
- `TransactionMatrix.tsx`: render unmapped rows (greyed method/PLI/policy with a
  `unmapped` status chip + the actual amount); a **Map** button → the focused Inbound tab.
- `InboundMapping.tsx`: render `unplanned_transaction` items like the others (the
  proposed fields differ); honor a `?focus=` query param to scroll/highlight an item.
- `MdMatrixRow` gains `planned: boolean`, `actual_amount: number | null`,
  `flow_id: string | null` (live-detected), `staging_id: string | null` (already staged);
  `MdStagingItem.kind` adds `"unplanned_transaction"`.

## Reuse
`md_mapping` / `md_overlay` / `md_staging` tables, `review` (maker-checker), `audit`,
the Inbound-mapping UI + `useMappingWorkflow`, `mapping_ai`, the `journal` DuckDB view,
`entity_master`/`matrix` composition, `DrillDrawer`. No new SQLite tables.

## Testing (TDD)
Backend:
- `entity_participation` derives the right txn-type set per entity from covered
  transactions; `entity_master` exposes `participates_in`.
- `unplanned_flows` flags an IC pair present in the journal/seed but absent from the
  planned set; once a covered transaction exists for that pair, it is no longer flagged.
- `matrix` returns planned (`mapped`) + unplanned (`unmapped`) rows with correct tags.
- Mapping an `unplanned_transaction` through approve creates a covered transaction
  (`md_mapping`), flips the matrix row to `mapped`, removes it from the unmapped set,
  and the audit chain verifies; maker≠checker / AI-never-checker still enforced.

Frontend: `npm run typecheck` + `npm run build`; Home stages navigate; matrix shows
unmapped rows + Map; entity master shows participation; Inbound `?focus=` highlights.

## Phasing (each independently demoable & committed)
- **I-1 — Home stepper.** Clickable + revised stages + routes; remove the redundant
  button. *Verify:* build; each stage navigates.
- **I-2 — Entity participation.** `entity_participation` + `entity_master.participates_in`
  + the renamed column. *Verify:* backend test; column shows derived types.
- **I-3 — Planned + unplanned matrix.** Detector, matrix union, staging feed (+ seed),
  `apply_mapping` for `unplanned_transaction`, matrix Map + focused Inbound. *Verify:*
  full detect → map → mapped loop, backend tests + in-browser.

## Critical files
- **Modify (backend):** `state/master_data.py` (`entity_participation`, `unplanned_flows`,
  `matrix` union, `apply_mapping` for the new kind), `services/mapping_ai.py`
  (`unplanned_transaction` proposal), `routers/master_data.py` (`POST /staging/promote`),
  `seeds/master_data/inbound/sap_delta.v1.json` (seed one unplanned flow).
- **Modify (frontend):** `kernel/home/OperatingCadenceHome.tsx`; `features/master-data/
  {TransactionMatrix,EntityMaster,InboundMapping}.tsx`; `shared/api/{client,types}.ts`.
- **Reuse:** `md_mapping`/`md_overlay`/`md_staging`, `review`, `audit`, `useMappingWorkflow`.

## Risks & mitigations
- **Sample journal may lack a detectable unplanned pair** → seed one guaranteed unplanned
  flow; the live detector augments.
- **Coarse entity-pair grain may merge distinct flows** → acceptable for the demo; the
  mapping step assigns the precise transaction type. Finer (pair + account) grain is a
  later refinement.
- **Detector performance over the full journal** → single aggregated DuckDB GROUP BY;
  fast. `planned_pairs` is tiny (Python set membership).
