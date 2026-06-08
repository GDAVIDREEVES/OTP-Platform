# Process Wiring (tranches) — Increment 7: US documentation & return-input workpapers (OTP-37, OTP-32, OTP-33)

## Goal
Wire the three documentation processes to live bindings over a single new
warehouse-derived rollup endpoint:
- **OTP-37 — IRC §6662 documentation prep**: per covered transaction, compose
  the best-method + benchmark narrative with the existing `/api/evidence` packet
  (audit + before/after diffs + linked ACDOCA postings + chain integrity).
- **OTP-32 — Local File data preparation**: the same per-entity rollup, framed
  as OECD Local File (TPG Ch. V) controlled-transaction content blocks.
- **OTP-33 — Master File data preparation**: compose the entity master +
  DEMPE/intangibles + CbCR seeds as OECD Master File blocks (mirroring otp29
  DEMPE and otp34/otp35 CbCR).

Every displayed number traces to `GET /api/documentation` (or the reused
`/api/evidence` and `/api/reference/*`); nothing is hardcoded.

## What I built
- **Backend** (`backend/routers/documentation.py`): new `GET /api/documentation`
  — the **one** new endpoint. Derives entirely from
  `state.master_data.matrix()` (itself built over `segment_pl` / `journal` via
  `db.q` + the covered-transaction seeds). Rolls every covered transaction up
  under its **tested party**, attaching the entity's SAP identity + headline
  FAR/function (from `entity_master()`), and per transaction the method, PLI,
  benchmark range (reference benchmarks), OECD anchor, governing refs
  (policy/ICA/APA), counterparties, and a **linked evidence ref**
  (`doc:<rbukrs>`). Unmapped flows are excluded (not yet covered transactions).
  Returns `{entities:[…], totals:{entities,covered,in_range,review}}`.
- **Backend wiring** (`backend/main.py`): imported + registered
  `documentation.router` (after `master_data.router`); preserved every router.
- **Backend test** (`backend/tests/test_documentation.py`): TestClient against
  `main.app`, mirroring `test_master_data.py` + `conftest.state_db`. Asserts the
  rollup groups by tested entity (France LRD → CTX-DIST-FR, TNMM, 2.0–4.0 range,
  POL-DIS-26, FAR from the master), that the `doc:<rbukrs>` evidence ref
  **resolves through the existing `/api/evidence` endpoint** (verify + postings)
  and is shared by every covered row, that unmapped flows never leak in, and
  that the totals reconcile to the per-entity counts. 3 tests, all green.
- **Frontend** (`src/kernel/data/DocEvidenceDrawer.tsx`): reusable right-side
  evidence drawer that fetches `/api/evidence/<ref>` and renders the packet
  inline (event history, before/after diffs, linked ACDOCA postings, chain
  chip), with a link out to the standalone print-ready `/evidence/:ref` page.
- **Frontend** (`src/kernel/bindings/marquee/otp37.tsx`): §6662 grid + evidence
  panel. Owns the shared `useDocumentation()` hook and the `rangeText` /
  `methodNarrative` helpers (re-exported to otp32/otp33). One row per covered
  transaction; a gavel button opens the §6662 evidence packet.
- **Frontend** (`src/kernel/bindings/marquee/otp32.tsx`): Local File — the same
  rollup as per-entity OECD Ch. V content blocks (controlled-transaction table
  per entity, method/range/ICA-APA, per-entity evidence button).
- **Frontend** (`src/kernel/bindings/marquee/otp33.tsx`): Master File — three
  OECD blocks: A. organisational structure (entity master from the rollup),
  B. intangibles & DEMPE (reference `intangibles`/`dempe`, mirroring otp29),
  C. financial & tax position (reference `cbcr`, mirroring otp34).
- **Frontend types/client** (`src/shared/api/types.ts`, `src/shared/api/client.ts`):
  added `DocCoveredRow` / `DocEntity` / `DocumentationRollup` and the
  `api.documentation()` method.
- **Frontend wiring** (`src/kernel/bindings/index.ts`): registered `OTP-37`,
  `OTP-32`, `OTP-33`; preserved every existing entry.

## Data decision
- **Tested party is the grain.** Each covered transaction is rolled up under its
  `tested_rbukrs`, because documentation (§6662 / Local File) is prepared from
  the tested party's perspective. CUP/qualitative transactions (e.g. royalties)
  carry no in/out-of-range status, so they show `na` ("CUP / qual."), not a
  pass/fail chip.
- **Evidence ref = `doc:<rbukrs>`.** This reuses the existing
  `evidence._resolve_entity` `prefix:entity` branch, so the §6662 packet resolves
  to the tested entity's audit history + ACDOCA postings + chain with **no new
  evidence plumbing** — exactly the "reuse existing evidence/reference endpoints"
  constraint. (A per-`ctx_id` ref would not resolve to an entity for postings.)
- **Unmapped flows excluded.** Only covered transactions belong in a filing, so
  `status == 'unmapped'` rows from `matrix()` are dropped from the rollup.

## Files
- `backend/routers/documentation.py` (new)
- `backend/tests/test_documentation.py` (new)
- `backend/main.py` (import + register)
- `src/kernel/data/DocEvidenceDrawer.tsx` (new)
- `src/kernel/bindings/marquee/otp37.tsx` (new)
- `src/kernel/bindings/marquee/otp32.tsx` (new)
- `src/kernel/bindings/marquee/otp33.tsx` (new)
- `src/shared/api/types.ts` (doc rollup types)
- `src/shared/api/client.ts` (api.documentation)
- `src/kernel/bindings/index.ts` (register OTP-37/32/33)

## Verification
- `cd backend && ../.venv/bin/python -m pytest -q` → **136 passed**.
- `npm run typecheck` → clean.
- `npm run build` → built OK.
