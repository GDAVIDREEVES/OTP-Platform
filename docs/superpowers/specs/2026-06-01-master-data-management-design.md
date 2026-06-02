# OTP Platform — Master Data Management (design spec)

- **Date:** 2026-06-01
- **Status:** Approved design (pre-implementation)
- **Branch context:** builds on `demo-readiness` (Phases 0–5)
- **Plan to follow:** to be produced by the writing-plans step

## Context

The OTP Platform is an operational transfer-pricing "close cockpit": a 50-process
module shell, a role-aware home, guided AI-assisted workflows with a visible
hand-off, an append-only hash-chained audit trail, and a director exposure view
(React/MUI + FastAPI + DuckDB/Parquet, with SQLite for mutable state).

Today the close cycle effectively begins at price-setting / monitoring. It is
missing its true front: **management of master data**. Transfer pricing is only
correct if the underlying master data is correct — the entity characterisations
and transaction definitions are the keys that select the right method, PLI,
arm's-length range, and benchmark for every downstream calculation. This feature
adds that front end:

1. A **master transaction matrix** — one row per covered intercompany transaction,
   composed from clearly-defined entities and transaction types, showing TP policy,
   PLI (target margin + lower/upper quartiles), country, policy reference,
   intercompany-agreement (ICA) reference, and APA reference.
2. An **inbound SAP mapping** process — when SAP passes a new entity, account,
   transaction type, or field the platform doesn't recognise, it is staged and
   mapped into the platform's data structure with AI assistance and human sign-off.

## Decisions (settled in brainstorming)

1. **Matrix nature — hybrid.** SAP-derived columns (entity identity, transactions,
   amounts, country) are read-only and drill to source; the TP-specific columns
   (policy ref, PLI/target selection, ICA ref, APA ref, and the entity's TP
   characterisation) are an **editable overlay** maintained in-app with
   maker-checker + audit. Mirrors the existing `persistence/overrides.py` pattern.
2. **Mapping — agentic staging.** Unrecognised SAP values land in a staging queue;
   the Research Brain proposes the canonical mapping (with rationale, confidence,
   citations); a human reviews/edits; a gated submit routes to maker-checker; on
   approval it is applied to the master and audited. **No auto-apply** — every
   mapping requires human sign-off (AI is never the checker). Accounts and
   transaction types follow the **same** staging → propose → confirm flow as
   entities.
3. **Placement — dedicated top-level workspace.** A new `/master-data` route
   (sibling of `/home`, `/director`) with its own sub-nav, surfaced as the cycle's
   starting point on Home. Diverges from the one-shell-renders-all `ProcessShell`,
   but makes master data unmistakably the front of the cycle; still reuses kernel
   primitives.
