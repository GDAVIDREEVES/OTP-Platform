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
