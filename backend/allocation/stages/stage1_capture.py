"""Stage 1 — Capture & classify (SPEC §4).

Pure function ``(inputs, ref_data, config) -> {"outputs", "exceptions", "log"}``.

inputs::

    {"cost_lines": [1_CostLine rows]}        # raw, schema-shaped (strings)

ref_data (seed rows, already past the M1 seed gate)::

    {"cc_mapping": [...], "pools": [...], "entities": [...],
     "key_defs": [...] (optional)}

config::

    {"period": "YYYY-MM" | "YYYY",                       # required (SPEC §6)
     "reversal_document_refs": iterable[str] (optional)} # V-R3 registrations

Behavior (SPEC §4 Stage 1):

1. **Schema gate** — V-R1 (FK resolution), V-R2 (enums + types/shape), V-R3
   (non-negative amounts unless the row is a registered reversal). Failing
   lines are HELD: listed in ``held_line_ids`` and excluded from every
   downstream output.
2. **flow_type gate** — non-``Service`` flows route to the ``excluded_flows``
   holding output with a reason (the engine classifies and rejects goods/
   royalty/CSA/financing flows, SPEC §1 non-goals). No exception: rejection
   is the designed behavior, not an error.
3. **Function/pool derivation** via 2_CCMapping, joined on the natural key
   (company_code, cost_center) as-of the run period (SPEC §5.5). V-P1 BLOCK:
   unmapped cost center / duplicate pool target / pre-assigned ``pool_id``
   conflict. V-P2 BLOCK: ``allocation_split_pct`` per cost center sums to
   100%. Splits divide the line into child lines whose amounts sum EXACTLY
   to the parent: each child floored at the cent (toward zero), the entire
   remainder assigned to the largest split, tie-break ascending mapping_id
   (SPEC §4 Stage 1 + §5.1 determinism convention).

outputs::

    classified_lines: schema-shaped 1_CostLine rows with pool_id + function
                      set from the mapping; split children carry the id
                      "{parent_id}::{pool_id}" and exact decimal-string
                      amounts that sum to the parent
    lineage:          one row per classified line: {cost_line_id,
                      source_cost_line_id, mapping_id, split_pct, amount}
    excluded_flows:   [{cost_line_id, flow_type, reason, line}]  (holding)
    held_line_ids:    lines blocked by V-R*/V-P* rules (exception queue)

Lines are processed in ascending cost_line_id order (determinism). Money is
Decimal end to end; emitted amounts are exact decimal strings. The M6
orchestrator escalates BLOCK exceptions to run/pool gating.
"""

from __future__ import annotations

from decimal import ROUND_DOWN, Decimal
from typing import Any, Mapping

from allocation import validation
from allocation.algorithms.effective_dating import resolve_as_of
from allocation.validation import rules

CENT = Decimal("0.01")


def _require_period(config: Mapping[str, Any]) -> str:
    period = config.get("period")
    if not period:
        raise ValueError("config['period'] is required (SPEC §6)")
    return str(period)


