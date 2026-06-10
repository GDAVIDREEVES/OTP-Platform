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

## M4 — Stages 5–6: markup, FX/charge-out, charge ledger (2026-06-10)

32. **V-M2 LVAIGS facet is a WARN; the engine applies the regime-fixed 5%.**
    The SPEC §7 catalogue lists V-M2 as BLOCK, but the §4 Stage-5 contract
    explicitly carves the LVAIGS case out: "LVAIGS fixed 5% (warn if policy
    says otherwise)" — mirrored by the build instruction. So SCM/Pass-through
    ≠ 0% and Benchmarked-without-study-ref BLOCK, while an LVAIGS policy with
    a deviating `markup_pct` fires V-M2 at WARN severity and the engine
    prices the regime-FIXED 5% (the deviant rate is never applied — the
    regime pins the rate, so nothing is silently defaulted; the policy row
    is flagged for repair). `rules.exception()` gained a `severity` override
    used only by this facet.

33. **V-M1 covers determinacy, not just existence.** Zero 4_MarkupPolicy rows
    in scope as-of the period for a charged (pool, recipient jurisdiction)
    BLOCKs ("never default a markup"); MORE than one row in scope BLOCKs
    equally — not exactly one determinate policy (mirrors the V-K1 duplicate
    reading, M3 #25).

34. **Pass-through legs skip policy resolution entirely.** A disbursement
    advanced for a recipient recharges AT COST with 0% markup by construction
    (V-P4 / SPEC §4 Stage 2); Stage 5 prices them without consulting
    4_MarkupPolicy — "pass-through inside a marked-up pool" (SPEC §9.1) keeps
    the pool's own policy for the allocated/direct legs. Direct-charge legs
    (charge_method = Direct) DO bear the (pool, recipient jurisdiction)
    markup — the SPEC exempts them from the key, not from the margin.

35. **Charge granularity: one 10_ChargeLedger row per (pool, recipient,
    period, stream).** Streams (allocated / direct / pass-through) are never
    merged — they carry different markup treatment and V-X2 ties the
    allocated cost component to the chargeable base. Deterministic ids:
    `CHG-{period}-{pool}-{recipient}` with `-DIRECT` / `-PASSTHRU` suffixes.
    Direct/pass-through legs aggregate per (pool, provider, recipient) with
    full cost-line lineage on the engine-side charge (and in the Stage-6
    `lineage` output).

36. **Demo currency: every leg charges in the provider's booking currency
    (USD).** Config `chargeCurrency: "recipient" | "provider"` — default
    "recipient" per SPEC §4 Stage 6 ("convert to recipient currency"); the
    demo runs "provider", which the schema allows (`charge_currency` =
    "Recipient functional/transaction currency" — this is the transaction
    currency). Recipients' functional EUR/GBP differ, but converting would
    break the warehouse tie (pair gross is USD). The identity rate "1.0" is
    LOGGED with the configured fx_rate_type and the period-end date — an
    identity is not a default; no snapshot row is required for same-currency
    legs.

37. **FX/tax reference failures map to V-R1/V-R2 (no invented rule IDs).**
    A cross-currency leg whose (from, to, configured type) snapshot lookup
    resolves to ≠ 1 row, an unresolvable provider/recipient entity as-of the
    period, and an ambiguous jurisdiction-pair tax rule are V-R1 (the
    charge's reference must resolve — engine-enforced); a malformed snapshot
    row (non-string/non-positive rate, missing rate_date) or incomplete tax
    rule (Standard-rated without a determinate `vat_rate`, malformed
    `wht_rate`, off-enumeration treatment) is V-R2 (the row fails its shape
    contract) — extending the M2 #15 classification.

38. **Cost and markup convert separately; gross is their exact sum.** At
    SPEC §5.6 boundary 3 each component quantizes HALF_EVEN to the TARGET
    currency's minor unit, and `gross_charge_amount = cost + markup` exactly,
    preserving the schema identity in the charge currency (rounding the gross
    independently could break it by a cent). VAT/WHT amounts (v1 simple
    rate-based attributes) quantize at the same per-charge boundary; a
    jurisdiction pair with no rule row simply omits the attributes (they are
    Recommended/Conditional in the schema — absent reference data for an
    optional attribute is not a silent default). Zero-decimal currencies
    (JPY et al.) quantize to whole units via
    `allocation/algorithms/currency.py`.

39. **`budget_or_actual` from `runType`: budget→Budget, actual→Actual,
    trueup→Actual.** A true-up run RECOMPUTES the year on actuals (SPEC
    §5.4); the True-up delta rows (with `true_up_parent_charge_id`) are
    emitted by Stage 7 in M6, never by Stage 6.

40. **Markup quantum = the provider's booking-currency minor unit.** SPEC
    §5.6 boundary 2 says "minor unit" without naming a currency; at Stage 5
    amounts are still in the provider's books, so its functional currency
    governs (v1 assumes a provider books all pool costs in its functional
    currency — the seeds comply; mixed-currency pools are out of v1 scope).
    The provider entity must therefore resolve as-of the period (V-R1).

41. **`run_id` / `documentation_ref` are stamped by the orchestrator (M6).**
    Stages do not know run identity (engine purity); Stage 6 emits
    schema-shaped rows without them, and the persistence adapter adds
    `run_id` (M1 #8). The posting file is RETURNED as a structure (one per
    provider, SPEC §8.2 fields plus charge_id) — the orchestrator writes run
    artifacts (ADAPTATION D1); `invoice_required` = the provider and
    recipient jurisdictions differ (cross-border IC services need an
    invoice); account hints are static v1 strings (4910 revenue / 6910
    expense).

42. **Stage-2 pool dicts now carry `documentation_ref`** (3_Pool, Recommended
    — read via `.get`), because V-M4's "undocumented divergence" needs the
    pool's documentation reference at Stage 5. V-M4 compares the policies
    actually USED by the pool's charges in the run (LVAIGS somewhere +
    Benchmarked > 5% elsewhere, no documentation_ref → WARN); pools absent
    from Stage 5's `pools` input (direct/pass-through-only legs) skip V-M4 —
    nothing to compare against.

43. **Per-period demo markup ties to FY pair gross by construction —
    verified, not assumed.** With the pair-effective benchmarked rate
    (gross/cb − 1 at precision 28, M1 #12), Σ over the two billing periods of
    `HALF_EVEN(cb_p × rate)` equals FY gross − FY cb exactly for all four
    pairs (checked numerically; asserted to the cent by the M4 demo
    reconciliation gate). Blended FY markup = 14,344,773.26 / 13,586,402.70
    − 1 ≈ 5.58% — the demo story.

## M5 — Cascade (topo) + reciprocal (SCC simultaneous equations) (2026-06-10)

44. **`cost_nature` enumeration extended through schema.json → codegen.**
    SPEC §5.2 mandates `cost_nature = Intercompany charge received` on
    received-charge cost lines, but the schema enumeration lacked the value.
    Per ENGINE-CLAUDE.md rule 3 ("edit schema.json → run codegen → then touch
    code — never the reverse") the value was added to the `cost_nature`
    `allowed_values` and types regenerated; DDL is unchanged (enums are
    engine-validated, not column constraints). Additive — every existing
    seed/row still validates.

45. **The cascade orchestration path lives in
    `allocation/algorithms/cascade.py` (`cascade_allocate`).** SPEC §4 calls
    Stage 4 "cascade-aware"; the build brief says "integrate into stage4
    orchestration path". Stages stay single-purpose pure functions; the
    cascade composes `stage4_allocate` + `stage5_markup` per condensation
    group (upstream charges must be PRICED before they can join a hub pool,
    so the orchestration necessarily spans both stages). On a flat graph it
    degrades to exactly the plain Stage-4 + Stage-5 pass (tested), so the M6
    orchestrator can route every run through it.

46. **Received charges inject POST-Stage-3** (into `chargeable_base` /
    `total_pooled_cost` of the not-yet-processed hub pool). The benefit gate
    strips non-chargeable cost from the hub's OWN books; the upstream pool
    already passed its own gate, and re-gating the received charge would
    double-apply exclusions. The hub pool's percentage exclusions therefore
    never touch received components (they ran before injection).

47. **Received-line field choices** (schema-shaped 1_CostLine, no extra
    fields — the schema gate rejects unknown keys): `cost_line_id =
    CL-RCV-{upstream charge ref}`; `source_document_ref` = the upstream
    charge reference (= Stage-6's deterministic `charge_id` scheme for
    allocated legs, so ledger and lineage key identically); `cost_center =
    CC-IC-{upstream pool}`; `cost_element` = the 6910 intercompany-services
    expense hint (mirrors the Stage-6 posting file); `function` = the
    DESTINATION pool's service line (keeps V-P3 homogeneity meaningful);
    `charge_method = Indirect`; amount = the upstream GROSS (the
    already-marked-up amount, SPEC §5.2). The exempt flag travels in the
    separate `received_lineage` records + pool-level `markup_exempt_component`
    — never on the schema row.

48. **`markup_exempt_component` is carried on the POOL dict; per-leg
    `markup_exempt_cost` = component × allocation ratio (full precision).**
    Stage 5 prices `markup = (cost − markup_exempt) × pct` at boundary 2;
    the sub-cent drift between the quantized cost leg (boundary 1) and the
    full-precision exempt share is absorbed by the boundary-2 quantization
    (it is < 1 cent by the largest-remainder bound, so the markup is exact
    at the cent). Zero everywhere outside a cascade — M2-M4 behavior is
    byte-identical (all 93 prior tests unchanged).

49. **Destination routing must resolve to EXACTLY one pool.** A receiving
    provider with two in-scope pools makes the received charge's destination
    indeterminate → V-R1 BLOCK on the candidate pools (the "not exactly one
    determinate X" reading of M4 #33/#37); same for an entity providing two
    pools inside one SCC (the internal consumption shares cannot split).
    Cross-currency cascade edges also V-R1 BLOCK: the stage-4 path has no FX
    snapshot, and silently converting (or not) would be a silent default —
    v1 requires currency homogeneity along cascade edges. A ZERO-gross
    received charge synthesizes no line (logged): it adds no cost and a
    zero row would only blur lineage.

50. **BLOCKs propagate downstream through the graph.** A pool whose upstream
    charge went missing would otherwise run on a silently short base — a
    silent default. Downstream pools are withheld and logged WITHOUT a new
    exception ID (the root cause is already on the report); an SCC member
    blocked at key resolution escalates to V-C1 for the whole SCC (the
    consumption matrix is incomplete, so the cycle is unsolvable), and SCC
    members always share their group's fate.

51. **Reciprocal semantics follow SPEC §5.3 literally.** The system is
    solved ON COST (`S = C + AᵀS`; Gaussian elimination with partial
    pivoting on Decimal, SELF-VERIFIED against the system within 1e-10, with
    the iterative-substitution fallback per SPEC; unconverged → V-C1).
    Internal SCC flows are implicit in the solve — no ledger charges between
    members. External recipients are charged from the solved S_i at their
    key shares via ONE SCC-wide largest-remainder apportionment of Σ C over
    the weights S_i × share_i(r): conservation (total in == total charged
    out) holds to the cent BY CONSTRUCTION. Markup applies once, on each
    department's own cost component C_i × share_i(r) at the charging pool's
    policy — the received component passes through unmarked, "consistent
    with §5.2 single"; the slice of own cost routed through sibling members
    exits at cost (conservatively under-margined rather than re-margined).

52. **`reciprocalSolverEnabled` config key (default true).** V-C1's
    "solver disabled" facet requires a disablement switch that SPEC §6 does
    not define; a boolean keyed beside the other run flags is the minimal
    addition. SCC pool outputs carry `solved_cost`, `reciprocal_scc` and
    `internal_consumption` for audit reconstruction (`allocation_ratio`
    stays the pool's OWN key share; the solved S_i explains the difference).

53. **Externally-supplied received-line lineage must be COMPLETE.**
    `ref_data["received_charge_lineage"]` records (for GL-booked received
    lines) need both `upstream_charge_ref` and an explicit boolean
    `markup_exempt`; an incomplete record is NOT registered and the line
    fires V-C3 — guessing exemption would be a silent default. If a pool's
    supplied exempt component exceeds its chargeable base (the benefit gate
    carved into the received charge), V-B1 fires (the combined-exclusions
    bound read against the pool's own cost) and the pool blocks.

54. **`cascade_allocate` scope = poolable streams.** Direct-charge and
    pass-through legs (Stage-2 streams a/b) are priced by the orchestrator's
    separate Stage-5 pass and do NOT cascade in v1 — a direct charge into a
    hub joining the hub's pool is out of scope (and would need its own
    routing rule). Stage-7 recon (M6) must read SCC pools at SCC grain:
    per-pool `total_allocated` ≠ `chargeable_base` inside a cycle by design;
    the SCC-level sums tie exactly (V-X2 needs the group view).

## M6 — Stage 7 recon, true-up, doc pack, orchestrator/API/registry (2026-06-10)

55. **Recon runs at the Stage-5 pre-FX level (provider booking currency).**
    V-X2's "Σ charges out (cost component) per pool = chargeable base
    EXACTLY" is only meaningful before conversion, and a per-(pool, provider)
    recon row must sum a single currency regardless of the run's
    `chargeCurrency` mode (recipient-currency rows mix EUR/JPY/USD). Sheet-11
    amounts are therefore provider-currency; the charge ledger carries the
    converted amounts.

56. **Recon covers the POOLED stream only.** Direct-charge and pass-through
    legs never enter pool totals (Stage 2 routes them around the pool) and
    recharge their traceable cost 1:1 — they cannot create residual by
    construction. Stage 7 recomputes recovered/markup/charged-out from the
    pools' ALLOCATED legs (never trusting pool-level totals); direct/PT legs
    appear on the ledger and posting files but not in the pool tie-out.

57. **SCC recon semantics (extends #54).** V-X2 evaluates at GROUP grain for
    reciprocal members (one exception per member pool when the group does not
    tie, V-C1 style). When the group ties, each member's
    `total_cost_recovered` reports its own chargeable base — true by the
    solver's conservation (asserted at solve time): nothing of the member's
    cost is stranded, so the row's residual is the genuine zero. The member's
    ledger-keyed sums remain visible as `total_markup`/`total_charged_out`,
    and `solved_cost`/`internal_consumption` on the stage outputs explain the
    difference.

58. **Stage 7 emits rows WITHOUT run identity** (`recon_id`/`run_id`/
    `run_timestamp` are stamped by the orchestrator at persistence — the
    M4 #41 contract extended to sheet 11; `recon_id = RECON-{run_id}-{pool}`
    keeps the PK unique across runs). Recon rows for pools that fail V-X1/
    V-X2 are still EMITTED (status Break, break_amount set) — the row is the
    evidence of the break; the orchestrator then fails the run.

59. **True-up mechanics (SPEC §5.4).** (a) Deltas are computed per (pool,
    provider, recipient, year) in the PROVIDER's booking currency at the
    Stage-5 pre-FX level: in-year monthly FX never drives the true-up — the
    configured `trueUpFxRateType` converts the delta ONCE (cost and markup
    separately, boundary 3; gross exact sum), which is the only reading that
    makes the config meaningful. (b) "Σ booked Budget charges" is anchored to
    the LEDGER: every booked row must be exactly reproduced by the
    deterministic budget recompute (matched by engine charge id; amounts
    re-derived with the row's own logged fx_rate) — any mismatch, duplicate
    or orphan booking is V-X4 BLOCK; a recompute leg that was never booked is
    EXCLUDED from the subtrahend (only booked charges are subtracted) and
    logged. (c) Parent = the latest-period verified booked charge, tie-break
    ascending charge_id; a triple without booked rows emits its delta with no
    parent (Conditional field). (d) Zero-delta triples emit no row.
    (e) Negative deltas are legitimate: True-up rows are the append-only
    ledger's sanctioned correction (reversing) rows — the V-R3
    explicit-reversal reading, with `true_up_parent_charge_id` as the
    explicit link. (f) `markup_pct_applied` (Mandatory) on a delta row = the
    year's single distinct policy rate when determinate, else the blended
    markup/cost delta ratio, else "0". (g) The schema `fx_rate_type`
    enumeration has no year-end/annual-average member: rows map
    year_end_closing → "Spot" (the year-end rate_date pins the closing
    semantics) and annual_average → "Monthly average". (h) V-X3 fires per
    (pool, provider) on |Σ delta_gross| / actual-year gross > threshold
    (threshold read as `Decimal(str(config value))` — a config scalar, not
    money).

60. **V-X4 has two facets.** (a) Run reproducibility: the output hash is
    computed over the PRE-stamped engine outputs (charges, true-up rows,
    recon minus run identity, exceptions) and persisted as the
    `output.sha256` artifact; a new run whose input snapshot hash matches a
    prior succeeded run must reproduce that run's output hash or it fails.
    (b) Booked-budget reproducibility inside the true-up (#59b). Both are
    "same inputs must yield identical outputs".

61. **Run/persistence mechanics (ADAPTATION D1).** `run_id =
    RUN-{seq:04d}-{run_type}-{period}` (lexical order = insertion order);
    persisted ledger ids are namespaced `{run_id}:{engine_charge_id}` so the
    deterministic engine ids (M4 #35) stay unique on the append-only ledger
    (`documentation_ref` = the run id, pointing at its doc pack). ANY BLOCK
    exception fails the WHOLE run — nothing reaches the ledgers; only the
    exception report + output hash persist with status `failed` (the
    conservative reading of SPEC §4 "atomic, all-or-nothing per run").
    Success persists charges + recon + artifacts + the status transition in
    ONE SQLite transaction. **Artifacts live in SQLite**
    (`allocation_run_artifacts`: doc pack Markdown, exceptions.json,
    posting/{provider}.json+.csv, lineage.json, output.sha256, summary.json)
    rather than files under state/runs/ — a demo reset wipes them with
    everything else and the API serves them without filesystem coupling. The
    table is orchestrator infrastructure (NOT schema.json-derived), so it
    sits OUTSIDE the generated DDL markers. "The booked Budget charges" for a
    period = the rows of the LATEST succeeded budget run covering it (earlier
    same-period budget runs are superseded by recency; the ledger itself
    stays append-only).

62. **SCC "single" margin fix.** M5 #51 exempted only the INTERNAL reciprocal
    component (`markup_exempt_cost = cost − own_cost × ratio`); an upstream
    charge injected into a cycle member would have been re-margined. The
    markable base is now `(own_cost − markup_exempt_component) × ratio` — the
    member's PURE own cost share — so upstream injections pass through
    cycles unmarked exactly as they do through acyclic tiers (SPEC §5.2
    "no further markup on that component"). Test-pinned: a member's external
    markup is identical with and without the upstream injection.

63. **A run period's FX snapshot = the dataset rows whose `rate_date` falls
    inside the period** (the runner filters before Stage 6, which requires
    exactly one row per pair). The true-up snapshot (`trueup_fx_rates`) is
    keyed by the config-level type and passed as-is.

64. **Golden fixture topology (ADAPTATION D3).** SPEC §9.2 names a reciprocal
    PAIR (LE-UK ⇄ LE-NL) AND an SCM US-leg recipient. Because LE-US (an IT
    beneficiary) provides POOL-MGMT, ANY management charge to LE-NL or LE-UK
    closes a second cycle through LE-US and collapses the pair into a
    3-member SCC. POOL-MGMT therefore charges the three OpCos only; the
    Finance-SSC charge to the hub cascades INSIDE the reciprocal solve
    (internal flows are implicit, M5 #51), and the EXPLICIT received-cost-
    line cascade (SPEC §5.2) is exercised by IT's SCM charge to LE-US joining
    POOL-MGMT (markup-exempt, post-gate). Cascade-path entities (LE-US,
    LE-NL, LE-UK) book USD (M5 #49 currency homogeneity); the golden runs use
    the SPEC-default `chargeCurrency: "recipient"` (EUR + zero-decimal JPY
    legs at flat monthly rates; true-up at the year-end closing rate). The
    builder (`tests/allocation/golden/build_fixture.py`) is the committed
    INDEPENDENT hand-computation — it never imports the engine — and key
    figures are re-hard-coded as literals in the test.

65. **Calc Studio registration.** `service_allocation` is POST-backed and
    writes ledgers, so the CS-a byte-identical registry↔HTTP gate does not
    apply; its golden equivalence is the deterministic OUTPUT HASH (registry
    run == POST run for the same inputs — V-X4's own guarantee), asserted in
    tests/allocation/test_m6_demo_endtoend.py. Registry runs audit twice by
    design: the standard `calc:service_allocation` event plus the
    orchestrator's `allocation:{run_id}` event (every allocation run is
    audited regardless of how it was launched). The shaped trace is the
    seven SPEC §4 stage summaries, emitted as "stage" trace events so
    historical runs shape retroactively.

## M7 — Calc Studio Allocations workbench + OTP-10/15 wiring (2026-06-10)

66. **The no-float-on-amounts rule extends to the UI.** The workbench never
    parses a ledger amount into an IEEE number: decimal strings are formatted
    lexically (digit grouping on the string), percent display shifts the
    decimal point on the string (4-dp display truncation of the
    full-precision rate, which stays in the chip tooltip — the ADAPTATION D2
    "DE 5.6133%" convention), and the only client-side aggregation (the recon
    KPIs' Σ charged-out / Σ true-up delta) sums exact cents via BigInt
    (`src/features/calc-studio/allocationLib.ts`). Balanced/Break status is
    always the ENGINE's verdict — the UI renders the recon columns, it never
    re-derives the tie-out.

67. **Run-row Evidence links to `calc:service_allocation`** (per the build
    brief — the engine's registry-level audit ref); the per-run hash chain at
    `allocation:{run_id}` (every run is audited there regardless of launch
    path, M6 #65) is linked from the selected-run panel as "Run audit". Both
    packets resolve through the standard /evidence/:ref page.

68. **Launch-period choices are derived from data, never hardcoded:** the
    period Select offers the Stage-3 exclusion register's effective months ∪
    the recorded runs' monthly periods (the dataset's billing periods, M1 #6).
    True-up launches post the selected period's YEAR (SPEC §5.4/§6).

69. **No new backend surface for M7.** The Pools & policies section reads the
    engine's reference sheets through the existing read-only
    `/api/reference/allocation_*` seeds endpoint; runs/recon/exceptions/
    charges/doc-packs/lineage use the M6 router as-is. The frontend
    interfaces in `src/shared/api/types.ts` are documented DISPLAY
    projections of the schema.json sheets (the house hand-typed API-client
    convention) — schema.json + the generated backend types remain the only
    authoritative shapes.

70. **Failed runs stay first-class in the workbench.** POST returns 200 with
    status `failed` (a domain outcome, M6 router contract); the console
    surfaces the BLOCK/WARN counts and deep-links the Exceptions section,
    while the run-scoped Recon/Charges/Doc-packs sections explain the
    all-or-nothing emptiness rather than erroring.

71. **Sub-nav state rides `?view=`** (ToggleButtonGroup synced to the search
    params) so OTP-15 can deep-link the Pools & policies section
    (`/calc-studio/allocations?view=pools`) — mirrors the Calculations tab's
    `?calc=` deep-link convention.
