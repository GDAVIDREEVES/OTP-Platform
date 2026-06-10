# OTP Platform — Usage Workflow

How the solution is actually used, end to end. Three connected flows: the
**operating close cycle** (operator → reviewer → director), the **calculation
governance loop** (Calc Studio), and the **allocation run** (cost → charge).
Everything below writes to the same hash-chained audit trail; any record's
evidence packet is at `/evidence/{record_ref}`.

```
                        ┌─────────────────────────────────────────────┐
                        │                THE CLOSE CYCLE              │
                        ▼                                             │
 Master Data ─▶ Price Setting ─▶ Charge & Invoice ─▶ Monitor ─▶ Adjust ─▶ Review ─▶ Document/Comply
 (OTP-27/41)    (OTP-1..8)       (OTP-9..15)         (OTP-20)   (OTP-16)  (/review)  (OTP-32..39)
      ▲              ▲                 ▲                │                     │
      │              │                 │                └── exceptions ──▶ Inbox
      │         benchmark refresh      │
      │         flags stale prices     └── explained by the ALLOCATION ENGINE
      │         (OTP-25 → 3/6)             (Calc Studio ▸ Allocations)
      │
      └── governed drivers, scenarios, traces: CALC STUDIO (parameters → calculations → processes)
```

---

## Flow 1 — The operating close cycle (15 min)

| # | Step | Where | What happens |
|---|------|-------|--------------|
| 1 | **Start in the Inbox** | `/inbox` | Your unified worklist: drafts, reviews awaiting you, out-of-range entities, open cases — urgency-sorted. Click any row to deep-link. |
| 2 | **Master data is governed** | `/master-data` | A seeded SAP delta (new entity, GL account) arrives in *Inbound mapping*; the assistant proposes a characterization; you review and submit; a **different role** approves (maker ≠ checker, AI never the checker). |
| 3 | **Prices are set** | `/process/OTP-3` (royalty), OTP-1/2 (goods), OTP-4 (services), OTP-5 (CSA), OTP-6/7/8 (financing) | Guided wizards: assistant prepares from the warehouse + benchmark bands → you review → gated submit → review queue. Provenance chips link each rate to its OTP-25 benchmark study. |
| 4 | **Charges are billed** | OTP-9 (royalty batch), OTP-10 (service batch), OTP-11 (CSA true-up), OTP-13/14 (treasury) | Generate → stage → post batches. OTP-10's $14.34M service charges are **produced by the allocation engine** (Flow 3). |
| 5 | **Margins are monitored** | `/process/OTP-20` | Exceptions-first worklist vs arm's-length bands; drill any margin to its ACDOCA postings. Click **Adjust** on a flagged entity. |
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
| 6 | **See the model map** | `/calc-studio/lineage` | The dependency DAG: data sources → parameters → calculations → processes, colored by provenance (real / assumed / fabricated). Click through to evidence, calcs, or processes. |
| 7 | **Check data honesty** | `/calc-studio/provenance` | Every fabricated magnitude in the demo, listed and linked — nothing is buried. |

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
