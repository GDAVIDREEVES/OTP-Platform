# DECISIONS — Allocation Engine (judgment calls beyond SPEC/ADAPTATION)

Per ENGINE-CLAUDE.md: when a SPEC requirement is ambiguous, prefer the more
auditable/conservative interpretation, record it here, and continue.

## M1 — Codegen, persistence, seeds generator (2026-06-10)

1. **Management pool modelled per provider (POOL-MGMT-US / POOL-MGMT-CH).**
   The build brief sketches one POOL-MGMT "split across both providers", but a
   `3_Pool` row has a single mandatory `provider_entity_id` and SPEC §3.3 /
   V-P5 mandate one provider per pool ("model multi-provider needs as separate
   pools per provider"). Conceptually it is one management pool; physically it
   is two rows. The "split across both providers via cc_mapping splits" intent
   is carried by each provider's impure corporate cost center (CC-1000-CORP /
   CC-3100-CORP) splitting 20% → the provider's service pool / 80% → its
   management pool (`allocation_split_pct`, V-P2 sums to 100%).

2. **Management pools are 100% stewardship-excluded.** ADAPTATION D2 fixes
   Stage-4 allocated cost == warehouse pair cost base AND Stage-5 gross ==
   pair gross via benchmarked rates; any *charged* management cost would break
   those contracts (it would ride at LVAIGS 5%, not the pair-effective rate).
   So the management pools' pooled cost equals their fixed exclusions exactly
   (pool that is 100% excluded — a mandatory SPEC §9.1 edge case), and
   "LVAIGS where charged" is represented by seeded LVAIGS 5% policies that
   currently never fire. The 80/20 corporate split makes the chargeable slice
   part of the *service* pools' cost base instead.

3. **Decimal/Percent serialization = exact decimal strings.** In seeds (JSON)
   and in SQLite (TEXT columns). JSON numbers parse to IEEE floats, which are
   forbidden on amounts (ENGINE-CLAUDE.md); benchmarked markup rates carry full
   precision-28 digits. The schema-level validator rejects floats outright.

4. **Percent convention: decimal fractions.** `markup_pct = "0.05"` means 5%;
   `allocation_split_pct = "0.8"` means 80%; `allocation_ratio` is the raw
   factor/total quotient. Engine math multiplies these directly — no /100.

5. **Budget variants are tagged at the seed-envelope level** (`{"actual": [...],
   "budget": [...]}` in cost_lines/key_values.v1.json), because `1_CostLine`
   and `7_KeyValue` have no budget/actual field in schema.json and entity
   shapes are never hand-extended. The orchestrator (M6) selects the dataset by
   `runType`; `10_ChargeLedger.budget_or_actual` tags the *outputs* as the
   schema already provides.

6. **Stewardship exclusions are split evenly across the provider's two billing
   periods** (largest-remainder on the cent), as period-bounded fixed-amount
   `5_Exclusions` rows (`effective_from/to` = the period month). An annual
   fixed amount applied per-period run would double-count; per-period rows
   keep Stage 3 trivially as-of-resolvable. STW-6 (flagged `stewardship:
   false` in the register) stays IN the cost base, mirroring the register's
   default — it is not part of these exclusions.

7. **`6_KeyDef.recompute_frequency` validates as free text.** Its `data_type`
   is Enum but schema.json's `enumerations` array has no entry for it; codegen
   maps it to `enum: None` rather than inventing an enumeration.

8. **`run_id` is added only to `charge_ledger`** (SPEC §3.2 names 10_ChargeLedger
   explicitly; 11_Recon already carries it in-schema). cost_lines/key_values
   stay schema-exact; if M5's received-charge cost lines need run scoping, that
   goes through codegen then.

9. **`allocation_runs` status transitions are constrained, not append-only:**
   a run row is inserted `running` and transitions exactly once to
   `succeeded`/`failed` (finished_at stamped); terminal states are immutable.
   It is a run registry, not a ledger.

10. **Budget key values equal actual key values** (same consumption mix);
    the 8%/15% cost-base divergence alone drives the true-up demo. Budget
    management cost is also unchanged so budget runs still reconcile to zero
    residual against the fixed exclusions.

