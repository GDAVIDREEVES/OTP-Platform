# OTP Platform — Usage Workflow

How the solution is actually used, end to end. Four connected flows: the
**operating close cycle** (operator → reviewer → director), the **calculation
governance loop** (Calc Studio, including the Calculation Builder), the
**allocation run** (cost → charge), and the **TP waterfall** (charges applied
to entity P&L *before* TP decisions). Everything below writes to the same
hash-chained audit trail; any record's evidence packet is at
`/evidence/{record_ref}`.

```
                        ┌─────────────────────────────────────────────┐
                        │                THE CLOSE CYCLE              │
                        ▼                                             │
 Master Data ─▶ Price Setting ─▶ Charge & Invoice ─▶ Monitor ─▶ Adjust ─▶ Review ─▶ Document/Comply
 (OTP-27/41)    (OTP-1..8)       (OTP-9..15)         (OTP-20)   (OTP-16)  (/review)  (OTP-32..39)
      ▲              ▲                 ▲                │                     │
      │              │                 │                └── exceptions ──▶ Inbox
      │         benchmark refresh      │
      │         flags stale prices     ├── explained by the ALLOCATION ENGINE
      │         (OTP-25 → 3/6)         │    (Calc Studio ▸ Allocations)
      │                                │
      │                                └── applied to entity P&L by the TP WATERFALL
      │                                     (Calc Studio ▸ Waterfall — BEFORE Monitor/Adjust)
      │
      └── governed drivers, scenarios, traces, user-authored calcs:
          CALC STUDIO (parameters → calculations → processes)
```

---

## Flow 1 — The operating close cycle (15 min)

| # | Step | Where | What happens |
|---|------|-------|--------------|
| 1 | **Start in the Inbox** | `/inbox` | Your unified worklist: drafts, reviews awaiting you, out-of-range entities, open cases — urgency-sorted. Click any row to deep-link. |
| 2 | **Master data is governed** | `/master-data` | A seeded SAP delta (new entity, GL account) arrives in *Inbound mapping*; the assistant proposes a characterization; you review and submit; a **different role** approves (maker ≠ checker, AI never the checker). |
| 3 | **Prices are set** | `/process/OTP-3` (royalty), OTP-1/2 (goods), OTP-4 (services), OTP-5 (CSA), OTP-6/7/8 (financing) | Guided wizards: assistant prepares from the warehouse + benchmark bands → you review → gated submit → review queue. Provenance chips link each rate to its OTP-25 benchmark study. |
| 4 | **Charges are billed** | OTP-9 (royalty batch), OTP-10 (service batch), OTP-11 (CSA true-up), OTP-13/14 (treasury) | Generate → stage → post batches. OTP-10's $14.34M service charges are **produced by the allocation engine** (Flow 3). |
| 5 | **Margins are monitored** | `/process/OTP-20` | Exceptions-first worklist vs arm's-length bands; drill any margin to its ACDOCA postings. With the Flow 4 waterfall applied + `pl.use_post_charge` on, these are **post-charge** margins. Click **Adjust** on a flagged entity. |
| 6 | **Adjustments close the loop** | `/process/OTP-16` | Pre-filled with the gap-to-range; assistant prepares, you quantify, gated submit. After approval, OTP-20 shows the entity under **"Resolved this period"** — the loop closes. |
| 7 | **Review everything** | `/review` | Switch role (top-right avatar) to approve. Rejections appear in the maker's **"Returned to you"** lane with a fix-and-resubmit deep link. |
| 8 | **Document & defend** | OTP-32/33/37 (Local File, Master File, §6662), OTP-34 (CbCR), OTP-39/40/50 (APA/audit/MAP cases) | Documentation rolls up per entity; controversy cases link to their supporting doc packs; every case carries a checklist + audit trail. |
| 9 | **Prove any number** | `/evidence/{ref}` | Event history, before/after diffs, linked postings, the **process-lineage timeline** ("set by OTP-5 → flagged OTP-20 → adjusted OTP-16 → approved"), chain verification. |

## Flow 2 — Calculation governance (Calc Studio, 10 min)

