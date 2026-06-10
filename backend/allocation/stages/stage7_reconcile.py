"""Stage 7 — Reconcile (SPEC §4; M6 scope).

Pure function ``(inputs, ref_data, config) -> {"outputs", "exceptions", "log"}``.

inputs::

    {"pools": [...],                 # Stage-5 priced pool dicts (Decimal)
     "true_up_by_pool": {pool_id: {"delta_gross": Decimal,
                                   "actual_gross": Decimal}}}   # optional —
                                     # supplied by the true-up run only

ref_data: unused (the recon is a pure tie-out over the priced pools).

config::

    {"period": "YYYY-MM" | "YYYY"}   # required (SPEC §6)

Behavior (SPEC §4 Stage 7), per (pool, provider, period) in ascending pool_id
order — sheet 11 row per pool:

    total_pooled_cost − total_exclusions − total_cost_recovered
        = unallocated_residual

- ``recon_status`` is **Balanced iff the residual is exactly zero** AFTER
  largest-remainder apportionment — a nonzero residual is a logic or
  participation gap, not rounding (V-X1 BLOCK; v1 hard zero per SPEC §6
  ``unallocatedResidualTolerance: 0``).
- V-X2 BLOCK — Σ charges out (cost component) == chargeable base exactly.
  Acyclic pools tie per pool; reciprocal SCC members tie at GROUP grain
  (inside a cycle the per-pool ledger total differs from the pool's own base
  by design — DECISIONS.md M5 #54): when the group ties, each member's
  ``total_cost_recovered`` reports its chargeable base (its cost is fully
  recovered through the reciprocal redistribution — conservation is asserted
  by the solver), so every member's residual is genuinely zero.
- The recon covers the POOLED stream only: direct-charge and pass-through
  legs are traceable-line recharges that never enter pool totals and cannot
  create residual by construction (DECISIONS.md M6). Markup/charged-out sums
  are recomputed here from the pools' allocated legs — never trusted from
  pool-level totals.
- All recon amounts are in the provider's booking currency (the Stage-5
  pre-FX level): V-X2's exact tie is only meaningful before conversion, and
  a per-pool row sums a single currency regardless of the run's
  ``chargeCurrency`` mode (DECISIONS.md M6).
- ``true_up_delta`` is recorded from ``inputs["true_up_by_pool"]`` (SPEC
  §5.4 "record true_up_delta on 11_Recon"); the V-X3 threshold WARN itself is
  fired by ``algorithms/trueup.py``, which owns the delta computation.

outputs::

    recon:            engine-internal recon dicts (Decimal amounts) WITHOUT
                      run identity — recon_id / run_id / run_timestamp are
                      stamped by the orchestrator at persistence, mirroring
                      the Stage-6 contract (engine purity; DECISIONS.md M4
                      #41). Field names otherwise match sheet 11.
    blocked_pool_ids: pools named by V-X BLOCKs (their recon rows are still
                      emitted — the recon row IS the evidence of the break;
                      the orchestrator fails the run, SPEC §4 "atomic").
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Mapping

from allocation.validation import rules

ZERO = Decimal("0")


def _allocated_sums(pool: Mapping[str, Any]) -> tuple[Decimal, Decimal, Decimal]:
    """(cost, markup, gross) over the pool's ALLOCATED ledger legs — the
    pooled stream the recon ties out (direct/pass-through legs excluded)."""
    legs = [c for c in pool.get("charges") or ()
            if c.get("charge_kind") == "allocated"]
    cost = sum((c["cost_recovered"] for c in legs), ZERO)
    markup = sum((c["markup_amount"] for c in legs), ZERO)
    gross = sum((c["gross_charge"] for c in legs), ZERO)
    return cost, markup, gross


def stage7_reconcile(
    inputs: Mapping[str, Any],
    ref_data: Mapping[str, Any],
    config: Mapping[str, Any],
) -> dict[str, Any]:
    period = config.get("period")
    if not period:
        raise ValueError("config['period'] is required (SPEC §6)")
    true_up_by_pool: Mapping[str, Mapping[str, Any]] = (
        inputs.get("true_up_by_pool") or {})

    pools = sorted(inputs["pools"], key=lambda p: p["pool_id"])
    by_id = {p["pool_id"]: p for p in pools}

    exceptions: list[dict] = []
    log: list[str] = []
    blocked: set[str] = set()

    # ---- V-X2: ledger cost component == chargeable base ---------------------
    # Acyclic pools tie per pool; SCC members tie at group grain. A group that
    # ties lets each member report full recovery of its own base (the solver
    # conserves cost across the cycle — asserted at solve time, M5 #51).
    sums = {pid: _allocated_sums(by_id[pid]) for pid in by_id}
    group_ties: dict[str, bool] = {}
    seen_groups: set[tuple[str, ...]] = set()
    for pool in pools:
        pid = pool["pool_id"]
        members = tuple(pool.get("reciprocal_scc") or ())
        if not members:
            base: Decimal = pool["chargeable_base"]
            x2 = rules.v_x2_charges_out_equal_chargeable_base(
                [pid], base, sums[pid][0])
            exceptions.extend(x2)
            group_ties[pid] = not x2
            continue
        if members in seen_groups:
            continue
        seen_groups.add(members)
        present = [m for m in members if m in by_id]
        group_base = sum((by_id[m]["chargeable_base"] for m in present), ZERO)
        group_cost = sum((sums[m][0] for m in present), ZERO)
        x2 = rules.v_x2_charges_out_equal_chargeable_base(
            present, group_base, group_cost)
        exceptions.extend(x2)
        for m in present:
            group_ties[m] = not x2

    # ---- recon rows (sheet 11), ascending pool_id ----------------------------
    recon: list[dict] = []
    for pool in pools:
        pid = pool["pool_id"]
        cost, markup, gross = sums[pid]
        in_scc = bool(pool.get("reciprocal_scc"))
        if in_scc and group_ties.get(pid, False):
            # The member's own cost is fully recovered through the reciprocal
            # redistribution (group conservation holds): report the base, so
            # the row's residual is the true zero (DECISIONS.md M6).
            recovered: Decimal = pool["chargeable_base"]
        else:
            recovered = cost
        residual = (pool["total_pooled_cost"] - pool["total_exclusions"]
                    - recovered)

        # V-X1 — Balanced iff the residual is EXACTLY zero (v1 hard zero).
        x1 = rules.v_x1_unallocated_residual(pid, residual)
        exceptions.extend(x1)
        balanced = not x1
        if not balanced or not group_ties.get(pid, True):
            blocked.add(pid)

        tu = true_up_by_pool.get(pid)
        row: dict[str, Any] = {
            "pool_id": pid,
            "provider_entity_id": pool["provider_entity_id"],
            "period": str(period),
            "total_pooled_cost": pool["total_pooled_cost"],
            "total_exclusions": pool["total_exclusions"],
            "total_cost_recovered": recovered,
            "total_markup": markup,
            "total_charged_out": gross,
            "unallocated_residual": residual,
            "true_up_delta": tu["delta_gross"] if tu else None,
            "recon_status": "Balanced" if balanced else "Break",
            "break_amount": None if balanced else abs(residual),
        }
        recon.append(row)

    orphaned = sorted(set(true_up_by_pool) - set(by_id))
    if orphaned:
        log.append(f"stage7: true-up deltas for pools not in this run's "
                   f"inputs: {orphaned}")
    balanced_n = sum(1 for r in recon if r["recon_status"] == "Balanced")
    log.append(
        f"stage7[{period}]: {len(recon)} recon rows "
        f"({balanced_n} Balanced, {len(recon) - balanced_n} Break), "
        f"{len(blocked)} pools blocked",
    )
    return {
        "outputs": {
            "recon": recon,
            "blocked_pool_ids": sorted(blocked),
        },
        "exceptions": exceptions,
        "log": log,
    }
