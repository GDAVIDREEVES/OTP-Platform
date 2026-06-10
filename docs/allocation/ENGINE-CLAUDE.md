# CLAUDE.md — OTP Intercompany Cost Allocation Engine

## What this project is
A deterministic, auditable engine that converts source GL cost lines into intercompany service charges under OECD TPG Chapter VII and US Treas. Reg. §1.482-9. The domain logic, algorithms, validations, and acceptance criteria live in `docs/SPEC.md`. Read it fully before writing code.

## Source-of-truth rules
1. `docs/intercompany-allocation-schema.json` is the **only** source of truth for the data model (11 entities, 145 fields, 19 enumerations, explicit FK `references` objects). Generate TypeScript types, Zod validators, and DDL (DuckDB + BigQuery) from it via `/packages/codegen`. Never hand-write or hand-edit entity shapes.
2. `docs/intercompany-allocation-schema.md` is a human-readable rendering of the same model. If they ever disagree, the JSON wins; regenerate the MD.
3. Model changes: edit `schema.json` → run codegen → then touch code. Never the reverse.

## Hard rules (do not violate, even to make tests pass)
- **No float math on money.** Use `decimal.js` everywhere, including tests. Rounding only at the three boundaries defined in SPEC §5.6.
- **Append-only ledgers.** `1_CostLine`, `7_KeyValue`, `10_ChargeLedger`, `11_Recon` never receive UPDATEs; corrections are reversing rows.
- **No silent defaults.** Missing markup policy, missing key value, or unmapped cost center is a BLOCK exception by design (SPEC §7). Do not invent fallbacks.
- **Determinism.** Same inputs → byte-identical outputs. Tie-breaks are always by ascending ID (SPEC §5.1). Runs snapshot and hash their inputs.
- **Engine purity.** `/packages/engine` has no I/O. Persistence and UI are adapters.

## Conventions
- TypeScript strict; snake_case for data fields (they mirror `data_element` names exactly), camelCase for code-level variables/functions.
- Enum fields validate against the `enumerations` array in `schema.json` (V-R2).
- Effective-dated reference data resolves as-of the run period (SPEC §5.5).
- Tests: Vitest. The golden run in `/packages/engine/test/golden/` (SPEC §9.2) is the primary acceptance gate — keep it green at all times after M4.

## Workflow
- Implement milestones M1–M7 in order (SPEC §10); each milestone's gate tests must pass before starting the next.
- When a SPEC requirement is ambiguous, prefer the more auditable/conservative interpretation, note the decision in `docs/DECISIONS.md`, and continue — don't stall.
- Validation rules carry IDs (V-P1, V-K3, ...). Reference rule IDs in code comments and test names so the exception report maps 1:1 to the catalogue.

## Domain context in one paragraph (for orientation, not implementation)
Costs are captured from the GL, pooled by homogeneous service line, stripped of non-chargeable amounts (stewardship/duplicative/incidental — the "benefit test"), apportioned to beneficiary entities by allocation keys (or charged directly when traceable), marked up per pool-and-jurisdiction policy (benchmarked %, OECD LVAIGS 5%, US SCM 0%, pass-through 0%), converted and charged out, then reconciled so that pooled cost = exclusions + recovered cost + zero residual, with year-end true-ups from budget to actual. Multi-tier groups require topologically ordered cascading; mutual providers require the reciprocal (simultaneous-equation) method.