| # | Step | Where | What happens |
|---|------|-------|--------------|
| 1 | **Browse the registry** | `/calc-studio/calculations` | Every computed result (CSA, BEAT, WHT, profit split, forecast…) is a managed calculation: definition, pseudo-formula, inputs with provenance, owner, version. |
| 2 | **Run & trace** | "Run now" in the detail drawer | Executes the real calculation; the run lands in the **Runs** job console and the audit trail; the **trace** walks every step (e.g. CSA: aggregate → projected sales → pool → RAB shares → true-ups) with the parameters used. |
| 3 | **Manage drivers** | `/calc-studio/drivers` | The 12+ governed parameters (growth rates, thresholds, mappings). Edit one → downstream calcs change instantly → the edit is audited at `param:{key}` with before/after. |
| 4 | **What-if safely** | `/calc-studio/scenarios` | Create a scenario (e.g. CSA growth 8% → 10%), **Compare** → Base \| Scenario \| Δ side-by-side. Governed values are never touched. |
| 5 | **Promote with control** | Scenario → Promote | Routes to the review queue; a *different* reviewer approves; only then are the parameters applied — each individually audited. Discard throws the sandbox away. |
| 6 | **Author your own calculation** | `/calc-studio/calculations` → **New calculation** | The Calculation Builder: name/grain/process binding, then build the formula from **term pickers** — governed parameters, warehouse measures (`segment_pl.*` with grain + filters), composable system calcs — inserted into a syntax-checked **formula bar** (live validation on every keystroke; Decimal math, no eval). |
| 7 | **Preview before saving** | Builder → **Preview** | Evaluates the expression server-side without persisting anything ("Show"): result at its grain plus the full trace — every `param`/`measure`/`calc` term with the value it resolved to. |
| 8 | **Activate with control** | Save draft → **Test run** → **Submit for activation** | The test run is the gate (an untested formula can never be submitted); submission queues a `ucalc:{id}` item in `/review`; a **different** reviewer approves; only then is the calculation **active** in the registry (kind *user-defined*) — runnable, traceable, scenario-capable like any system calc. Editing an active calc bumps the version and starts the cycle again. |
| 9 | **See the model map** | `/calc-studio/lineage` | The dependency DAG: data sources → parameters → calculations → processes, colored by provenance (real / assumed / fabricated). Click through to evidence, calcs, or processes. |
| 10 | **Check data honesty** | `/calc-studio/provenance` | Every fabricated magnitude in the demo, listed and linked — nothing is buried. |

## Flow 3 — An allocation run (cost → charge, 10 min)

The allocation engine implements the full OECD Ch. VII / §1.482-9 pipeline
(`docs/allocation/SPEC.md`). Demo billing periods: **2026-04, 2026-05, 2026-10, 2026-11**.

| # | Step | Where | What happens |
|---|------|-------|--------------|
| 1 | **Review the setup** | `/calc-studio/allocations` ▸ *Pools & policies* | Service pools (IT-US, Regional Shared Services-CH, Management), allocation keys, jurisdiction-benchmarked markup policies, and the stewardship **exclusions sourced from the OTP-15 register** ($4.25M + $2.70M). |
| 2 | **Launch a run** | ▸ *Run console* → "Run actual" for a billing period | The orchestrator snapshots + hashes inputs, executes stages 1–7, persists atomically. Same inputs → identical hash (determinism is test-enforced). |
| 3 | **Check the tie-out** | ▸ *Recon* | Per pool/provider/period: pooled cost = exclusions + recovered + **zero residual** (hard gate V-X1). FY across the 4 periods: **$13,586,402.70 cost / $14,344,773.26 gross — to the cent against the warehouse**. |
| 4 | **Inspect exceptions** | ▸ *Exceptions* | The V-rule report (BLOCK red / WARN amber) — missing policy, key gaps, stewardship checks. By design there are **no silent defaults**: a missing markup policy blocks, never guesses. |
| 5 | **Drill a charge** | ▸ *Charges* → any row | Charge → allocation ratio → key values → the constituent GL cost lines. Full lineage, reconstructable. |
| 6 | **Take the doc pack** | ▸ *Doc packs* | Generated Markdown per pool/period: cost composition, exclusions + rationale, key + ratios, markup basis, charges, recon tie-out — the local-file support artifact, produced *by the run*. |
| 7 | **True-up at year end** | ▸ *Run console* → "Run true-up" | Recomputes the year on actuals, books deltas vs in-year budget charges as linked True-up rows; large deltas fire the V-X3 KPI warning. |

### Flow 3b — Author your own pool (Pool Builder, build → preview → test → activate → run, 8 min)

The seeded pools above are governed and read-only. The **Pool Builder** lets you
author a *new* cost pool from scratch — selecting cost centers / profit centers /
GL accounts — and run it through the **same** Stages 1-7. Authored pools are
governed **experiments**: flagged `authored`, balanced to zero residual on their
own, and they **never** touch the cent-exact governed tie-out (Flow 3 step 3).