11. **Provider entities book in USD** (functional_currency for 1000 AND 3100):
    the warehouse cost base the seeds tie to is group-currency USD, and the
    stewardship register is USD. Recipient functional currencies are realistic
    (EUR/GBP); FX treatment lands with Stage 6 (M4).

12. **Benchmarked rates are emitted at full precision-28** (e.g. DE
    0.0561336086…). ADAPTATION D2's "DE 5.6133%" etc. are 4-dp display
    approximations of the same quotients; the generator computes gross/cb − 1
    exactly, which is the authoritative contract.

13. **Service-line choice for the RSS pool = Finance** (the
    `function / service_line` enumeration has no "shared services" value;
    AP/AR/bookkeeping is finance work). Pure-CC functions match their pool's
    service line so V-P3 homogeneity stays clean.

14. **No `9_Participation` seed in M1.** The build brief's emit list is the
    eight files; beneficiary populations are recoverable from key_values in the
    flat demo. Stage 4 (M2/M3) resolves beneficiaries from `9_Participation`,
    so the generator will gain a participation emitter then (schema sheet and
    generated TypedDict already exist).

## M2 — Stages 1–3: capture/classify, pooling, benefit-test gate (2026-06-10)

15. **Schema-gate error classification.** `validation.validate_row` failures
    map to V-R1 when the message is an FK "does not resolve", and to V-R2 for
    everything else (enums, floats on amounts, missing mandatory fields,
    malformed decimals/dates). V-R2 is read as "rows validate against the
    generated schema" — enums being the SPEC-named case — so the exception
    report stays within the SPEC §7 catalogue without inventing IDs.

16. **V-R3 reversal identification is explicit, never heuristic.**
    schema.json has no reversal flag, so a negative amount passes V-R3 only
    when the row's `source_document_ref` is registered in
    `config["reversal_document_refs"]`. Anything else is a BLOCK — a silent
    "looks like a reversal" convention would be a silent default.

17. **Stage-1 split mechanics.** Children are floored at the cent (toward
    zero, so reversal rows split symmetrically) and the entire remainder goes
    to the largest split, tie-break ascending `mapping_id` (SPEC §4 Stage 1
    "remainder cent assigned to the largest split" + §5.1 determinism). A
    single mapping row with absent `allocation_split_pct` means 100% (the
    schema marks the field Conditional — only impure cost centers split), but
    a lone row with pct ≠ 100%, a non-positive split, or a missing pct on a
    multi-row mapping fires V-P2.

18. **V-P1 covers every "not exactly one destination" failure:** unmapped
    cost center as-of the period (the undated FK V-R1 catches cost centers
    absent from the mapping entirely; V-P1 catches expired mappings), a cost
    center mapping the same pool twice, a pre-assigned `pool_id`
    contradicting the mapping (or pre-assignment on a split cost center), a
    pool_id that is not in the active 3_Pool catalogue as-of the period, and
    a Direct line with no `traceable_recipient_id`.

19. **BLOCK scope at stage granularity.** Line-level blocks hold the line
    (`held_line_ids`, the exception queue); pool-attributable blocks (V-P5,
    V-B1, V-B3, duplicate catalogue rows) withhold that pool's outputs —
    "BLOCK halts the run for the affected pool" (SPEC §7). Run-level
    escalation (a held line whose target pool is unknowable) is the M6
    orchestrator's job.

20. **Stage-3 pct carve-outs are line-pro-rata; fixed amounts are
    pool-level.** A percentage exclusion's amount is defined as
    Σ(line_amount × pct) over the pool's constituent lines so the lineage
    adds up exactly; fixed amounts deduct at pool level with their documented
    basis (no per-line attribution, per the SPEC §4 Stage 3 contract).
    Exclusion math is full-precision Decimal — it is not one of SPEC §5.6's
    three rounding boundaries, so the chargeable base is never quantized.

21. **V-B3 also blocks "Use pct OR amount" violations** (both or neither set
    = indeterminate basis), and **V-B1 also bounds each pct to [0, 1] and the
    combined amount to [0, pool total]** — a negative carve-out would inflate
    the base. Negative `exclusion_amount` is V-R3.

22. **V-B2 skips zero-cost pools.** With nothing pooled there is no
    carve-out to miss; otherwise every Management pool outside its billing
    months would warn on every scoped run.

