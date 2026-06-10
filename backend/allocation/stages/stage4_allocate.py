"""Stage 4 — Allocate, flat single-tier (SPEC §4; M3 scope).

Pure function ``(inputs, ref_data, config) -> {"outputs", "exceptions", "log"}``.

inputs::

    {"pools": [...]}                # Stage-3 pool dicts (with chargeable_base)

ref_data::

    {"participation": [9_Participation rows],
     "entities":      [8_Entity rows],
     "key_defs":      [6_KeyDef rows],
     "key_values":    [7_KeyValue rows],
     "prior_year_keys": {pool_id: key_id}   (optional — V-K4)}

config::

    {"period": "YYYY-MM" | "YYYY",                 # required (SPEC §6)
     "keyFreshnessStaticMonths": int (optional, default 12 — V-K2)}

Behavior (SPEC §4 Stage 4), per pool in ascending pool_id order:

1. Resolve the beneficiary population from 9_Participation as-of the run
   period (SPEC §5.5), ``role = Beneficiary``, entity active per 8_Entity
   effective dates + status (mid-period in/out per whole period — SPEC §5.5
   default ``midPeriodProration = false``).
2. A zero chargeable base short-circuits: nothing to apportion, no key
   support required (SPEC §9.1 zero-cost pool; the demo's 100%-excluded
   management pools flow through here — DECISIONS.md M3).
3. Resolve the key: ``3_Pool.default_key_id`` -> 6_KeyDef (unresolved id is
   V-R1 BLOCK) -> 7_KeyValue rows for (key, pool, period).
4. Gate: V-K1 (a key value exists for every resolved beneficiary — no silent
   zeroes; exactly one each; non-empty population), schema/V-R3 over the rows
   used, V-K2 (as_of freshness), V-K3 (ENGINE-recomputed total_factor_value;
   ratios sum to 1 within 1e-12), V-K4 WARN (key changed vs. prior year).
5. ``allocation_ratio = factor_value / total_factor_value`` with the total
   recomputed by the engine over the resolved population (never trusted from
   input — V-K3); apportion via the largest-remainder method (SPEC §5.1) so
   allocated amounts sum EXACTLY to the chargeable base.

Cascading/reciprocal (SPEC §5.2-5.3) are orchestrated by
``allocation/algorithms/cascade.py`` (M5), which calls this stage per tier:
a pool carrying a ``markup_exempt_component`` (upstream received charges
under the "single" margin policy) gets a ``markup_exempt_cost`` per
allocation — the component's share at the recipient's ratio — so Stage 5
marks up only the pool's OWN cost. Direct-charge and pass-through lines were
already routed around this stage at Stage 2.

outputs::

    pools:        Stage-3 pool dicts + {key_id, total_factor_value: Decimal,
                  allocations: [...], total_allocated: Decimal}
    allocations:  flat list — {pool_id, provider_entity_id,
                  recipient_entity_id, period, key_id, key_value_id,
                  factor_value: Decimal, allocation_ratio: Decimal,
                  allocated_cost: Decimal}
    blocked_pool_ids: pools withheld by BLOCK rules

Amounts are Decimal end to end; the ONLY rounding is the largest-remainder
quantization inside ``apportion`` (SPEC §5.6 boundary 1).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Mapping

from allocation.algorithms.apportion import apportion
from allocation.algorithms.effective_dating import resolve_as_of
from allocation.validation import rules

ZERO = Decimal("0")


def stage4_allocate(
    inputs: Mapping[str, Any],
    ref_data: Mapping[str, Any],
    config: Mapping[str, Any],
) -> dict[str, Any]:
    period = config.get("period")
    if not period:
        raise ValueError("config['period'] is required (SPEC §6)")
    static_months = int(config.get("keyFreshnessStaticMonths", 12))

    pools = sorted(inputs["pools"], key=lambda p: p["pool_id"])

    # Beneficiary populations: 9_Participation as-of period, role Beneficiary,
    # entity active per 8_Entity effective dates + status (SPEC §4 Stage 4).
    active_entities = {
        e["entity_id"]
        for e in resolve_as_of(ref_data.get("entities", ()), period)
        if e.get("status") == "Active"
    }
    beneficiaries_by_pool: dict[str, set[str]] = {}
    for row in resolve_as_of(ref_data.get("participation", ()), period):
        if row.get("role") == "Beneficiary" and row["entity_id"] in active_entities:
            beneficiaries_by_pool.setdefault(row["pool_id"], set()).add(row["entity_id"])

    key_defs = {k["key_id"]: k for k in ref_data.get("key_defs", ())}
    # (key_id, pool_id) -> recipient -> [7_KeyValue rows for the run period]
    kv_index: dict[tuple[str, str], dict[str, list[dict]]] = {}
    for row in sorted(ref_data.get("key_values", ()),
                      key=lambda r: str(r.get("key_value_id") or "")):
        if row.get("period") != period:
            continue
        kv_index.setdefault((row["key_id"], row["pool_id"]), {}) \
            .setdefault(row["recipient_entity_id"], []).append(dict(row))
    prior_year_keys: Mapping[str, str] = ref_data.get("prior_year_keys") or {}

    exceptions: list[dict] = []
    log: list[str] = []
    pools_out: list[dict] = []
    allocations_flat: list[dict] = []
    blocked_pools: set[str] = set()

    for pool in pools:
        pool_id = pool["pool_id"]
        base: Decimal = pool["chargeable_base"]
        out = dict(pool)

        # Zero-cost / 100%-excluded pool: nothing to apportion (SPEC §9.1);
        # no key support is required where nothing is charged (DECISIONS.md M3).
        if base == ZERO:
            out.update(key_id=None, total_factor_value=None,
                       allocations=[], total_allocated=ZERO)
            pools_out.append(out)
            log.append(f"stage4: pool {pool_id} has a zero chargeable base — "
                       "nothing to apportion")
            continue

        beneficiaries = sorted(beneficiaries_by_pool.get(pool_id, ()))

        # Key resolution: 3_Pool.default_key_id -> 6_KeyDef (V-R1 BLOCK).
        key_id = pool["default_key_id"]
        key_def = key_defs.get(key_id)
        if key_def is None:
            exceptions.append(rules.exception(
                "V-R1",
                f"pool {pool_id}: default_key_id FK {key_id!r} does not "
                "resolve to 6_KeyDef.key_id",
                objects=[pool_id, key_id], pool_id=pool_id,
            ))
            blocked_pools.add(pool_id)
            log.append(f"stage4: pool {pool_id} withheld (V-R1 BLOCK)")
            continue

        rows_by_recipient = kv_index.get((key_id, pool_id), {})

        # V-K1 — a key value exists for every resolved beneficiary (exactly
        # one); empty population on a chargeable pool is a participation gap.
        k1_excs = rules.v_k1_key_values_exist(
            pool_id, key_id, period, beneficiaries, rows_by_recipient)
        if k1_excs:
            exceptions.extend(k1_excs)
            blocked_pools.add(pool_id)
            log.append(f"stage4: pool {pool_id} withheld (V-K1 BLOCK)")
            continue

        used_rows = [rows_by_recipient[b][0] for b in beneficiaries]

        # Schema gate over the rows actually used (types/enums -> V-R2) and
        # V-R3 (negative factors would corrupt the apportionment).
        schema_excs, _ = rules.v_r1_v_r2_schema_gate("7_KeyValue", used_rows, None)
        r3_excs, _ = rules.v_r3_amounts_non_negative("7_KeyValue", used_rows)
        if schema_excs or r3_excs:
            exceptions.extend({**e, "pool_id": pool_id}
                              for e in schema_excs + r3_excs)
            blocked_pools.add(pool_id)
            log.append(f"stage4: pool {pool_id} withheld "
                       "(malformed key value rows — BLOCK)")
            continue

        # Ratios: factor / ENGINE-recomputed total over the resolved
        # population (never trusted from input — V-K3).
        factors = {b: Decimal(rows_by_recipient[b][0]["factor_value"])
                   for b in beneficiaries}
        recomputed_total = sum(factors.values(), ZERO)
        ratios = ({b: f / recomputed_total for b, f in factors.items()}
                  if recomputed_total > ZERO else {})

        k2_excs = rules.v_k2_key_freshness(
            pool_id, key_def, period, used_rows, static_months=static_months)
        k3_excs = rules.v_k3_total_factor_and_ratio_sum(
            pool_id, key_id, used_rows, recomputed_total, ratios)
        # V-K4 WARN — consistency scrutiny; never withholds the pool.
        k4_excs = rules.v_k4_key_changed_vs_prior_year(
            pool_id, key_id, prior_year_keys.get(pool_id))
        exceptions.extend(k2_excs + k3_excs + k4_excs)
        if k2_excs or k3_excs:
            blocked_pools.add(pool_id)
            log.append(f"stage4: pool {pool_id} withheld "
                       f"({'V-K2' if k2_excs else 'V-K3'} BLOCK)")
            continue

        # Largest-remainder apportionment (SPEC §5.1) — allocated amounts sum
        # EXACTLY to the chargeable base (rounding boundary 1, SPEC §5.6).
        allocated = apportion(base, ratios)
        allocations = [{
            "pool_id": pool_id,
            "provider_entity_id": pool["provider_entity_id"],
            "recipient_entity_id": b,
            "period": period,
            "key_id": key_id,
            "key_value_id": rows_by_recipient[b][0]["key_value_id"],
            "factor_value": factors[b],
            "allocation_ratio": ratios[b],
            "allocated_cost": allocated[b],
        } for b in beneficiaries]
        total_allocated = sum((a["allocated_cost"] for a in allocations), ZERO)
        assert total_allocated == base  # SPEC §4 Stage 4 exact-sum contract

        # SPEC §5.2 "single" margin policy: the upstream (received) component
        # is carried per allocation at the recipient's ratio (full precision —
        # Stage 5's boundary-2 quantization absorbs the sub-cent drift of the
        # quantized cost leg). The cascade orchestrator guards the bound.
        exempt_component = pool.get("markup_exempt_component") or ZERO
        if exempt_component:
            assert ZERO <= exempt_component <= base
            for a in allocations:
                a["markup_exempt_cost"] = exempt_component * a["allocation_ratio"]

        out.update(key_id=key_id, total_factor_value=recomputed_total,
                   allocations=allocations, total_allocated=total_allocated)
        pools_out.append(out)
        allocations_flat.extend(allocations)

    log.append(
        f"stage4[{period}]: {len(pools_out)} pools allocated "
        f"({len(allocations_flat)} allocations), "
        f"{len(blocked_pools)} pools blocked",
    )
    return {
        "outputs": {
            "pools": pools_out,
            "allocations": allocations_flat,
            "blocked_pool_ids": sorted(blocked_pools),
        },
        "exceptions": exceptions,
        "log": log,
    }