def stage1_capture_and_classify(
    inputs: Mapping[str, Any],
    ref_data: Mapping[str, Any],
    config: Mapping[str, Any],
) -> dict[str, Any]:
    period = _require_period(config)
    reversal_refs = frozenset(config.get("reversal_document_refs", ()))

    # Determinism: ascending cost_line_id (SPEC §5.1 tie-break convention).
    lines = sorted(inputs["cost_lines"],
                   key=lambda r: str(r.get("cost_line_id") or ""))

    refs = validation.build_ref_index({
        "8_Entity": ref_data.get("entities", ()),
        "3_Pool": ref_data.get("pools", ()),
        "2_CCMapping": ref_data.get("cc_mapping", ()),
        "6_KeyDef": ref_data.get("key_defs", ()),
    })

    # --- schema gate: V-R1 (FK), V-R2 (enum/type), V-R3 (negative amounts) ---
    schema_excs, schema_failed = rules.v_r1_v_r2_schema_gate("1_CostLine", lines, refs)
    r3_excs, r3_failed = rules.v_r3_amounts_non_negative(
        "1_CostLine", lines, reversal_refs=reversal_refs)
    exceptions: list[dict] = schema_excs + r3_excs
    held_idx = schema_failed | r3_failed

    # --- mapping resolution as-of the run period (SPEC §5.5) -----------------
    mappings_in_scope = sorted(resolve_as_of(ref_data["cc_mapping"], period),
                               key=lambda m: m["mapping_id"])
    by_cc: dict[tuple[str, str], list[dict]] = {}
    for m in mappings_in_scope:
        by_cc.setdefault((m["company_code"], m["cost_center"]), []).append(m)

    classified: list[dict] = []
    lineage: list[dict] = []
    excluded_flows: list[dict] = []
    held_line_ids: list[str] = []
    split_parents = 0
    # V-P2 is a per-cost-center rule: evaluate once per (company_code, cc).
    p2_by_cc: dict[tuple[str, str], list[dict]] = {}

    for i, line in enumerate(lines):
        line_id = str(line.get("cost_line_id") or f"1_CostLine[{i}]")
        if i in held_idx:
            held_line_ids.append(line_id)
            continue

        # flow_type gate: classify-and-reject non-Service flows (SPEC §1).
        if line["flow_type"] != "Service":
            excluded_flows.append({
                "cost_line_id": line_id,
                "flow_type": line["flow_type"],
                "reason": (
                    f"flow_type {line['flow_type']!r} is out of scope for the "
                    "services pipeline — routed to the excluded_flows holding "
                    "table (SPEC §1 non-goals)"
                ),
                "line": dict(line),
            })
            continue

        cc_key = (line["company_code"], line["cost_center"])
        mappings = by_cc.get(cc_key, [])

        # V-P1 — exactly one pool per line (post split).
        p1_excs = rules.v_p1_cost_center_mapping(line, mappings)
        # V-P2 — splits per cost center sum to 100% (fire once per CC).
        if cc_key not in p2_by_cc:
            p2_by_cc[cc_key] = rules.v_p2_splits_sum_to_100(
                cc_key[0], cc_key[1], mappings)
            exceptions.extend(p2_by_cc[cc_key])
        if p1_excs or p2_by_cc[cc_key]:
            exceptions.extend(p1_excs)
            held_line_ids.append(line_id)
            continue

        pcts = rules.split_percentages(mappings)
        assert pcts is not None  # guaranteed: V-P2 passed
        amount = Decimal(line["amount_local"])

        if len(mappings) == 1:
            child = dict(line)
            child["pool_id"] = mappings[0]["service_line_id"]
            child["function"] = mappings[0]["function"]
            classified.append(child)
            lineage.append({
                "cost_line_id": line_id,
                "source_cost_line_id": line_id,
                "mapping_id": mappings[0]["mapping_id"],
                "split_pct": str(pcts[0]),
                "amount": child["amount_local"],
            })
            continue

        # allocation_split_pct split: children sum EXACTLY to the parent —
        # floor at the cent, remainder to the largest split (tie-break
        # ascending mapping_id; `max` keeps the first maximum of the
        # mapping_id-sorted list). SPEC §4 Stage 1.
        split_parents += 1
        raw = [amount * pct for pct in pcts]
        child_amounts = [r.quantize(CENT, rounding=ROUND_DOWN) for r in raw]
        residual = amount - sum(child_amounts, Decimal(0))
        largest = max(range(len(pcts)), key=lambda j: pcts[j])
        child_amounts[largest] += residual
        assert sum(child_amounts, Decimal(0)) == amount  # exact-sum contract
        for mapping, pct, child_amount in zip(mappings, pcts, child_amounts):
            child = dict(line)
            child["cost_line_id"] = f"{line_id}::{mapping['service_line_id']}"
            child["pool_id"] = mapping["service_line_id"]
            child["function"] = mapping["function"]
            child["amount_local"] = str(child_amount)
            classified.append(child)
            lineage.append({
                "cost_line_id": child["cost_line_id"],
                "source_cost_line_id": line_id,
                "mapping_id": mapping["mapping_id"],
                "split_pct": str(pct),
                "amount": child["amount_local"],
            })

    log = [
        f"stage1[{period}]: {len(lines)} lines in -> {len(classified)} classified "
        f"({split_parents} split parents), {len(excluded_flows)} non-Service "
        f"flows excluded, {len(held_line_ids)} held by BLOCK rules",
    ]
    return {
        "outputs": {
            "classified_lines": classified,
            "lineage": lineage,
            "excluded_flows": excluded_flows,
            "held_line_ids": held_line_ids,
        },
        "exceptions": exceptions,
        "log": log,
    }