4. **Inbound data — seeded batch + simulate trigger.** Ship a versioned inbound
   feed with ~3 unmapped items (new entity RBUKRS 3500 "Spain Distribution Co.", a
   new GL account 417000 "Royalty expense – trademark", a new transaction "Contract
   R&D services" DE→IN) so the staging queue is populated on load, plus a "Simulate
   SAP delta" button to push another batch live.

### Refinements

- **TP function is a controlled dimension, not free text.** It is chosen from a
  controlled vocabulary and is identical across all entities of a type (every
  limited-risk distributor reads exactly "Limited-Risk Distributor", independent of
  the entity name or country). The function — not the entity name — is the key the
  policy engine reads to resolve method/PLI/range/benchmark.
- **Entities can hold multiple functions.** The Entity master grain is
  **entity × function** (one-to-many): a principal that also owns IP, or a
  manufacturer that also provides intra-group services, gets a row per function,
  with an "+ add function" placeholder to extend it. Each function row carries its
  own tested-party flag and the transactions it applies to. The matrix references
  the specific *(entity, function)* pair per covered transaction.

## Goals / Non-goals

**Goals**
- Entities and transaction types are first-class, clearly-defined master objects.
- TP function is a governed dimension that demonstrably drives the calculation.
- The matrix is an export-ready TP workpaper; every cell drills to source.
- A believable, auditable inbound-mapping workflow that reuses the platform's
  agentic + maker-checker + audit spine.

**Non-goals (YAGNI for this iteration)**
- Real-time SAP/IDoc integration (the inbound feed is a seeded/simulated delta).
- Full bi-temporal versioning of master data (we keep simple effective-dating
  fields in the seed schema for later, but do not build time-travel UI now).
- Re-keying SAP-owned identity data (entity name/country/currency stay read-only).
- Per-transaction function *overrides* beyond the entity-function assignment
  (the entity-function applies-to mapping is sufficient for the demo).

## Architecture & placement

- New top-level route **`/master-data`** added in `src/App.tsx` and the app nav
  (CategoryRail / top nav), wrapped in the existing `ErrorBoundary` + `Suspense`.
- A `MasterDataWorkspace` component renders a sub-nav: **Entities · Transactions ·
  Matrix · Inbound mapping** (badge = unmapped count) **· Audit**.
- Surfaced on the role-aware Home (`OperatingCadenceHome`) as the first lifecycle
  stop ("Master data") so the cycle visibly starts here.
- Reuses kernel primitives: `DrillDrawer`, `ProvenanceChip`, `useGuidedWorkflow`,
  `AgenticHandoffMarker`, the `review` queue, `useAudit` / `AuditRail`, and the
  `EvidencePacket` print pattern for matrix export. It does **not** use
  `ProcessShell` (this is a workspace, not one of the 50 processes).

## Data model

### SAP-derived (read-only, drill to source)
- Entity identity: `backend/dim/entity_dim.json` (RBUKRS, display_name, country,
  country_code). **Add** `functional_currency` to each entity record.
- Transactions / amounts: the existing ACDOCA `journal` DuckDB view (drill target);
  `segment_pl` / `services.entities` for actual margins used in actual-vs-range.

### New versioned seeds (`backend/seeds/master_data/`)
- **`tp_functions.v1.json`** — controlled vocabulary. Each:
  `{code, label, default_method, default_pli, typically_tested}`. Values:
  `PRIN` Principal / Entrepreneur, `IPOWN` IP Owner / Licensor, `FRMFG` Full-Risk
  Manufacturer, `TOLL` Toll / Contract Manufacturer, `LRD` Limited-Risk
  Distributor, `SVC` Intra-Group Service Provider, `TREAS` Treasury / Finance.
- **`transaction_types.v1.json`** — covered-transaction definitions. Each:
  `{txn_type_id, label, category, method, pli, benchmark_set_id, oecd_anchor,
  characterising_function}`. Six types tied to existing `benchmarks.v1.json`:
  `ROY-API`→BM-ROY-API, `ROY-TM`→BM-ROY-TM, `DIST-LRD`→BM-LRD, `MFG-TOLL`→BM-TOLL,
  `SVC`→BM-SVC, `FIN`→BM-FIN. `characterising_function` is the function whose
  presence selects this type: the **tested party** for TNMM types (LRD, Toll, SVC)
  and the **price-defining party** for CUP types (IP Owner for royalties, Treasury
  for financing).
- **`entity_functions.v1.json`** — entity→function assignments (one-to-many). Each:
  `{rbukrs, tp_function_code, is_primary, tested_party, applies_to_categories[],
  effective_from, effective_to}`. Initial characterisations:
  - 1000 US → PRIN (primary) + IPOWN
  - 3100 CH → PRIN (primary) + IPOWN
  - 3000 DE → FRMFG (primary) + SVC
  - 3200 FR / 3300 UK / 3800 NL → LRD
  - 3400 IE → TREAS
  - 4100 IN → TOLL
- **`covered_transactions.v1.json`** — the matrix backbone. Each:
  `{ctx_id, txn_type_id, payer_rbukrs, payee_rbukrs, tested_rbukrs, policy_ref,
  ica_ref, apa_ref, effective_from, effective_to}`. The overlay fields
  (policy/ICA/APA) seed the editable overlay; actual-vs-range is computed, not
  stored.
- **`inbound/sap_delta.v1.json`** — the seeded unmapped batch (entity 3500, account
  417000, transaction "Contract R&D services"), used to populate staging on load
  and by the simulate endpoint.

### New SQLite state (mutable overlay + staging)
Via the existing `backend/state/` engine; **every mutation routes through
`state/audit.record()`** (hash-chained) and edits go through the `review`
maker-checker module.
- **`md_entity_function`** — editable entity-function overlay
  `{id, rbukrs, tp_function_code, is_primary, tested_party, applies_to(json),
  status, created_at, updated_at}`. Seeded from `entity_functions.v1.json`.
- **`md_overlay`** — editable matrix overlay per covered transaction
  `{ctx_id, policy_ref, ica_ref, apa_ref, target_override, notes, updated_by,
  updated_at}`. Seeded from the overlay portion of `covered_transactions.v1.json`.
- **`md_staging`** — inbound queue
  `{id, kind(entity|account|transaction|field), raw_json, status(unmapped|
  proposed|in_review|applied|rejected), proposed_json, confidence, rationale,
  maker, created_at, updated_at}`.
- **`md_mapping`** — applied mappings `{id, kind, raw_key, canonical_ref(json),
  applied_by, applied_at}` so future deltas with the same raw key auto-resolve.

### The resolution (why master data drives the calc)
`(characterising function, transaction category)` → resolves → `transaction_type`
→ `{method, pli, benchmark_set_id, arm's-length range}`. For TNMM types the
characterising function is the tested party (LRD/Toll/SVC), whose actual PLI
(operating margin / net cost-plus from the journal) is compared to the range; for
CUP types it is the price-defining party (IP Owner for royalties, Treasury for
financing), whose actual rate is compared directly to the benchmark price.
Changing an entity's function changes the applicable transaction types and
therefore the method/range/benchmark and all downstream calculations. This
resolution is a pure backend function (unit-tested) consumed by `/matrix` and
reused by the mapping proposer.

## Backend (`backend/routers/master_data.py`)

Read (accept the existing `PeriodFilter` params):
- `GET /api/master-data/functions` — controlled vocabulary.
- `GET /api/master-data/entities` — entity master at entity×function grain
  (`entity_dim` ⨝ `md_entity_function`).
- `GET /api/master-data/transaction-types` — type defs with resolved range.
- `GET /api/master-data/matrix` — covered transactions composed: parties + roles,
  resolved method/PLI/range, overlay refs, and actual-vs-range status (reusing
  `services/entities` + the `journal` view).

Write (→ enqueue `review`, audited; no self-approval; AI never checker):
- `PUT /api/master-data/entity-function` — add/edit/retire an entity-function.
- `PUT /api/master-data/overlay` — edit a covered transaction's policy/ICA/APA.

Staging / mapping:
- `GET /api/master-data/staging` — queue + unmapped count.
- `POST /api/master-data/staging/simulate` — inject a new SAP delta batch.
- `POST /api/master-data/staging/{id}/propose` — agentic: returns
  `{proposed, rationale, confidence, citations}` and logs an assistant `prepared`
  event.
- `POST /api/master-data/staging/{id}/submit` — maker enqueues review.
- **Apply-on-approval** — the existing review-approve path, when the item is a
  master-data mapping/overlay, applies it to `md_mapping` + the relevant master
  table and audits `applied`.

## AI integration

Extend the agentic Research Brain pattern (`research_brain.py`) with a mapping
proposer: given a raw SAP item + the `tp_functions` vocab + existing entities /
transaction types / GL footprint, propose the canonical mapping. Tiered, graceful
fallback consistent with the existing surfaces:
1. **Live** — Claude synthesis (when `ANTHROPIC_API_KEY` set), optionally grounded
   by a researchbrain `retrieve` for OECD/policy citations.
2. **By-analogy heuristic** (always available, offline) — match the raw item to
   the nearest existing master object by naming + GL footprint + flow routing
   (e.g. RBUKRS 3500 routes through the same distribution flows as 3200/3300/3800 →
   propose LRD). Produces a defensible proposal with rationale + confidence even
   with no key/service.
3. **Templated** — last-resort shaped proposal.
A clear live/offline indicator, as elsewhere. **Never auto-applies.**

## Frontend (`src/features/master-data/`)

- `MasterDataWorkspace.tsx` — route shell + sub-nav + unmapped badge.
- `EntityMaster.tsx` — entity×function table; SAP identity merged on the left;
  TP-function dropdown (from the controlled list); per-function tested-party +
  applies-to; "+ add function" placeholder; overlay edits → maker-checker.
- `TransactionMaster.tsx` — transaction-type definitions table.
- `TransactionMatrix.tsx` — dense workpaper grid (layout A): SAP columns read-only,
  TP-overlay columns editable + tinted, actual-vs-range status chip, every cell
  drills via `DrillDrawer`, export/print via the EvidencePacket print pattern.
- `InboundMapping.tsx` — staging queue (exceptions-first) + the agentic mapping
  wizard (`useGuidedWorkflow` + `AgenticHandoffMarker` + review), + "Simulate SAP
  delta".
- `src/shared/api/client.ts` + `types.ts` — new typed client methods/shapes.

## States, invariants, errors

- Empty staging queue → "all caught up" state; loading spinners; Research Brain
  offline → heuristic proposal with offline indicator.
- Maker-checker invariants reused as-is: checker ≠ maker; `actor_kind='assistant'`
  rejected as checker; assisted steps logged as a distinct actor.
- Overlay edits are optimistic with toast on failure; chain stays verifiable
  (`/api/audit/verify`).

## Testing (TDD, house style)

Backend (`backend/tests`):
- Resolution: `(function, transaction)` → correct method/PLI/range/benchmark.
- Entity×function one-to-many (multi-hat entity returns multiple rows; matrix picks
  the right pair per flow).
- Matrix composition incl. actual-vs-range status from the journal.
- Overlay edit → review → approve → applied, with an audit event each step and
  `verify_chain()` green; self-approval blocked; AI-as-checker blocked.
- Staging: simulate → propose (mocked researchbrain + heuristic fallback) → submit
  → approve → applied → appears in master; `md_mapping` auto-resolves a repeat.

Frontend: `npm run typecheck` + `npm run build` clean; component smoke via MCP
preview (matrix renders + drills + exports; mapping wizard runs to a gated submit;
audit shows the assistant→maker→checker trail).

## Phasing (each independently demoable & committed)

- **MD-1 — Backend foundation.** Seeds (`tp_functions`, `transaction_types`,
  `entity_functions`, `covered_transactions`, `inbound/sap_delta`); `entity_dim`
  currency; SQLite tables + migrate/seed-load + reset; resolution function; read
  endpoints (`/functions`, `/entities`, `/transaction-types`, `/matrix`); overlay
  write endpoints. *Verify:* backend tests green; `/api/master-data/matrix` returns
  composed rows with actual-vs-range.
- **MD-2 — Workspace frontend.** `/master-data` route + nav + Home entry;
  `MasterDataWorkspace`; Entities, Transactions, Matrix (read + overlay edit with
  maker-checker + drill + export). *Verify:* typecheck/build; in-browser walkthrough.
- **MD-3 — Inbound mapping.** Staging seed + simulate + agentic propose
  (live + heuristic) + review-apply + audit; `InboundMapping` UI end-to-end.
  *Verify:* full staging→approve→applied loop; chain verifies; offline fallback.
- **MD-4 — Polish & ops.** Home lifecycle integration, `DEMO.md` master-data beats,
  empty/error states, pristine `--reset`, final verification.

## Critical files

- **Create:** `backend/routers/master_data.py`; `backend/seeds/master_data/**`;
  `backend/state/` table additions (schema + seed-load); `src/features/master-data/**`;
  `docs/superpowers/specs/2026-06-01-master-data-management-design.md` (this file).
- **Modify:** `backend/main.py` (include router; seed-load), `backend/dim/entity_dim.json`
  (currency), `backend/state/schema.sql` + `migrate.py` (md_ tables + seed), `backend/
  routers/research_brain.py` (mapping proposer), `backend/state/review.py` (apply-on-
  approval hook), `src/App.tsx` (route), nav + `OperatingCadenceHome` (entry),
  `src/shared/api/client.ts` + `types.ts`, `DEMO.md`.
- **Reuse:** `state/{audit,review,drafts}.py`, `persistence/overrides.py` pattern,
  `services/entities.py` + the `journal`/`segment_pl` views, `benchmarks.v1.json`,
  `useGuidedWorkflow`, `AgenticHandoffMarker`, `DrillDrawer`, `ProvenanceChip`,
  `useAudit`/`AuditRail`, `EvidencePacket` print, `SessionProvider`.

## Risks & mitigations

- **Scope creep into a real ERP integration** → explicitly seeded/simulated inbound;
  schema leaves room (effective dates, mapping table) without building time-travel.
- **AI proposal quality on stage** → deterministic by-analogy heuristic underpins the
  live path; hand-off + audit render regardless of answer quality; never auto-applies.
- **Divergence from the kernel** → a standalone workspace is intentional, but it
  reuses the kernel's data/audit/workflow primitives so behaviour stays consistent.
- **Audit completeness** → all mutations route through `audit.record()`; covered by
  chain-verify tests.
