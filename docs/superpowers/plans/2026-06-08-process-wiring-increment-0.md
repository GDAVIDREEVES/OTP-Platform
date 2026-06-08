# Process Library — Increment 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Process library distinguish **Live** (wired) from **Reference** (informative) processes, reframe the informative Overview so it doesn't read as broken, and wire **OTP-23** by reusing the OTP-21 segmented-financials grid.

**Architecture:** Three frontend-only, additive changes. Wired-ness is read from the existing `isMarquee()` single source of truth (no backend, no new data). OTP-23 aliases the existing `otp21` binding exactly as OTP-22 already does.

**Tech Stack:** React 18 + MUI 5 + Vite. **No frontend unit-test runner exists** (scripts: `dev`/`build`/`lint`/`typecheck`/`preview`), so the verification gate is `npm run typecheck && npm run build` plus a manual check in the running app — matching the dashboard increment. The dev stack is already running with Vite HMR, so frontend edits hot-reload live at `http://localhost:5173`.

**Spec:** `docs/superpowers/specs/2026-06-08-process-wiring-increment-0-design.md`

**Branch:** `process-wiring-increment-0` (already created off `demo-readiness`). All commands from repo root.

---

## File structure

- **Modify:** `src/kernel/bindings/index.ts` — register OTP-23 (1 line).
- **Modify:** `src/kernel/navigation/ProcessLibraryPage.tsx` — `isMarquee` import + Live/Reference chip in `ProcessCard`.
- **Modify:** `src/kernel/bindings/informative.tsx` — reword the Overview `Alert`.

No files created; no tests added (no runner — see above).

---

## Task 1: Wire OTP-23 → reuse the `otp21` binding

**Files:** Modify `src/kernel/bindings/index.ts`

- [ ] **Step 1: Register OTP-23 in the `MARQUEE` map.** The `otp21` import already exists at the top of the file. Add the OTP-23 entry next to OTP-21/OTP-22:

```ts
  'OTP-21': otp21, // segmented financials — throughout FY
  'OTP-22': otp21, // segmented financials — FYE (same grid)
  'OTP-23': otp21, // segmented financials — statutory YE (same grid)
```

(Insert the `'OTP-23': otp21,` line immediately after the existing `'OTP-22': otp21,` line. Do not change any other entry.)

- [ ] **Step 2: Verify the build is green.**

Run: `npm run typecheck && npm run build`
Expected: both PASS (no type or build errors).

- [ ] **Step 3: Manual check in the running app.** Open `http://localhost:5173/process/OTP-23/overview`.
Expected: OTP-23 renders the **segmented-financials KPI strip** (Segmented revenue / Operating profit / Blended margin / Tested parties) and the **grid** (Entity, Revenue, COGS, Opex, IC charges, Operating profit, Margin, drill icon) — identical to OTP-21/OTP-22, not the informative fallback.

- [ ] **Step 4: Commit.**

```bash
git add src/kernel/bindings/index.ts
git commit -m "feat(process): wire OTP-23 to the segmented-financials grid (reuse otp21)"
```

---

## Task 2: Live / Reference badge on `ProcessCard`

**Files:** Modify `src/kernel/navigation/ProcessLibraryPage.tsx`

- [ ] **Step 1: Import `isMarquee`.** Add this import alongside the existing relative imports (near the `useProcesses` / `CategoryRail` imports):

```tsx
import { isMarquee } from '../bindings';
```

- [ ] **Step 2: Add the status chip to the `ProcessCard` header `Stack`.** The current header is:

```tsx
      <Stack direction="row" alignItems="center" spacing={1}>
        <Chip label={def.id} size="small" sx={{ fontWeight: 700, bgcolor: '#0F172A', color: 'white' }} />
        {def.top15 && (
          <StarIcon sx={{ fontSize: 16, color: '#D97706' }} role="img" aria-label="Top 15 pharmaceutical risk" />
        )}
        {def.pharmaApplicability === 'M' && <Chip label="Med" size="small" variant="outlined" />}
      </Stack>
```

Replace it with (adds a right-aligned Live/Reference chip — exactly one always renders, pushed to the right edge via `ml: 'auto'`):

