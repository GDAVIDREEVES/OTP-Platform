# OTP Process-Wiring Roadmap — the remaining library

> Where we are: **19 of 50 processes wired** (12 original marquee + OTP-23, the Case
> Workspace four OTP-30/31/40/50, and the CSA pair OTP-5/11). **31 remain** on the
> informative "Reference" fallback. This roadmap sequences wiring the rest, using the
> same brainstorm → spec → plan → TDD rhythm and the one-line `MARQUEE` registration
> (`src/kernel/bindings/index.ts`); one binding can serve several processes (as
> `otp21`→21/22/23, `caseWorkspace`→30/31/40/50, `otp16`→16/17 already do).
>
> Derived from a parallel per-category assessment of all 31 (pattern · data-readiness ·
> reuse) synthesized into leverage-clustered increments.

## Sequencing principle
**(demo value × data-readiness).** Three tranches:
- **Tranche 1 — data-ready (ship first, zero fabrication).** Increments 1–3.
- **Tranche 2 — "partial" (one new endpoint/derivation each, over *real* warehouse data).** Increments 4–9.
- **Tranche 3 — new-data-needed (gated on a data decision, like the CSA pool).** Increments 10–12.

## The increments (build order)

| # | Increment | Processes | Pattern | Data | Effort | Value |
|---|-----------|-----------|---------|------|--------|-------|
| 1 | Compliance reads on seeded data (CbCR + APA) | OTP-34, OTP-39 | calc + case | ✅ available | S | **H** |
| 2 | Service charge batch | OTP-10 | guided wizard | ✅ available | S | **H** |
| 3 | Governed ERP → master-data loop | OTP-27, OTP-41 | guided wizard | ✅ available | M | **H** |
| 4 | Goods & services price-setting wizards | OTP-4, OTP-1, OTP-2 | guided wizard | ◑ partial | M | **H** |
| 5 | Latest-Estimate forecast workpaper | OTP-24 | workpaper grid | ◑ partial | M | **H** |
| 6 | ERP↔TP reconciliation + billing control | OTP-43, OTP-42 | monitoring | ◑ partial | M | **H** |
| 7 | US documentation & return-input workpapers | OTP-37, OTP-32, OTP-33 | workpaper grid | ◑ partial | M | **H** |
| 8 | Profit-split engine (design + invoicing) | OTP-44, OTP-12 | calc | ◑ partial | M | M |
| 9 | Withholding tax on IC payments | OTP-46 | calc | ◑ partial | M | **H** |
| 10 | Treasury suite (loan/cash-pool rates, accrual, settlement) | OTP-6, OTP-13, OTP-14 | guided wizard | ✦ new data | M | M |
| 11 | BEAT base-erosion prep | OTP-36, OTP-38 | calc | ✦ new data | L | M |
| 12 | Policy waiver & stewardship governance | OTP-28, OTP-15 | case + grid | ✦ new data | M | M |

### Tranche 1 detail (recommended first — ~1 week of marquee demos, no fabrication)
- **Inc 1 · OTP-34 CbCR + OTP-39 APA.** `cbcr.v1.json` already holds the full BEPS-13 Table 1 across 8 jurisdictions → OTP-34 is a near-verbatim `otp35` clone with derived validation flags (profit-without-substance, tax paid vs accrued, low-ETR). OTP-39 registers against the turnkey `caseWorkspace`/`cases.py` as an APA-lifecycle tracker (+2–3 `kind:'apa'` seed rows; the seed already references "IRS APMA"). Highest value-per-effort in the whole set.
- **Inc 2 · OTP-10 service charge batch.** Real SERVICE flows exist (72 lines, ~$14.3M, cost-plus ~5.5%); `invoices.py` already synthesizes from `supply_chain` and keys on `MATERIAL_TYPE`. Mirror `otp9` (generate → review → post); the backend change is a filter param + a markup column.
- **Inc 3 · OTP-27 new-flow onboarding + OTP-41 ERP master-data maintenance.** The whole maker-checker staging pipeline (promote → propose → submit → approve → apply, SoD enforced, AI-never-checker) is already built and exercised by the Master Data workspace — only the process-scoped `otp16`-style wizard front-ends are missing. Shows the headline "dirty SAP delta in → governed, priced, agreement-backed master data out" loop.

## Data decisions required (Tranche 2–3 gates)
Each is a *bounded* call (a seed/weighting), not a financial fabrication — surfaced like the CSA $120M→$10.8M decision so you approve the inputs before they ship:
1. **Profit-split allocation keys** (Inc 8, OTP-44/12) — weights/DEMPE value-driver proxies (opex_rd vs SG&A vs COST_SHARE) for the residual split. *Financials are real; the weighting is a judgment input.*
2. **WHT treaty-rate matrix** (Inc 9, OTP-46) — real OECD-model/treaty rates per corridor vs. simplified illustrative; statutory fallbacks. *Withholdable base is real ($2.3M royalty + $14.3M service).*
3. **Treasury seed magnitudes** (Inc 10, OTP-6/13/14) — loan register (principal/rate/tenor/rating) + cash-pool positions for Ireland Financing 3400. *A CSA-style sizing call; no loan/pool data exists.*
4. **RACCT payment-type classification** (Inc 11, OTP-36/38) — map the 17 generic RACCT codes → royalty/service/interest for BEAT base-erosion %.
5. **Forecast/LE basis** (Inc 5, OTP-24) — derive LE from actuals run-rate/seasonality (preferred, keeps the base real) vs. a seeded forecast.
6. **Stewardship cost register** (Inc 12, OTP-15) — seed candidate parent cost lines to flag as shareholder/stewardship exclusions.

## Recommend leaving as informative **Reference** (lowest value-to-effort)
- **OTP-8** captive insurance — no insurer entity, no policy/premium/claims data; heaviest lift, low value.
- **OTP-19** VAT / indirect-tax — zero indirect-tax layer; adjacency-only to a direct-tax TP motion.
- **OTP-7** guarantee fee — narrow TPG Ch. X niche; needs a full guaranteed-debt register.
- **OTP-18** customs revaluation — needs assumed per-lane duty rates (HS code / customs value absent); pursue only if the "adjustment claws back X duty" story is wanted.

## Cross-cutting leverage (build once, reuse)
- **Planned-vs-posted AWREF reconciliation** (Inc 6) is reusable beyond OTP-42/43 — it also strengthens OTP-20 monitoring and the OTP-16/17 adjustment trail. (Verified live: 145 reconciling / 255 unposted / 27 value-breaks / 16 challenged — real data, just no endpoint computes it yet.)
- **Per-entity covered-transaction rollup** (Inc 7) is the spine of all three documentation processes and can later back **OTP-26** (ICA inventory coverage/staleness).
- **Unclustered medium-value follow-ons:** OTP-49 (TP system admin — admin console over existing audit/review primitives, append to Inc 6); OTP-26 (ICA inventory — rides Inc 7's rollup); OTP-47 (FX/hedging — needs an FX/hedge seed, join Inc 10's treasury tranche).

## Outcome if executed
Tranche 1–2 (Increments 1–9) take wired coverage from **19 → ~37 of 50** with **no fabricated financials** beyond bounded seed decisions, and every marquee TP motion (pricing, charging, monitoring, documentation, compliance, reconciliation) gets a live, reconciled story. Tranche 3 + the Reference set are optional/decision-gated.
