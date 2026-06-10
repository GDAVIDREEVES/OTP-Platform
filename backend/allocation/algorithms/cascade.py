"""Cascading (multi-tier) allocation — SPEC §5.2 — with reciprocal SCC
handling (SPEC §5.3): the cascade-aware Stage-4 orchestration path.

``cascade_allocate`` is a pure function
``(inputs, ref_data, config) -> {"outputs", "exceptions", "log"}`` that the
M6 orchestrator calls in place of a bare Stage-4 + Stage-5 pass whenever runs
may be multi-tier (on a flat graph it degrades to exactly that pass — tested).

inputs::

    {"pools": [...]}    # Stage-3 pool dicts (chargeable_base computed)

ref_data::

    Stage-4 ref data (participation / entities / key_defs / key_values
    [+ prior_year_keys]) PLUS Stage-5's markup_policies, and optionally
    received_charge_lineage: {cost_line_id: {"upstream_charge_ref": str,
    "markup_exempt": bool}} — the V-C3 lineage registry for GL-booked
    received-charge lines (DECISIONS.md M5).

config::

    Stage-4/5 config (period required) plus
    cascadeMarkupPolicy: "single" | "perTier"   (default "single", SPEC §6;
                                                 perTier fires V-C2 WARN
                                                 on EVERY run)
    reciprocalSolverEnabled: bool               (default True; a cycle with
                                                 the solver disabled is V-C1)

Behavior (SPEC §5.2-5.3):

1. Build the directed graph: node = (provider entity, pool) — one node per
   pool, V-P5 guaranteeing the single provider; edge pool P → pool Q iff a
   beneficiary of P is the provider of Q (a charge into a recipient that is
   itself a provider of a downstream pool).
2. Condense with Tarjan SCC and run groups in TOPOLOGICAL order.
3. Acyclic groups run ``stage4_allocate`` + ``stage5_markup``; every priced
   allocated charge received by a downstream provider becomes a cost line in
   the hub pool (``cost_nature = "Intercompany charge received"``, full
   lineage to the originating charge — V-C3) and joins that pool for the
   next tier at its already-marked-up (gross) amount.
4. Margin policy "single" (default): the received component is carried as
   ``markup_exempt_component`` on the hub pool and ``markup_exempt_cost`` per
   allocation, so Stage 5 marks up ONLY the hub's own costs. "perTier"
   re-margins everything (no exempt component) and warns V-C2 every run.
5. Cyclic groups solve S = C + AᵀS per SCC (Gaussian on Decimal, iterative
   fallback, else V-C1 BLOCK) and charge external (non-SCC) recipients from
   the solved S_i at their key shares — ONE SCC-wide largest-remainder
   apportionment of Σ C over the weights S_i × share_i(r), so total in ==
   total charged out across the SCC to the cent BY CONSTRUCTION. Markup
   applies once, on each department's own cost component C_i × share_i(r)
   (consistent with "single" — DECISIONS.md M5).
6. A BLOCK on any pool propagates downstream through the graph: a pool whose
   received charge went missing would otherwise run on a silently short base
   (a silent default — ENGINE-CLAUDE.md).

Pure module — no I/O; Decimal end to end; the only rounding is inside
``apportion`` (SPEC §5.6 boundary 1) and Stage 5's markup quantization
(boundary 2).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Mapping

from allocation.algorithms.apportion import apportion
from allocation.algorithms.effective_dating import period_bounds, resolve_as_of
from allocation.algorithms.reciprocal import (
    ReciprocalSolverError,
    condensation_order,
    is_cyclic,
    solve_reciprocal,
)
from allocation.stages.stage4_allocate import stage4_allocate
from allocation.stages.stage5_markup import stage5_markup
from allocation.validation import rules

ZERO = Decimal("0")

POLICY_SINGLE = "single"
POLICY_PER_TIER = "perTier"

#: Separator for the composite (pool, recipient) apportionment keys of the
#: SCC-wide largest-remainder pass — any fixed total order satisfies the
#: SPEC §5.1 determinism convention.
_SEP = "\x1f"

#: The hub books a received charge to its intercompany services expense
#: account — mirrors Stage 6's posting-file expense hint (DECISIONS.md M5).
RECEIVED_COST_ELEMENT = "6910-Intercompany service charges"


def upstream_charge_ref(charge: Mapping[str, Any]) -> str:
    """Deterministic reference to the originating allocated charge — matches
    the Stage-6 ``charge_id`` scheme for allocated legs, so the received-line
    lineage and the charge ledger key by the same id (DECISIONS.md M5)."""
    return (f"CHG-{charge['period']}-{charge['pool_id']}-"
            f"{charge['recipient_entity_id']}")


def received_charge_cost_line(
    charge: Mapping[str, Any],
    destination_pool: Mapping[str, Any],
    hub_entity: Mapping[str, Any],
    posting_date: str,
) -> dict[str, Any]:
    """Schema-shaped 1_CostLine row for a charge received by a hub (SPEC §5.2):
    the tier-1 charge becomes a cost line in the hub's books at its gross
    (already-marked-up) amount, with full lineage to the originating charge
    via ``source_document_ref``."""
    ref = upstream_charge_ref(charge)
    gross: Decimal = charge["cost_recovered"] + charge["markup_amount"]
    return {
        "cost_line_id": f"CL-RCV-{ref}",
        "provider_entity_id": charge["recipient_entity_id"],  # the hub bears it
        "company_code": hub_entity["company_code"],
        "cost_center": f"CC-IC-{charge['pool_id']}",
        "cost_element": RECEIVED_COST_ELEMENT,
        "cost_nature": rules.COST_NATURE_RECEIVED,
        "function": destination_pool["service_line"],
        "amount_local": str(gross),
        "currency_local": charge["cost_currency"],
        "posting_date": posting_date,
        "fiscal_period": str(charge["period"]),
        "fiscal_year": str(charge["period"])[:4],
        "flow_type": "Service",
        "charge_method": "Indirect",
        "pass_through_flag": False,
        "pool_id": destination_pool["pool_id"],
        "source_document_ref": ref,
    }


def cascade_allocate(
    inputs: Mapping[str, Any],
    ref_data: Mapping[str, Any],
    config: Mapping[str, Any],
) -> dict[str, Any]:
    period = config.get("period")
    if not period:
        raise ValueError("config['period'] is required (SPEC §6)")
    policy = str(config.get("cascadeMarkupPolicy", POLICY_SINGLE))
    if policy not in (POLICY_SINGLE, POLICY_PER_TIER):
        raise ValueError(
            "config['cascadeMarkupPolicy'] must be 'single' (default) or "
            f"'perTier' (SPEC §5.2 / §6), got {policy!r}")
    solver_enabled = bool(config.get("reciprocalSolverEnabled", True))
    _, period_end = period_bounds(period)

    exceptions: list[dict] = []
    log: list[str] = []
    if policy == POLICY_PER_TIER:
        # V-C2 WARN — emitted on EVERY perTier run (SPEC §5.2 / §7).
        exceptions.extend(rules.v_c2_per_tier_margin_policy())

    # Working copies — stages never mutate their inputs; the cascade appends
    # received lines and grows pool bases on its own copies.
    work: dict[str, dict] = {}
    for pool in sorted(inputs["pools"], key=lambda p: p["pool_id"]):
        copy = dict(pool)
        copy["lines"] = [dict(l) for l in pool.get("lines") or ()]
        copy["line_ids"] = list(pool.get("line_ids") or ())
        work[copy["pool_id"]] = copy

    # Beneficiary populations as Stage 4 resolves them (SPEC §4 Stage 4).
    entities = {e["entity_id"]: e
                for e in resolve_as_of(ref_data.get("entities", ()), period)}
    active = {eid for eid, e in entities.items() if e.get("status") == "Active"}
    beneficiaries_by_pool: dict[str, set[str]] = {}
    for row in resolve_as_of(ref_data.get("participation", ()), period):
        if row.get("role") == "Beneficiary" and row["entity_id"] in active \
                and row["pool_id"] in work:
            beneficiaries_by_pool.setdefault(row["pool_id"], set()) \
                .add(row["entity_id"])

    pools_by_provider: dict[str, list[str]] = {}
    for pid in sorted(work):
        pools_by_provider.setdefault(
            work[pid]["provider_entity_id"], []).append(pid)

    # Graph: node = (provider, pool); edge P -> Q iff a beneficiary of P
    # provides Q (SPEC §5.2).
    edges: dict[str, set[str]] = {pid: set() for pid in work}
    for pid in work:
        for beneficiary in beneficiaries_by_pool.get(pid, ()):
            edges[pid].update(pools_by_provider.get(beneficiary, ()))

    blocked: set[str] = set()

    def block_with_downstream(pool_ids: list[str], why: str) -> None:
        """BLOCK the named pools and every pool downstream of them: a pool
        whose received charge went missing must not run on a silently short
        base (DECISIONS.md M5)."""
        queue = sorted(pool_ids)
        while queue:
            pid = queue.pop(0)
            if pid in blocked:
                continue
            blocked.add(pid)
            for downstream in sorted(edges.get(pid, ())):
                if downstream not in blocked:
                    log.append(
                        f"cascade: pool {downstream} withheld — upstream "
                        f"pool {pid} blocked ({why})")
                    queue.append(downstream)

    # ---- V-C3 gate + supplied exempt registration over INPUT lines ----------
    # Registry of received-charge lineage: GL-booked lines register via
    # ref_data (complete records only — an incomplete record IS missing
    # lineage); engine-synthesized lines register at creation below.
    registry: dict[str, dict] = {}
    for line_id, record in (ref_data.get("received_charge_lineage") or {}).items():
        if isinstance(record, Mapping) \
                and str(record.get("upstream_charge_ref") or "").strip() \
                and isinstance(record.get("markup_exempt"), bool):
            registry[str(line_id)] = dict(record)

    for pid in sorted(work):
        pool = work[pid]
        c3_excs = rules.v_c3_received_charge_lineage(pid, pool["lines"], registry)
        if c3_excs:
            exceptions.extend(c3_excs)
            block_with_downstream([pid], "V-C3")
            continue
        if policy != POLICY_SINGLE:
            continue  # perTier re-margins everything — no exempt component
        supplied_exempt = sum(
            (Decimal(line["amount_local"]) for line in pool["lines"]
             if line.get("cost_nature") == rules.COST_NATURE_RECEIVED
             and registry[line["cost_line_id"]]["markup_exempt"]),
            ZERO,
        )
        if supplied_exempt > ZERO:
            if supplied_exempt > pool["chargeable_base"]:
                # The benefit gate carved into the received component — the
                # exempt amount cannot exceed what is left to charge (V-B1's
                # combined-exclusions bound, read against the pool's own
                # cost — DECISIONS.md M5).
                exceptions.append(rules.exception(
                    "V-B1",
                    f"pool {pid}: received-charge exempt component "
                    f"{supplied_exempt} exceeds the chargeable base "
                    f"{pool['chargeable_base']} — exclusions cannot carve "
                    "into a received intercompany charge",
                    objects=[pid], pool_id=pid,
                ))
                block_with_downstream([pid], "V-B1")
                continue
            pool["markup_exempt_component"] = (
                pool.get("markup_exempt_component", ZERO) + supplied_exempt)

    order = condensation_order(sorted(work), edges)
    log.append(f"cascade[{period}]: run order {order} "
               f"(markup policy {policy!r})")

    ref5 = {"markup_policies": ref_data.get("markup_policies", ()),
            "entities": ref_data.get("entities", ())}

    pools_out: list[dict] = []
    allocations_flat: list[dict] = []
    charges_flat: list[dict] = []
    received_lines: list[dict] = []
    received_lineage: list[dict] = []

    def inject(charge: Mapping[str, Any]) -> None:
        """A priced allocated charge received by a downstream provider becomes
        a cost line in the hub pool (SPEC §5.2)."""
        recipient = charge["recipient_entity_id"]
        destinations = pools_by_provider.get(recipient, [])
        if not destinations:
            return  # the recipient provides nothing downstream
        ref = upstream_charge_ref(charge)
        if len(destinations) > 1:
            # Not exactly one determinate destination pool — the received
            # charge cannot be routed (mirrors the V-M1/V-K1 "exactly one"
            # reading; DECISIONS.md M5).
            for dest in destinations:
                exceptions.append(rules.exception(
                    "V-R1",
                    f"pool {dest}: received charge {ref} for provider "
                    f"{recipient} does not resolve to exactly one destination "
                    f"pool ({destinations}) — indeterminate cascade routing",
                    objects=[recipient, *destinations], pool_id=dest,
                ))
            block_with_downstream(destinations, "V-R1 indeterminate routing")
            return
        dest = destinations[0]
        if dest in blocked:
            return
        gross: Decimal = charge["cost_recovered"] + charge["markup_amount"]
        if gross == ZERO:
            log.append(f"cascade: zero received charge {ref} adds nothing to "
                       f"pool {dest} — no cost line synthesized")
            return
        hub_entity = entities[recipient]  # resolved — Stage 5 gated the leg
        if charge["cost_currency"] != hub_entity["functional_currency"]:
            exceptions.append(rules.exception(
                "V-R1",
                f"pool {dest}: received charge {ref} in "
                f"{charge['cost_currency']} cannot join the hub's "
                f"{hub_entity['functional_currency']} books — the stage-4 "
                "cascade path has no FX snapshot (v1 requires currency "
                "homogeneity along cascade edges, DECISIONS.md M5)",
                objects=[ref, dest], pool_id=dest,
            ))
            block_with_downstream([dest], "V-R1 cross-currency edge")
            return
        pool = work[dest]
        line = received_charge_cost_line(charge, pool, hub_entity, period_end)
        pool["lines"].append(line)
        pool["line_ids"].append(line["cost_line_id"])
        pool["total_pooled_cost"] = pool["total_pooled_cost"] + gross
        pool["chargeable_base"] = pool["chargeable_base"] + gross
        exempt = policy == POLICY_SINGLE
        if exempt:
            pool["markup_exempt_component"] = (
                pool.get("markup_exempt_component", ZERO) + gross)
        # Lineage registered at creation — V-C3 holds by construction.
        registry[line["cost_line_id"]] = {
            "upstream_charge_ref": ref, "markup_exempt": exempt}
        received_lines.append(line)
        received_lineage.append({
            "cost_line_id": line["cost_line_id"],
            "pool_id": dest,
            "upstream_charge_ref": ref,
            "upstream_pool_id": charge["pool_id"],
            "provider_entity_id": charge["provider_entity_id"],
            "recipient_entity_id": recipient,
            "period": str(charge["period"]),
            "amount": gross,
            "markup_exempt": exempt,
        })
        log.append(f"cascade: charge {ref} -> received cost line "
                   f"{line['cost_line_id']} in pool {dest} (gross {gross})")

    def price_and_emit(pools4: list[dict], group: list[str]) -> bool:
        """Stage-5 pricing for a group's stage-4-shaped pools; emits outputs
        and injects downstream. Returns False when the group blocked."""
        res5 = stage5_markup({"pools": pools4}, ref5, config)
        exceptions.extend(res5["exceptions"])
        log.extend(res5["log"])
        if res5["outputs"]["blocked_pool_ids"]:
            block_with_downstream(group, "stage-5 BLOCK")
            return False
        pools_out.extend(res5["outputs"]["pools"])
        charges_flat.extend(res5["outputs"]["charges"])
        for charge in res5["outputs"]["charges"]:
            if charge["charge_kind"] == "allocated":
                inject(charge)
        return True

    for group in order:
        members = list(group)
        if any(pid in blocked for pid in members):
            blocked.update(members)  # an SCC shares its members' fate
            continue

        if not is_cyclic(members, edges):
            # ---- acyclic node: plain Stage 4 then Stage 5 (SPEC §5.2) -------
            pid = members[0]
            res4 = stage4_allocate({"pools": [work[pid]]}, ref_data, config)
            exceptions.extend(res4["exceptions"])
            log.extend(res4["log"])
            if res4["outputs"]["blocked_pool_ids"]:
                block_with_downstream([pid], "stage-4 BLOCK")
                continue
            allocations_flat.extend(res4["outputs"]["allocations"])
            price_and_emit(res4["outputs"]["pools"], [pid])
            continue

        # ---- SCC: reciprocal simultaneous equations (SPEC §5.3) -------------
        if not solver_enabled:
            exceptions.extend(rules.v_c1_cycle_unsolvable(
                members, "the reciprocal solver is disabled "
                         "(config reciprocalSolverEnabled = false)"))
            block_with_downstream(members, "V-C1")
            continue

        # An entity providing two pools inside the cycle makes the internal
        # consumption shares indeterminate (DECISIONS.md M5).
        by_entity: dict[str, list[str]] = {}
        for pid in members:
            by_entity.setdefault(work[pid]["provider_entity_id"], []).append(pid)
        ambiguous = {e: ps for e, ps in by_entity.items() if len(ps) > 1}
        if ambiguous:
            for entity, pids in sorted(ambiguous.items()):
                for pid in pids:
                    exceptions.append(rules.exception(
                        "V-R1",
                        f"pool {pid}: provider {entity} provides {len(pids)} "
                        f"pools inside the reciprocal cycle {sorted(members)} "
                        "— internal consumption does not resolve to exactly "
                        "one pool",
                        objects=[entity, *pids], pool_id=pid,
                    ))
            block_with_downstream(members, "V-R1 ambiguous SCC provider")
            continue
        member_entities = set(by_entity)

        # Key resolution + the full V-K gate via Stage 4 over the members'
        # own bases (the per-pool allocations are intermediate and discarded
        # — the solved system replaces them).
        res4 = stage4_allocate(
            {"pools": [work[pid] for pid in members]}, ref_data, config)
        exceptions.extend(res4["exceptions"])
        log.extend(res4["log"])
        if res4["outputs"]["blocked_pool_ids"]:
            exceptions.extend(rules.v_c1_cycle_unsolvable(
                members,
                f"member pool(s) {res4['outputs']['blocked_pool_ids']} "
                "blocked at key resolution — the consumption matrix is "
                "incomplete"))
            block_with_downstream(members, "V-C1")
            continue
        s4_by_id = {p["pool_id"]: p for p in res4["outputs"]["pools"]}

        ratios_by_pool: dict[str, dict[str, Decimal]] = {}
        meta_by_pool: dict[str, dict[str, dict]] = {}
        for pid in members:
            allocs = s4_by_id[pid]["allocations"]
            ratios_by_pool[pid] = {
                a["recipient_entity_id"]: a["allocation_ratio"] for a in allocs}
            meta_by_pool[pid] = {
                a["recipient_entity_id"]: a for a in allocs}

        provider_of = {pid: work[pid]["provider_entity_id"] for pid in members}
        own_cost = {pid: work[pid]["chargeable_base"] for pid in members}
        consumption: dict[tuple[str, str], Decimal] = {}
        for j in members:
            for i in members:
                share = ratios_by_pool[j].get(provider_of[i], ZERO)
                if share > ZERO:
                    consumption[(j, i)] = share

        # A zero-base member short-circuited Stage 4 (no key resolved); it can
        # stay silent only if no internal charge flows INTO it — otherwise the
        # solved cost could not be redistributed (DECISIONS.md M5).
        stranded = sorted(
            i for i in members
            if s4_by_id[i].get("key_id") is None
            and any(consumption.get((j, i)) for j in members))
        if stranded:
            exceptions.extend(rules.v_c1_cycle_unsolvable(
                members,
                f"zero-base member pool(s) {stranded} receive internal "
                "charges but resolve no allocation key — the solved cost "
                "cannot be redistributed"))
            block_with_downstream(members, "V-C1")
            continue

        total_own = sum(own_cost.values(), ZERO)
        if total_own == ZERO:
            solved = {pid: ZERO for pid in members}
        else:
            try:
                solved = solve_reciprocal(own_cost, consumption)
            except ReciprocalSolverError as err:
                exceptions.extend(rules.v_c1_cycle_unsolvable(members, str(err)))
                block_with_downstream(members, "V-C1")
                continue

        # External legs: weight = S_j × share_j(r) for recipients OUTSIDE the
        # SCC. One SCC-wide largest-remainder apportionment of Σ C over the
        # weights → conservation (total in == total charged out) to the cent
        # by construction; tie-break over the composite (pool, recipient) key
        # ascending (SPEC §5.1).
        weights: dict[str, Decimal] = {}
        for j in members:
            for recipient, ratio in sorted(ratios_by_pool[j].items()):
                if recipient in member_entities:
                    continue
                weights[f"{j}{_SEP}{recipient}"] = solved[j] * ratio
        total_weight = sum(weights.values(), ZERO)
        if total_own > ZERO:
            # Mathematically Σ weights == Σ C (the system conserves cost);
            # V-K3 gating upstream makes a zero total here an engine bug.
            assert total_weight > ZERO
            allocated = apportion(
                total_own, {k: w / total_weight for k, w in weights.items()})
        else:
            allocated = {}

        scc_pools4: list[dict] = []
        scc_allocated = ZERO
        for j in members:
            pool4 = s4_by_id[j]
            out = dict(work[j])
            allocations: list[dict] = []
            for recipient, ratio in sorted(ratios_by_pool[j].items()):
                if recipient in member_entities:
                    continue
                cost = allocated.get(f"{j}{_SEP}{recipient}", ZERO)
                meta = meta_by_pool[j][recipient]
                allocation = {
                    "pool_id": j,
                    "provider_entity_id": provider_of[j],
                    "recipient_entity_id": recipient,
                    "period": period,
                    "key_id": pool4.get("key_id"),
                    "key_value_id": meta["key_value_id"],
                    "factor_value": meta["factor_value"],
                    "allocation_ratio": ratio,
                    "allocated_cost": cost,
                }
                if policy == POLICY_SINGLE:
                    # Markup once on the OWN cost component C_j × share_j(r)
                    # (SPEC §5.3, consistent with §5.2 "single").
                    allocation["markup_exempt_cost"] = cost - own_cost[j] * ratio
                allocations.append(allocation)
            total_allocated = sum((a["allocated_cost"] for a in allocations), ZERO)
            scc_allocated += total_allocated
            out.update(
                key_id=pool4.get("key_id"),
                total_factor_value=pool4.get("total_factor_value"),
                allocations=allocations,
                total_allocated=total_allocated,
                solved_cost=solved[j],
                reciprocal_scc=sorted(members),
                internal_consumption={
                    i: consumption[(j, i)] for i in members
                    if (j, i) in consumption},
            )
            scc_pools4.append(out)
            allocations_flat.extend(allocations)
        # Reciprocal conservation: total in == total charged out across the
        # SCC, exactly (SPEC §9.3 property; apportion guarantees the sum).
        assert scc_allocated == total_own
        log.append(f"cascade: SCC {sorted(members)} solved — own cost "
                   f"{total_own} charged out externally in full")
        price_and_emit(scc_pools4, members)

    log.append(
        f"cascade[{period}]: {len(pools_out)} pools priced, "
        f"{len(charges_flat)} charges, {len(received_lines)} received-charge "
        f"cost lines, {len(blocked)} pools blocked",
    )
    return {
        "outputs": {
            "pools": pools_out,
            "allocations": allocations_flat,
            "charges": charges_flat,
            "received_lines": received_lines,
            "received_lineage": received_lineage,
            "order": order,
            "blocked_pool_ids": sorted(blocked),
        },
        "exceptions": exceptions,
        "log": log,
    }