```tsx
      <Stack direction="row" alignItems="center" spacing={1}>
        <Chip label={def.id} size="small" sx={{ fontWeight: 700, bgcolor: '#0F172A', color: 'white' }} />
        {def.top15 && (
          <StarIcon sx={{ fontSize: 16, color: '#D97706' }} role="img" aria-label="Top 15 pharmaceutical risk" />
        )}
        {def.pharmaApplicability === 'M' && <Chip label="Med" size="small" variant="outlined" />}
        {isMarquee(def.id) ? (
          <Chip label="Live" size="small" color="success" sx={{ ml: 'auto', height: 20, fontWeight: 700 }} />
        ) : (
          <Chip
            label="Reference"
            size="small"
            variant="outlined"
            sx={{ ml: 'auto', height: 20, color: 'text.secondary', borderColor: 'divider' }}
          />
        )}
      </Stack>
```

- [ ] **Step 3: Verify the build is green.**

Run: `npm run typecheck && npm run build`
Expected: both PASS.

- [ ] **Step 4: Manual check.** Open `http://localhost:5173/process`.
Expected: every card shows a chip on the right of its header — **green "Live"** on wired processes (OTP-3, 9, 16, 17, 20, 21, 22, **23**, 25, 29, 35, 45, 48) and **muted outlined "Reference"** on all others. OTP-23 in particular now reads **Live**.

- [ ] **Step 5: Commit.**

```bash
git add src/kernel/navigation/ProcessLibraryPage.tsx
git commit -m "feat(process): Live/Reference badge on library cards (from isMarquee)"
```

---

## Task 3: Reference-view reword in the informative binding

**Files:** Modify `src/kernel/bindings/informative.tsx`

- [ ] **Step 1: Replace the Overview `Alert` copy.** Current:

```tsx
      <Alert severity="info" variant="outlined">
        This process is part of the full 50-process library. Its guided workflow and
        live data aren&rsquo;t wired for this demo yet — the marquee close-cycle
        processes are. The shell, audit affordances, and navigation are identical.
      </Alert>
```

Replace with (confident reference framing; keeps the shell/audit/navigation reassurance):

```tsx
      <Alert severity="info" variant="outlined">
        <b>Reference view.</b> This catalog entry documents the process&rsquo;s scope,
        OECD anchor, owner, and cadence. The live, guided workflow runs on the marquee
        close-cycle processes — the shell, audit affordances, and navigation are identical.
      </Alert>
```

- [ ] **Step 2: Verify the build is green.**

Run: `npm run typecheck && npm run build`
Expected: both PASS.

- [ ] **Step 3: Manual check.** Open `http://localhost:5173/process/OTP-1/overview` (a Reference process).
Expected: the Overview leads with **"Reference view."** and the new copy — no "isn't wired … yet" / broken-sounding language. The fields table (Process, Category, Primary pattern, OECD anchor, Owner function, Cadence, Pharma applicability) is unchanged below it.

- [ ] **Step 4: Commit.**

```bash
git add src/kernel/bindings/informative.tsx
git commit -m "feat(process): reframe informative Overview as a Reference view"
```

---

## Self-review (completed by the plan author)

**Spec coverage:** OTP-23 reuse (Task 1) ✓; Live/Reference badge via `isMarquee` (Task 2) ✓; reference-view reword (Task 3) ✓; out-of-scope items (cross-links, backend, filtering) correctly excluded ✓; verification = typecheck + build + manual, no runner invented (Tasks 1–3) ✓.

**Placeholder scan:** none — every step shows the exact code or command.

**Type consistency:** `isMarquee(id: string): boolean` is the real signature exported from `src/kernel/bindings/index.ts`; `def.id` is a `string` (`ProcessDef.id`). `otp21` is a `ProcessBinding` already imported in `index.ts`. The `<Chip>`/`<Stack>`/`<Alert>` props used are all valid MUI 5 props already used elsewhere in these files. Import path `../bindings` resolves from `src/kernel/navigation/` to `src/kernel/bindings/index.ts`.

**Note:** Frontend HMR means each edit is visible immediately in the already-running app; `typecheck && build` is the correctness gate that HMR does not enforce.