| # | Step | Where | What happens |
|---|------|-------|--------------|
| 1 | **Build a pool** | `/calc-studio/allocations` ▸ *Build pool* | Name + provider + service line + characterization + cost base, then a **cost-capture rule**: multiselect cost centers / profit centers / GL accounts (the pickers list every dimension value with its cost, from the richer fabricated cost-center layer). Add a beneficiary population, an allocation key (Equal / Revenue / Cost), exclusions and per-jurisdiction markup policies. |
| 2 | **Preview the captured cost** | (live card on the form) | The capture rule is evaluated over the cost lines — "captures **$X** across **N** cost lines → these entities" — to the cent, before anything is saved. |
| 3 | **Test (dry-run)** | ▸ **Test run** | The pool runs through Stages 1-7 **in isolation** (no persist): charges, recon (zero residual), V-rule exceptions and a trace tree render inline. A sound pool is marked **tested**; a missing markup or empty rule **blocks** (V-M1 / V-P1 — never a silent default). |
| 4 | **Save draft → Submit for activation** | ▸ **Save draft**, then **Submit** | A definition edit re-arms the test gate. Submitting enqueues a maker-checker item at `allocpool:{id}` in the `/review` queue. |
| 5 | **Approve as a different actor** | `/review` | A **different** reviewer approves the item (a maker can't approve their own work). On approval the pool flips to **active** — every mutation is audited at `allocpool:{id}`. |
| 6 | **Run the authored allocation** | ▸ *Build pool* → **Run authored allocation** | Active authored pools overlay the engine and run for a period, **flagged `authored`**: charges + recon (Balanced) + a per-pool **doc pack** (the same SPEC §8.3 memo the governed run produces), persisted under `allocation:{run_id}`. |

The richer (fabricated) cost-center layer and the authored-pool store both show
up on **Calc Studio ▸ Provenance** (`allocation_cost_lines` / `allocation_cc_mapping`
as *fabricated*; `authored_pools` as a *real* governed store whose rows carry the
`authored` flag).

## Flow 4 — The TP waterfall (charges before decisions, 10 min)

Close-flow correctness: intercompany charges are computed and **applied to each
entity's P&L *before* the TP decisions read it** — monitoring (OTP-20),
adjustments (OTP-16) and goods pricing (OTP-1) should judge *post-charge*
margins, not pre-charge ones. The waterfall is an append-only double-entry
overlay on the warehouse P&L: provider revenue +, recipient cost +, **group net
always zero** (test-enforced). Nothing anywhere changes until a run is applied
*and* the governed toggle is on.

| # | Step | Where | What happens |
|---|------|-------|--------------|
| 1 | **Run the waterfall** | `/calc-studio/waterfall` → **Run waterfall** | The ordered charge sequence executes: **service allocation** (the Flow 3 engine, $14.34M) → **royalties** (OTP-44 register) → **CSA true-up** (OTP-11) → **profit split** (OTP-12/44). Each step maps its source ledger/batch to overlay lines that tie out **to the cent**; the run, its steps and per-entity impact land in the console. |
| 2 | **See the applied charges** | `/pnl` (Segmented P&L, entity view) | The grid gains **Base \| IC charges (net) \| Post-charge** columns from `/api/pl/adjusted` — per-entity overlay with by-kind provenance and source refs; a chip links back to the sequence console. |
| 3 | **Flip the basis** | `/calc-studio/drivers` → `pl.use_post_charge` | The governed toggle (audited at `param:pl.use_post_charge`). When on, the margin-bearing reads behind OTP-20 / OTP-16 / OTP-1 (`/api/margins/trend`, `/api/kpis`, `/api/forecast`) resolve to post-charge margins; any request can still pin `?pl=base\|post_charge` explicitly. |
| 4 | **Decide on post-charge numbers** | `/process/OTP-20` → OTP-16 → OTP-1/2 | Monitoring worklists, gap-to-range adjustments and price recommendations now reflect the entity P&L *after* intercompany charges — the correct sequence for a TP close. Responses carry `plBasis` + the waterfall run id as provenance. |
| 5 | **Rollback if needed** | `/calc-studio/waterfall` → **Rollback** | One *reversing* row per applied line — the ledger is append-only, never edited. With no applied run (or the toggle off) every endpoint returns its byte-identical baseline (golden-gated in `tests/test_post_charge.py` / `test_waterfall.py`). |

---

## Roles & control model

- **Operator** prepares and submits (wizards, batches, scenarios). The AI
  assistant *prepares*; it never approves.
- **Reviewer** approves/returns in `/review` — segregation of duties is
  engine-enforced (maker ≠ checker).
- **Director** consumes `/director` exposure views and evidence packets.
- Switch roles via the top-right avatar.

## Reset

```bash
cd backend && ../.venv/bin/python -m state.migrate --reset   # pristine state, all seeds reloaded
```
