"""Stage 5 — Cost base & markup (SPEC §4; M4 scope).

Pure function ``(inputs, ref_data, config) -> {"outputs", "exceptions", "log"}``.

inputs::

    {"pools":          [...],     # Stage-4 pool dicts (with allocations)
     "direct_charges": [...],     # Stage-2 stream (a) — optional
     "pass_through":   [...]}     # Stage-2 stream (b) — optional

ref_data::

    {"markup_policies": [4_MarkupPolicy rows],
     "entities":        [8_Entity rows]}

config::

    {"period": "YYYY-MM" | "YYYY"}   # required (SPEC §6)

Behavior (SPEC §4 Stage 5), per pool in ascending pool_id order:

1. Resolve ``4_MarkupPolicy`` by (pool, recipient jurisdiction, period) —
   jurisdiction from 8_Entity as-of the period (SPEC §5.5). A missing policy
   for a charged (pool, jurisdiction) is V-M1 BLOCK — NEVER default a markup
   (ENGINE-CLAUDE.md "No silent defaults"); more than one policy in scope is
   equally indeterminate (DECISIONS.md M4). Used policy rows re-pass the
   schema gate (a float/malformed ``markup_pct`` would corrupt the pricing).
2. Regime rules: SCM (0%) and Pass-through (0%) must carry 0% (V-M2 BLOCK);
   Benchmarked requires ``benchmark_study_ref`` (V-M2 BLOCK); LVAIGS (5%) is
   regime-FIXED at 5% — a deviating policy rate fires V-M2 as a WARN and the
   engine applies the fixed 5% (SPEC §4 Stage 5 "warn if policy says
   otherwise"; DECISIONS.md M4). SCM additionally requires an eligibility
   basis ≠ n/a and a business judgment conclusion (V-M3 BLOCK). V-M4 WARN
   flags a pool charged under LVAIGS in one jurisdiction and Benchmarked > 5%
   elsewhere with no pool ``documentation_ref``.
3. Price the three streams routed by Stages 2/4:
   - **allocated** legs (Stage-4 apportionment) — markup per resolved policy;
   - **direct** legs (``charge_method = Direct``) — markup per resolved
     policy, aggregated per (pool, provider, recipient) with line lineage;
   - **pass-through** legs — recharged AT COST, 0% markup, NO policy lookup:
     a disbursement advanced for a recipient is never marked up (V-P4 /
     SPEC §4 Stage 2; DECISIONS.md M4).
4. ``markup_amount = cost × markup_pct`` quantized HALF_EVEN to the minor
   unit of the provider's booking currency (SPEC §5.6 rounding boundary 2 —
   the ONLY rounding in this stage); ``gross_charge = cost + markup_amount``
   exactly.

outputs::

    pools:    Stage-4 pool dicts + {charges, total_markup: Decimal,
              total_gross: Decimal}
    charges:  flat priced list (Decimal amounts) — {pool_id,
              provider_entity_id, recipient_entity_id, period, charge_kind,
              allocation_key_id, allocation_ratio, key_value_id, line_ids,
              recipient_jurisdiction, markup_policy_id, regime,
              cost_currency, cost_recovered, markup_pct, markup_amount,
              gross_charge}  (direct/pass-through legs of pools absent from
              inputs["pools"] appear here only)
    held_line_ids:    direct/pass-through lines with no routable pool (V-P1)
    blocked_pool_ids: pools withheld by BLOCK rules (SPEC §7)
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_EVEN
from typing import Any, Mapping

from allocation.algorithms.currency import minor_unit
from allocation.algorithms.effective_dating import resolve_as_of
from allocation.validation import rules

ZERO = Decimal("0")

KIND_ALLOCATED = "allocated"
KIND_DIRECT = "direct"
KIND_PASS_THROUGH = "pass_through"


def _effective_markup_pct(policy: Mapping[str, Any]) -> Decimal:
    """The rate the engine applies: LVAIGS is regime-fixed at 5% (a deviating
    policy rate was warned by V-M2); every other regime prices the policy's
    own ``markup_pct``."""
    if policy["regime"] == rules.REGIME_LVAIGS:
        return rules.LVAIGS_RATE
    return Decimal(policy["markup_pct"])


def _aggregate_traceable_lines(
    lines, kind: str, exceptions: list[dict], held_line_ids: list[str],
) -> dict[tuple[str, str, str], dict]:
    """(pool_id, provider, recipient) -> {amount: Decimal, line_ids: [...]},
    in ascending cost_line_id order (SPEC §5.1 determinism). A line with no
    pool_id cannot form a schema-valid charge — V-P1 BLOCK, line held."""
    agg: dict[tuple[str, str, str], dict] = {}
    for line in sorted(lines, key=lambda r: str(r.get("cost_line_id") or "")):
        line_id = str(line.get("cost_line_id") or "?")
        pool_id = line.get("pool_id")
        if pool_id is None:
            exceptions.append(rules.exception(
                "V-P1",
                f"{kind} cost line {line_id} reached Stage 5 without a "
                "pool_id — a charge row requires its source pool",
                objects=[line_id],
            ))
            held_line_ids.append(line_id)
            continue
        key = (pool_id, line["provider_entity_id"],
               line["traceable_recipient_id"])
        entry = agg.setdefault(key, {"amount": ZERO, "line_ids": []})
        entry["amount"] += Decimal(line["amount_local"])
        entry["line_ids"].append(line["cost_line_id"])
    return agg


def stage5_markup(
    inputs: Mapping[str, Any],
    ref_data: Mapping[str, Any],
    config: Mapping[str, Any],
) -> dict[str, Any]:
    period = config.get("period")
    if not period:
        raise ValueError("config['period'] is required (SPEC §6)")

    pools = sorted(inputs["pools"], key=lambda p: p["pool_id"])
    pool_meta = {p["pool_id"]: p for p in pools}

    entities = {e["entity_id"]: e
                for e in resolve_as_of(ref_data.get("entities", ()), period)}

    # 4_MarkupPolicy as-of the run period, indexed by (pool, jurisdiction).
    policy_idx: dict[tuple[str, str], list[dict]] = {}
    for row in sorted(resolve_as_of(ref_data.get("markup_policies", ()), period),
                      key=lambda r: r["markup_policy_id"]):
        policy_idx.setdefault((row["pool_id"], row["jurisdiction"]), []).append(row)

    exceptions: list[dict] = []
    log: list[str] = []
    held_line_ids: list[str] = []

    direct_agg = _aggregate_traceable_lines(
        inputs.get("direct_charges") or (), KIND_DIRECT, exceptions, held_line_ids)
    pt_agg = _aggregate_traceable_lines(
        inputs.get("pass_through") or (), KIND_PASS_THROUGH, exceptions,
        held_line_ids)

    pool_ids = sorted(set(pool_meta)
                      | {k[0] for k in direct_agg} | {k[0] for k in pt_agg})

    pools_out: list[dict] = []
    charges_flat: list[dict] = []
    blocked_pools: set[str] = set()

    for pool_id in pool_ids:
        pool = pool_meta.get(pool_id)

        # ---- assemble the pool's charge legs (three streams) ----------------
        legs: list[dict] = []
        if pool is not None:
            pool_line_ids = list(pool.get("line_ids") or ())
            for a in pool.get("allocations") or ():
                legs.append({
                    "kind": KIND_ALLOCATED,
                    "provider": a["provider_entity_id"],
                    "recipient": a["recipient_entity_id"],
                    "cost": a["allocated_cost"],
                    "ratio": a["allocation_ratio"],
                    "key_id": a["key_id"],
                    "key_value_id": a["key_value_id"],
                    "line_ids": pool_line_ids,
                })
        for kind, agg in ((KIND_DIRECT, direct_agg),
                          (KIND_PASS_THROUGH, pt_agg)):
            for (pid, provider, recipient), entry in sorted(agg.items()):
                if pid != pool_id:
                    continue
                legs.append({
                    "kind": kind, "provider": provider, "recipient": recipient,
                    "cost": entry["amount"], "ratio": None, "key_id": None,
                    "key_value_id": None, "line_ids": entry["line_ids"],
                })
        if not legs:
            # Zero-base pool with nothing direct/pass-through (SPEC §9.1):
            # flows through unpriced — no policy support required where
            # nothing is charged (mirrors Stage 4, DECISIONS.md M3).
            if pool is not None:
                out = dict(pool)
                out.update(charges=[], total_markup=ZERO, total_gross=ZERO)
                pools_out.append(out)
                log.append(f"stage5: pool {pool_id} has no charge legs — "
                           "nothing to mark up")
            continue

        pool_excs: list[dict] = []

        # Provider entities must resolve as-of the period: the markup quantum
        # (SPEC §5.6 boundary 2) is the provider's booking-currency minor
        # unit (DECISIONS.md M4).
        missing_providers = sorted(
            {leg["provider"] for leg in legs} - set(entities))
        if missing_providers:
            pool_excs.append(rules.exception(
                "V-R1",
                f"pool {pool_id}: provider entity {missing_providers} does "
                f"not resolve to an 8_Entity row in scope as-of {period}",
                objects=missing_providers, pool_id=pool_id,
            ))

        # Recipient jurisdictions from 8_Entity as-of the period (V-R1).
        for leg in legs:
            ent = entities.get(leg["recipient"])
            leg["jurisdiction"] = ent["jurisdiction"] if ent else None
        unresolved = sorted({leg["recipient"] for leg in legs
                             if leg["jurisdiction"] is None})
        if unresolved:
            pool_excs.append(rules.exception(
                "V-R1",
                f"pool {pool_id}: recipient entity {unresolved} does not "
                f"resolve to an 8_Entity row in scope as-of {period} — no "
                "jurisdiction, no markup policy",
                objects=unresolved, pool_id=pool_id,
            ))

        # ---- markup policy per charged jurisdiction (V-M1..V-M3) -------------
        # Pass-through legs are AT COST by construction (V-P4) and need no
        # policy; only allocated/direct legs are markable.
        markable_jurs = sorted({leg["jurisdiction"] for leg in legs
                                if leg["kind"] != KIND_PASS_THROUGH
                                and leg["jurisdiction"] is not None})
        policy_by_jur: dict[str, dict] = {}
        used_policies: list[dict] = []
        for jur in markable_jurs:
            policies = policy_idx.get((pool_id, jur), [])
            m1_excs = rules.v_m1_markup_policy_resolution(
                pool_id, jur, period, policies)
            if m1_excs:
                pool_excs.extend(m1_excs)
                continue
            policy = policies[0]
            # Schema gate over the policy actually used (types/enums — V-R2).
            schema_excs, _ = rules.v_r1_v_r2_schema_gate(
                "4_MarkupPolicy", [policy], None)
            if schema_excs:
                pool_excs.extend({**e, "pool_id": pool_id}
                                 for e in schema_excs)
                continue
            pool_excs.extend(rules.v_m2_regime_markup_coherence(policy))
            pool_excs.extend(rules.v_m3_scm_support(policy))
            policy_by_jur[jur] = policy
            used_policies.append(policy)
        if pool is not None:
            pool_excs.extend(rules.v_m4_lvaigs_benchmarked_divergence(
                pool_id, pool.get("documentation_ref"), used_policies))

        exceptions.extend(pool_excs)
        if rules.blocks(pool_excs):
            blocked_pools.add(pool_id)
            log.append(f"stage5: pool {pool_id} withheld (BLOCK)")
            continue

        # ---- price the legs ---------------------------------------------------
        charges: list[dict] = []
        for leg in sorted(legs, key=lambda l: (l["recipient"], l["kind"])):
            if leg["kind"] == KIND_PASS_THROUGH:
                policy, pct = None, ZERO  # V-P4: at cost, never marked up
            else:
                policy = policy_by_jur[leg["jurisdiction"]]
                pct = _effective_markup_pct(policy)
            currency = entities[leg["provider"]]["functional_currency"]
            # SPEC §5.6 boundary 2 — markup per charge, HALF_EVEN to the
            # minor unit. The only rounding in this stage.
            markup = (leg["cost"] * pct).quantize(
                minor_unit(currency), rounding=ROUND_HALF_EVEN)
            assert leg["kind"] != KIND_PASS_THROUGH or markup == ZERO  # V-P4
            charges.append({
                "pool_id": pool_id,
                "provider_entity_id": leg["provider"],
                "recipient_entity_id": leg["recipient"],
                "period": period,
                "charge_kind": leg["kind"],
                "allocation_key_id": leg["key_id"],
                "allocation_ratio": leg["ratio"],
                "key_value_id": leg["key_value_id"],
                "line_ids": list(leg["line_ids"]),
                "recipient_jurisdiction": leg["jurisdiction"],
                "markup_policy_id": policy["markup_policy_id"] if policy else None,
                "regime": policy["regime"] if policy else None,
                "cost_currency": currency,
                "cost_recovered": leg["cost"],
                "markup_pct": pct,
                "markup_amount": markup,
                "gross_charge": leg["cost"] + markup,  # exact — no rounding
            })

        if pool is not None:
            out = dict(pool)
            out.update(
                charges=charges,
                total_markup=sum((c["markup_amount"] for c in charges), ZERO),
                total_gross=sum((c["gross_charge"] for c in charges), ZERO),
            )
            pools_out.append(out)
        charges_flat.extend(charges)

    log.append(
        f"stage5[{period}]: {len(charges_flat)} charges priced across "
        f"{len(pools_out)} pools, {len(held_line_ids)} lines held, "
        f"{len(blocked_pools)} pools blocked",
    )
    return {
        "outputs": {
            "pools": pools_out,
            "charges": charges_flat,
            "held_line_ids": held_line_ids,
            "blocked_pool_ids": sorted(blocked_pools),
        },
        "exceptions": exceptions,
        "log": log,
    }
