# Increment 12 — Policy waiver & stewardship governance (OTP-28, OTP-15)

## Goal
Wire two governance processes. **OTP-28** (TP policy exception/waiver tracking)
reuses the shared Case Workspace. **OTP-15** (stewardship cost identification &
exclusion) adds a parent-cost-base review with a shareholder/stewardship
classify-and-exclude grid. Both are governance records with **no warehouse
source**, so the case register and the stewardship candidate-cost register are
**FABRICATED** — but the OTP-15 cost base itself is **REAL** (derived from
`segment_pl`), and every fabricated figure is internally consistent and flagged.

## What I built

### OTP-28 — Policy waivers (Case Workspace reuse)
- **Registered** `'OTP-28': caseWorkspace` in `src/kernel/bindings/index.ts`
  (one binding serving another id) and added `'OTP-28': 'Policy waivers'` to the
  `HEADER` map in `caseWorkspace.tsx`. All existing entries preserved.
- **3 new cases** in `backend/seeds/cases/cases.v1.json` (`CASE-10..12`),
  `process_id 'OTP-28'`, `kind 'policy_waiver'`, each with status/owner/
  jurisdiction/exposure/`due_at` (the waiver expiry) and the required checklist
  `[request, impact assessment, approval, expiry review]`. All 9 existing cases
  kept; ids unique. No code change to `cases.py` / `/api/cases` — the seed loads
  through the existing `seed_if_empty()` path.

### OTP-15 — Stewardship cost identification & exclusion
- **Seed** `backend/seeds/finance/stewardship.v1.json` — 6 candidate parent
  (1000/3100) cost lines (board & governance, investor relations, group audit,
  parent legal, M&A advisory, group strategy) with amounts + an OECD-TPG 7.10
  rationale per line. Registered as `stewardship` in `state/seeds.py` so it is
  served by the existing reference router (`/api/reference/stewardship`).
- **Backend `GET /api/stewardship`** (`backend/routers/stewardship.py`, registered
  in `backend/main.py`), mirroring `routers/csa.py`:
  - **REAL cost base**: Σ parent `opex_ga` from `segment_pl` for `1000` + `3100`,
    the same source behind `/api/segments/pl` and `/api/csa` — reconciliation by
    construction.
  - **FABRICATED lines**: read from the seed; those flagged `stewardship` are
    shareholder costs **excluded** from the chargeable base.
  - **Computes**: `excluded` = Σ flagged-line amounts; `adjusted_cost_base =
    cost_base − excluded`; `candidate_total` = Σ all lines. Graceful zero base
    for a year with no `segment_pl` data.
- **Frontend type + client**: `StewardshipModel` + `StewardshipLine` in
  `src/shared/api/types.ts`; `api.stewardship()` in `src/shared/api/client.ts`.
- **OTP-15 binding** `src/kernel/bindings/marquee/otp15.tsx` (grid mirrors
  `otp21.tsx`): a register grid of candidate lines with a per-row
  shareholder/stewardship **classify-and-exclude `Switch`**, an excluded-total
  row, and the adjusted-cost-base row. The toggle is **local state** (seeded from
  the server default classification) — the excluded total + adjusted base
  recompute client-side as the user classifies. KPI strip shows parent cost base
  (provenance `segment_pl · opex_ga`), stewardship excluded, and adjusted base.
  - *Why local, not the overrides store*: the policy-overrides router is keyed by
    `flow_id` with a policy-target shape (`tpMethod`/`reviewer`/…); a per-cost-line
    exclude flag does not fit it cleanly, and the spec permits local when the
    store is not a straightforward fit.
- **Registered** `'OTP-15': otp15` in `src/kernel/bindings/index.ts`. All
  existing entries preserved.

### Tests
- `backend/tests/test_stewardship.py` (6 cases, TestClient mirror of
  `test_csa.py`): parents/lines present; **per-parent cost base reconciles
  byte-for-byte with `/api/segments/pl` opex_ga**; excluded = Σ flagged lines;
  candidate_total = Σ all lines; the `adjusted = base − excluded` identity; and a
  graceful empty-year case.
- `backend/tests/test_reference.py`: added `test_stewardship_register_loads`
  (seed served, parent-keyed, has ≥1 shareholder line).

## DATA DECISION (flag for user)
- **OTP-28 waiver cases are FABRICATED governance records** (no waiver register in
  the warehouse). Magnitudes (exposure = the at-risk adjustment if the waiver is
  later disallowed): Brazil resale-markup waiver **$620k** (markup 4.0% vs 8–12%
  band, expires 31 Dec 2026); IC-loan spread waiver **$410k** (+350bps over the
  BM-FIN ceiling, expires 30 Sep 2026); Irish services-markup waiver **$280k**
  (3% vs 5% policy, expires 30 Jun 2026). **These cases only appear after a demo
  reset** (the cases seed loads into an empty table) — expected; **no reset run.**
- **OTP-15 cost base is REAL; the candidate-cost register is FABRICATED.**
  - Parent G&A cost base (REAL, FY2026 from `segment_pl` opex_ga): **$21,175,336**
    = US IP Principal `1000` **$10,982,428** + Switzerland IP Principal `3100`
    **$10,192,908**.
  - Fabricated candidate lines total **$8,260,000**. Default classification
    excludes 5 of 6 lines as shareholder/stewardship costs ⇒ **excluded =
    $6,950,000**: board & governance $1,850k, investor relations $1,420k, group
    audit $1,160k, parent legal $980k, M&A advisory $1,540k. The 6th line —
    group strategic management $1,310k — is **left in the base by default** (a
    mixed activity that may pass the benefit test); the user can toggle it.
  - **Adjusted (chargeable) cost base = $14,225,336** at the default
    classification (≈ 33% of the parent G&A base excluded — defensible for IP
    principals whose G&A carries genuine shareholder activity). All amounts sit
    *inside* the real opex_ga base, so the exclusion is a true reduction, not an
    invented overlay. Easy to re-tune in the one seed file.

## Files
- `backend/seeds/finance/stewardship.v1.json` (new fabricated register)
- `backend/seeds/cases/cases.v1.json` (3 new OTP-28 `policy_waiver` cases; existing kept)
- `backend/state/seeds.py` (register `stewardship`)
- `backend/routers/stewardship.py` (new `GET /api/stewardship`)
- `backend/main.py` (router import + include)
- `backend/tests/test_stewardship.py` (new), `backend/tests/test_reference.py` (1 added test)
- `src/shared/api/types.ts` (`StewardshipModel` + `StewardshipLine`)
- `src/shared/api/client.ts` (`api.stewardship`)
- `src/kernel/bindings/marquee/otp15.tsx` (new binding)
- `src/kernel/bindings/marquee/caseWorkspace.tsx` (`OTP-28` HEADER entry)
- `src/kernel/bindings/index.ts` (`OTP-28 → caseWorkspace`, `OTP-15 → otp15`)

## Verification
- `cd backend && ../.venv/bin/python -m pytest -q` — full suite green (175 passed).
- `npm run typecheck && npm run build` — both green.
