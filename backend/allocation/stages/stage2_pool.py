"""Stage 2 — Pool (SPEC §4).

Pure function ``(inputs, ref_data, config) -> {"outputs", "exceptions", "log"}``.

inputs::

    {"classified_lines": [...]}     # Stage-1 output rows (schema-shaped)

ref_data::

    {"pools": [3_Pool rows]}

config::

    {"period": "YYYY-MM" | "YYYY",                       # required (SPEC §6)
     "scope": {"poolIds": [...], "providerEntityIds": [...]}  (optional,
               default all active pools — SPEC §6),
     "poolHomogeneityMaxCostCenters": int (optional, default 25 — V-P3)}

Behavior (SPEC §4 Stage 2): group classified lines into pools per 3_Pool
(resolved as-of the run period, status Active, scope-filtered), separating
three streams:

(a) **direct-charge** lines (``charge_method = Direct`` with
    ``traceable_recipient_id``) — bypass Stage-4 apportionment;
(b) **pass-through** lines (``pass_through_flag = TRUE``) — bypass markup,
    recharged at cost to the traceable recipient (V-P4); they never enter
    pool totals, so the pooled markup cannot reach them by construction;
(c) **poolable** lines — pool totals with full line-ID lineage.

Rules: V-P4 BLOCK (pass-through without recipient), V-P1 BLOCK (line with no
routable destination: missing/unknown pool, Direct without recipient),
V-P5 BLOCK (single provider per pool — foreign-provider lines, or a pool_id
resolving to multiple catalogue rows), V-P3 WARN (homogeneity drift).

A pool named by a BLOCK exception is withheld from ``outputs["pools"]``
(SPEC §7: BLOCK halts the run for the affected pool); in-scope active pools
with no lines are emitted with a zero total (zero-cost pool, SPEC §9.1).
Pool totals are ``Decimal`` (engine-internal full precision — adapters
serialize at the persistence boundary); line rows keep exact decimal strings.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Mapping

from allocation.algorithms.effective_dating import resolve_as_of
from allocation.validation import rules

_POOL_ATTRS = ("service_line", "characterization", "default_key_id",
               "direct_charge_flag")


def stage2_pool(
    inputs: Mapping[str, Any],
    ref_data: Mapping[str, Any],
    config: Mapping[str, Any],
) -> dict[str, Any]:
    period = config.get("period")
    if not period:
        raise ValueError("config['period'] is required (SPEC §6)")
    scope = config.get("scope") or {}
    pool_scope = set(scope.get("poolIds") or ())
    provider_scope = set(scope.get("providerEntityIds") or ())
    max_ccs = int(config.get("poolHomogeneityMaxCostCenters", 25))

    lines = sorted(inputs["classified_lines"],
                   key=lambda r: str(r.get("cost_line_id") or ""))
    exceptions: list[dict] = []
    log: list[str] = []

    # Pool catalogue as-of the run period, Active, scope-filtered (SPEC §6).
    in_scope = [
        p for p in resolve_as_of(ref_data["pools"], period)
        if p["status"] == "Active"
        and (not pool_scope or p["pool_id"] in pool_scope)
        and (not provider_scope or p["provider_entity_id"] in provider_scope)
    ]
    in_scope.sort(key=lambda p: p["pool_id"])
    pool_by_id: dict[str, dict] = {}
    blocked_pools: set[str] = set()
    for pool in in_scope:
        if pool["pool_id"] in pool_by_id:
            # V-P5 — a pool_id resolving to multiple catalogue rows as-of the
            # period cannot guarantee a single provider per pool (SPEC §3.3).
            exceptions.append(rules.exception(
                "V-P5",
                f"pool {pool['pool_id']}: multiple 3_Pool catalogue rows in "
                f"scope as-of {period} — v1 keeps exactly one provider per pool",
                objects=[pool["pool_id"]], pool_id=pool["pool_id"],
            ))
            blocked_pools.add(pool["pool_id"])
        else:
            pool_by_id[pool["pool_id"]] = pool

    direct_charges: list[dict] = []
    pass_through: list[dict] = []
    held_line_ids: list[str] = []
    lines_by_pool: dict[str, list[dict]] = {pid: [] for pid in pool_by_id}

    for line in lines:
        line_id = str(line.get("cost_line_id") or "?")
        # (b) pass-through stream — V-P4: traceable recipient required; at
        # cost, never marked up (these lines bypass pool totals entirely).
        if line.get("pass_through_flag"):
            p4_excs = rules.v_p4_pass_through_traceable(line)
            if p4_excs:
                exceptions.extend(p4_excs)
                held_line_ids.append(line_id)
                continue
            pass_through.append(dict(line))
            continue
        # (a) direct-charge stream — bypasses Stage-4 apportionment.
        if line["charge_method"] == "Direct":
            if not line.get("traceable_recipient_id"):
                # V-P1 — no traceable recipient: the line cannot be routed to
                # exactly one charging destination (DECISIONS.md M2).
                exceptions.append(rules.exception(
                    "V-P1",
                    f"direct-charge cost line {line_id} has no "
                    "traceable_recipient_id — cannot route to exactly one "
                    "destination",
                    objects=[line_id], pool_id=line.get("pool_id"),
                ))
                held_line_ids.append(line_id)
                continue
            direct_charges.append(dict(line))
            continue
        # (c) poolable stream.
        pool_id = line.get("pool_id")
        if pool_id is None:
            # V-P1 — a classified line must carry its pool (post Stage 1).
            exceptions.append(rules.exception(
                "V-P1",
                f"cost line {line_id} reached Stage 2 without a pool_id",
                objects=[line_id],
            ))
            held_line_ids.append(line_id)
            continue
        if pool_id in blocked_pools:
            held_line_ids.append(line_id)
            continue
        if pool_id not in pool_by_id:
            out_of_scope = (
                (pool_scope and pool_id not in pool_scope)
                or (provider_scope
                    and line.get("provider_entity_id") not in provider_scope)
            )
            if out_of_scope:
                log.append(f"stage2: line {line_id} (pool {pool_id}) outside "
                           "the run scope — skipped")
            else:
                # V-P1 — the assigned pool does not exist / is not active
                # as-of the period: not exactly one (live) pool.
                exceptions.append(rules.exception(
                    "V-P1",
                    f"cost line {line_id}: pool {pool_id!r} is not in the "
                    f"active 3_Pool catalogue as-of {period}",
                    objects=[line_id], pool_id=pool_id,
                ))
                held_line_ids.append(line_id)
            continue
        lines_by_pool[pool_id].append(line)

    pools_out: list[dict] = []
    for pool_id in sorted(pool_by_id):
        if pool_id in blocked_pools:
            continue
        pool = pool_by_id[pool_id]
        pool_lines = lines_by_pool[pool_id]
        # V-P5 — single provider per pool (line-level check).
        p5_excs = rules.v_p5_single_provider(pool, pool_lines)
        # V-P3 — homogeneity drift (WARN; pool continues).
        p3_excs = rules.v_p3_pool_homogeneity(pool_id, pool_lines,
                                              max_cost_centers=max_ccs)
        exceptions.extend(p5_excs + p3_excs)
        if p5_excs:
            blocked_pools.add(pool_id)
            log.append(f"stage2: pool {pool_id} withheld (V-P5 BLOCK)")
            continue
        total = sum((Decimal(l["amount_local"]) for l in pool_lines), Decimal(0))
        pools_out.append({
            "pool_id": pool_id,
            "provider_entity_id": pool["provider_entity_id"],
            "period": period,
            **{attr: pool[attr] for attr in _POOL_ATTRS},
            "total_pooled_cost": total,
            "line_ids": [l["cost_line_id"] for l in pool_lines],  # ascending
            "lines": [dict(l) for l in pool_lines],
        })

    log.append(
        f"stage2[{period}]: {len(pools_out)} pool totals "
        f"({sum(len(p['lines']) for p in pools_out)} poolable lines), "
        f"{len(direct_charges)} direct-charge, {len(pass_through)} pass-through, "
        f"{len(held_line_ids)} held, {len(blocked_pools)} pools blocked",
    )
    return {
        "outputs": {
            "pools": pools_out,
            "direct_charges": direct_charges,
            "pass_through": pass_through,
            "held_line_ids": held_line_ids,
            "blocked_pool_ids": sorted(blocked_pools),
        },
        "exceptions": exceptions,
        "log": log,
    }