23. **Stage outputs carry Decimal amounts** (engine-internal, full
    precision); schema-shaped rows keep exact decimal strings. Adapters
    serialize at the persistence boundary (M6). Stage 2 emits zero-total rows
    for in-scope active pools with no lines (the SPEC §9.1 zero-cost pool
    flows through to a zero chargeable base).

## M3 — Stage 4 flat apportionment, largest remainder (2026-06-10)

24. **Zero chargeable base short-circuits Stage 4 before key resolution.**
    The SPEC §9.1 zero-cost pool (and the demo's 100%-excluded management
    pools, which have no key values by design — M1 #2) flows through with no
    allocations and `key_id = None`. No key support is required where nothing
    is charged: the V-K rules guard charges, not silence. A pool emerges with
    `total_allocated = 0`, so Stage-7 recon still ties (pooled = exclusions).

25. **V-K1 reading ("no silent zeroes").** A beneficiary with NO 7_KeyValue
    row for (key, pool, period) BLOCKs — a missing value is never read as
    zero. A beneficiary with an EXPLICIT `factor_value = 0` row is a measured
    zero and allocates 0.00 (the SPEC §9.1 "beneficiary with zero key value"
    edge case). V-K1 also fires on more than one row per beneficiary (not
    exactly one determinate value) and on an EMPTY resolved population for a
    chargeable pool — a participation gap that would strand the whole base as
    V-X1 residual is blocked at the stage that detects it.

26. **V-K2 freshness windows.** Dynamic keys: `as_of_date` within the run
    period. Static keys: within the N months ending at period_end
    (config `keyFreshnessStaticMonths`, default 12 per SPEC §7); a snapshot
    dated after period_end is stale in both modes (a later snapshot cannot
    have been the period's key). A `static_or_dynamic` value that is not
    exactly "Static" gets the tighter dynamic window (conservative; the value
    is enum-gated upstream anyway).

27. **V-K3 recomputation discipline.** The engine recomputes
    `total_factor_value` as Σ `factor_value` over the RESOLVED population;
    every supplied total must equal it exactly (so stale denominators after a
    population change are caught). A non-positive recomputed total on a
    chargeable pool cannot form ratios → BLOCK. The supplied
    `allocation_ratio` ("Derived" in the schema) is ignored entirely — the
    engine recomputes ratios at full precision and validates Σ = 1 within
    1e-12.

28. **V-K4 prior-year key source.** Optional `ref_data["prior_year_keys"]`
    (`{pool_id: key_id}`, e.g. lifted from the prior year's charge ledger by
    the orchestrator). Absent data means nothing to compare — no warning; a
    WARN-level consistency probe must not invent history.

29. **`apportion` caller contract (ValueError, not V-rules).** The base must
    be non-negative and an exact multiple of the minor unit — SPEC §5.1's
    "assert sum(result) == base exactly" is unsatisfiable otherwise (all demo
    and golden bases are cent-grain: GL cents and fixed-amount exclusions).
    Ratios must be non-negative and sum to 1 within 1e-12 (V-K3 gates before
    the call; the function re-asserts in depth). Residual cents are handed
    out one at a time, cycling defensively if they ever exceed one per
    recipient. Stage-level rules emit V-rule exceptions; the algorithm
    crashes loud on contract breaches rather than rounding silently.

30. **Pool-level `direct_charge_flag` does not bypass Stage 4 in M3.**
    Direct routing is line-level (Stage 2 streams `charge_method = Direct`
    lines around apportionment). If a direct-charge pool still ends up with a
    poolable chargeable base, it apportions by its mandatory
    `default_key_id` — dropping the cost silently would be a silent default.

31. **Participation seed (supersedes M1 #14).** The generator now emits
    `participation.v1.json`: beneficiary populations per pool = the
    provider's actual SERVICE pair recipients (1000→3000;
    3100→3200/3300/3800) plus one Provider row per pool. The fully excluded
    management pools carry the same populations ("LVAIGS where charged",
    M1 #2) — harmless under #24 since their chargeable base is zero. Stage 4
    also re-runs the generated schema gate + V-R3 over the key value rows it
    actually uses (a negative or float factor would corrupt the
    apportionment), even though the M1 seed gate already validates seeds.
