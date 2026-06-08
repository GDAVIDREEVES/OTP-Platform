# Process Library — Increment 0 (warm-up): wiring signal + OTP-23

> **Part of the Top-15 risk-coverage build.** The goal of that effort is to wire the
> 7 remaining ★ top-15 processes (OTP-5, 11, 23, 30, 31, 40, 50). This is
> **Increment 0** — a low-risk warm-up that (a) makes the library *read* as
> mostly-wired and (b) lands the cheapest of the 7 targets (OTP-23) by reuse.
> Increment 1 (a shared **Case Workspace** → OTP-30/31/40/50) and Increment 2
> (the **CSA pair** OTP-5/11, which needs new data) each get their own spec.

## Goal

Make the Process library honestly and clearly distinguish **live** (wired) processes
from **reference** (informative) ones, soften the "not wired" framing so reference
entries don't read as broken, and wire **OTP-23** by reusing the existing
segmented-financials grid.

## Context / current state

- 50 processes, served by `GET /api/processes`. **12 are "marquee"** (rich bindings
  registered in `MARQUEE`, `src/kernel/bindings/index.ts`); the other **38** fall
  back to `informativeBinding()` (Overview + Docs only).
- **`isMarquee(id: string)`** already reports wired-ness — frontend-only, the single
  source of truth the module shell already uses. No backend change is required.
- `ProcessLibraryPage` renders every process as a `ProcessCard`. The card currently
  gives **no signal** of wired vs. reference — you have to click in to discover it.
- The `otp21` binding (segmented-P&L KPI strip + grid) is fully data-driven by
  period, with no FY-specific labels. **OTP-22 already aliases it.** OTP-23
  ("statutory YE") is the same grid under a different framing.

## Scope — three changes (frontend-only, additive)

### 1. Wire OTP-23 → reuse `otp21`
- In `src/kernel/bindings/index.ts`, add `'OTP-23': otp21,` to the `MARQUEE` map
  (the `otp21` import is already present).
- Effect: OTP-23 gains the segmented-financials KPI strip + grid; category D goes
  4/6 → 5/6; `isMarquee('OTP-23')` becomes `true`, so it automatically earns the
  "Live" badge from change 2.

### 2. "Live / Reference" badge on `ProcessCard`
- In `ProcessLibraryPage.tsx`, import `isMarquee` from `../bindings`.
- In the `ProcessCard` header `Stack` (beside the id chip and the top-15 star),
  render a status chip:
  - **wired** (`isMarquee(def.id)`): label **"Live"**, `size="small"`,
    `color="success"`, filled — invites a click.
  - **not wired**: label **"Reference"**, `size="small"`, `variant="outlined"`,
    muted (`text.secondary`) — reads as catalog/standards, not broken.
- Keep it compact (height ~20) so it doesn't crowd the card. Chip text is
  self-describing; no extra ARIA needed.

### 3. Reference-view reword in `informative.tsx`
- Replace the Overview `Alert` copy. Current copy leads with *"…isn't wired for this
  demo yet"*, which reads as broken.
- New copy (confident, reference-framed): **"Reference view."** This catalog entry
  documents the process's scope, OECD anchor, owner, and cadence. The live, guided
  workflow runs on the marquee close-cycle processes.
- Severity stays `info`, `variant="outlined"`. The fields table and Docs tab are
  unchanged.

## Out of scope (deferred, not in this increment)

- Related-process cross-links (e.g., OTP-23 ↔ the OTP-21/22 family). Good later add.
- Any backend change, new endpoint, or new data.
- Filtering/sorting the library by Live vs. Reference (possible later nicety).

## Architecture notes

- All three changes are frontend-only and additive — no API or type changes.
- Wired-ness has a **single source of truth** (`isMarquee`), already consumed by the
  module shell. The badge reuses it, so the library and the shell can never disagree
  about what's live.

## Verification

- `npm run typecheck && npm run build` — both pass (the frontend gate; there is no
  frontend unit-test runner, matching the dashboard increment).
- Manual in the running app at `/process`:
  - Every card shows a **Live** or **Reference** chip.
  - OTP-20/21/22/25 (and friends) read **Live**; **OTP-23 now reads Live** and opens
    to the segmented-financials grid.
  - A reference process (e.g. OTP-1) opens to the reworded **"Reference view"**
    Overview — no "not wired/broken" language.

## Files touched

| File | Change |
|---|---|
| `src/kernel/bindings/index.ts` | +1 line (`'OTP-23': otp21`) |
| `src/kernel/navigation/ProcessLibraryPage.tsx` | `isMarquee` import + Live/Reference chip in `ProcessCard` |
| `src/kernel/bindings/informative.tsx` | reword the Overview `Alert` copy |
