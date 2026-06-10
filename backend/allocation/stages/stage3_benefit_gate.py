"""Stage 3 — Benefit-test gate (SPEC §4).

Pure function ``(inputs, ref_data, config) -> {"outputs", "exceptions", "log"}``.

inputs::

    {"pools": [...]}                # Stage-2 pool totals (with lines)

ref_data::

    {"exclusions": [5_Exclusions rows]}

config::

    {"period": "YYYY-MM" | "YYYY"}  # required (SPEC §6)

Behavior (SPEC §4 Stage 3): apply 5_Exclusions per pool, resolved as-of the
run period (SPEC §5.5), in ascending exclusion_id order (determinism):

- **percentage carve-outs** apply to the ORIGINAL pool total — multiple pct
  exclusions never compound — and reduce the pool pro-rata across constituent
  lines (lineage preserved: the ledger entry carries per-line allocations
  whose exact Decimal sum is the exclusion amount);
- **fixed amounts** deduct from the pool at pool level with their documented
  basis;
- combined exclusions must stay within 100% of the pool (V-B1 BLOCK); every
  row needs a non-empty, determinate basis (V-B3 BLOCK; "Use pct OR amount");
  negative exclusion amounts are rejected (V-R3 BLOCK); a Management pool
  with cost but no stewardship carve-out warns (V-B2 WARN).

Exclusion math is full-precision Decimal — it is NOT one of SPEC §5.6's three
rounding boundaries, so the chargeable base is never quantized here. A pool
that is 100% excluded yields chargeable_base == 0 and flows on (SPEC §9.1
edge case); a pool named by a BLOCK exception is withheld from the outputs.

outputs::

    pools:            Stage-2 pool dicts + {total_exclusions: Decimal,
                      chargeable_base: Decimal, exclusions_applied: [ids]}
    exclusion_ledger: [{exclusion_id, pool_id, exclusion_type,
                      basis_rationale, pct: Decimal|None, amount: Decimal,
                      line_allocations: [{cost_line_id, amount: Decimal}]}]
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Mapping

from allocation.algorithms.effective_dating import resolve_as_of
from allocation.validation import rules

ZERO = Decimal("0")


def stage3_benefit_gate(
    inputs: Mapping[str, Any],
    ref_data: Mapping[str, Any],
    config: Mapping[str, Any],
) -> dict[str, Any]:
    period = config.get("period")
    if not period:
        raise ValueError("config['period'] is required (SPEC §6)")

    pools = sorted(inputs["pools"], key=lambda p: p["pool_id"])
    exclusions_in_scope = sorted(resolve_as_of(ref_data["exclusions"], period),
                                 key=lambda r: r["exclusion_id"])
    by_pool: dict[str, list[dict]] = {}
    for row in exclusions_in_scope:
        by_pool.setdefault(row["pool_id"], []).append(row)

    exceptions: list[dict] = []
    log: list[str] = []
    pools_out: list[dict] = []
    exclusion_ledger: list[dict] = []
    blocked_pools: set[str] = set()
    pool_ids_seen = {p["pool_id"] for p in pools}

    for pool in pools:
        pool_id = pool["pool_id"]
        rows = by_pool.get(pool_id, [])

        # V-B3 — non-empty, determinate basis on every exclusion row;
        # V-R3 — exclusion amounts must be non-negative.
        row_excs: list[dict] = []
        for row in rows:
            row_excs.extend(rules.v_b3_exclusion_basis(row))
        r3_excs, _ = rules.v_r3_amounts_non_negative("5_Exclusions", rows)
        row_excs.extend(r3_excs)
        if row_excs:
            exceptions.extend(row_excs)
            blocked_pools.add(pool_id)
            log.append(f"stage3: pool {pool_id} withheld "
                       "(malformed exclusion rows — BLOCK)")
            continue

        original_total: Decimal = pool["total_pooled_cost"]
        entries: list[dict] = []
        pcts: list[Decimal] = []
        total_exclusions = ZERO
        for row in rows:
            pct = (Decimal(row["exclusion_pct"])
                   if row.get("exclusion_pct") is not None else None)
            if pct is not None:
                pcts.append(pct)
                # Pct carve-outs reduce the pool pro-rata across constituent
                # lines on their ORIGINAL amounts (non-compounding); the
                # exclusion amount is the exact sum of the line allocations.
                line_allocations = [
                    {"cost_line_id": line["cost_line_id"],
                     "amount": Decimal(line["amount_local"]) * pct}
                    for line in pool["lines"]
                ]
                amount = sum((a["amount"] for a in line_allocations), ZERO)
            else:
                amount = Decimal(row["exclusion_amount"])
                line_allocations = []  # fixed amounts are pool-level
            total_exclusions += amount
            entries.append({
                "exclusion_id": row["exclusion_id"],
                "pool_id": pool_id,
                "exclusion_type": row["exclusion_type"],
                "basis_rationale": row["basis_rationale"],
                "pct": pct,
                "amount": amount,
                "line_allocations": line_allocations,
            })

        # V-B1 — combined exclusions within 100% of the original pool total.
        b1_excs = rules.v_b1_combined_exclusions(
            pool_id, original_total, pcts, total_exclusions)
        # V-B2 — Management pool with cost but no stewardship carve-out (WARN).
        b2_excs = rules.v_b2_management_pool_without_stewardship(
            pool_id, pool["service_line"], original_total, rows)
        exceptions.extend(b1_excs + b2_excs)
        if b1_excs:
            blocked_pools.add(pool_id)
            log.append(f"stage3: pool {pool_id} withheld (V-B1 BLOCK)")
            continue

        exclusion_ledger.extend(entries)
        out = dict(pool)
        out["total_exclusions"] = total_exclusions
        out["chargeable_base"] = original_total - total_exclusions
        out["exclusions_applied"] = [e["exclusion_id"] for e in entries]
        pools_out.append(out)

    orphaned = sorted(set(by_pool) - pool_ids_seen)
    if orphaned:
        log.append(f"stage3: exclusions for pools not in this run's inputs "
                   f"(out of scope or blocked upstream): {orphaned}")
    log.append(
        f"stage3[{period}]: {len(pools_out)} chargeable bases emitted, "
        f"{len(exclusion_ledger)} exclusion ledger entries, "
        f"{len(blocked_pools)} pools blocked",
    )
    return {
        "outputs": {
            "pools": pools_out,
            "exclusion_ledger": exclusion_ledger,
            "blocked_pool_ids": sorted(blocked_pools),
        },
        "exceptions": exceptions,
        "log": log,
    }
