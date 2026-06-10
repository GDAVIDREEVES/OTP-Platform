"""Composable validation rules — SPEC §7 catalogue, M2 subset.

Implements the referential & schema rules (V-R1, V-R2, V-R3), the pooling &
mapping rules (V-P1..V-P5) and the benefit-test rules (V-B1..V-B3) as pure,
composable functions. The key/markup/cascade/recon families (V-K*, V-M*,
V-C*, V-X*) land with their stages in M3+.

Every fired rule is a plain dict::

    {"rule_id": "V-P2", "severity": "BLOCK" | "WARN",
     "message": str, "objects": [affected ids...], "pool_id": str | None}

Severity semantics (SPEC §7): ``BLOCK`` halts the run for the affected pool —
the emitting stage withholds that pool's outputs and holds affected lines;
``WARN`` goes on the exception report and the run continues. Rule IDs appear
in function names, docstrings and test names so the exception report maps 1:1
to the SPEC §7 catalogue (ENGINE-CLAUDE.md).

Pure module — no I/O; all amounts are ``decimal.Decimal`` (never floats).
Judgment calls are recorded in docs/allocation/DECISIONS.md (M2 section).
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping, Sequence

from allocation import validation
from allocation.generated import types as gen

BLOCK = "BLOCK"
WARN = "WARN"

ZERO = Decimal("0")
ONE = Decimal("1")

# Rule ID -> severity (SPEC §7). Single source for every emitted exception.
SEVERITY: dict[str, str] = {
    "V-R1": BLOCK,  # every FK in schema.json `references` must resolve
    "V-R2": BLOCK,  # fields validate against the generated schema (enums & types)
    "V-R3": BLOCK,  # amounts non-negative except explicit reversal rows
    "V-P1": BLOCK,  # every Service cost line maps to exactly one pool (post split)
    "V-P2": BLOCK,  # allocation_split_pct per cost center sums to 100%
    "V-P3": WARN,   # pool homogeneity drift (> N cost centers or > 1 function)
    "V-P4": BLOCK,  # pass-through lines: traceable recipient + never marked up
    "V-P5": BLOCK,  # single provider per pool (v1, SPEC §3.3)
    "V-B1": BLOCK,  # combined exclusions on a pool <= 100% of pool
    "V-B2": WARN,   # Management pool without a stewardship exclusion row
    "V-B3": BLOCK,  # every exclusion row has a non-empty, determinate basis
}


def exception(rule_id: str, message: str, *,
              objects: Iterable[Any] = (), pool_id: str | None = None) -> dict:
    """One fired rule for the exception report (SPEC §8.4)."""
    return {
        "rule_id": rule_id,
        "severity": SEVERITY[rule_id],
        "message": message,
        "objects": list(objects),
        "pool_id": pool_id,
    }


def blocks(exceptions: Iterable[Mapping[str, Any]]) -> list[dict]:
    return [dict(e) for e in exceptions if e["severity"] == BLOCK]


def fired(exceptions: Iterable[Mapping[str, Any]], rule_id: str) -> list[dict]:
    return [dict(e) for e in exceptions if e["rule_id"] == rule_id]


def blocked_pool_ids(exceptions: Iterable[Mapping[str, Any]]) -> list[str]:
    """Pools named by a BLOCK exception — their stage outputs are withheld."""
    return sorted({e["pool_id"] for e in exceptions
                   if e["severity"] == BLOCK and e.get("pool_id")})


# ----------------------------------------------------- referential & schema --


def v_r1_v_r2_schema_gate(
    sheet: str,
    rows: Sequence[Mapping[str, Any]],
    refs: validation.RefIndex | None = None,
) -> tuple[list[dict], set[int]]:
    """V-R1 / V-R2 BLOCK — schema gate over raw rows.

    Wraps the generated-metadata validator: FK-resolution failures map to
    V-R1; enum failures and every other type/shape failure (missing mandatory
    field, float on an amount, malformed decimal/date) map to V-R2 — read as
    "rows validate against the generated schema", the SPEC-named case being
    enums (DECISIONS.md M2). Returns (exceptions, indices of failing rows).
    """
    pk = gen.ENTITIES[sheet]["primary_key"]
    excs: list[dict] = []
    failed: set[int] = set()
    for i, row in enumerate(rows):
        errors = validation.validate_row(sheet, row, refs)
        if not errors:
            continue
        failed.add(i)
        rid = row.get(pk) or f"{sheet}[{i}]"
        for err in errors:
            # validation.validate_row phrases V-R1 failures as "does not
            # resolve" (allocation/validation/__init__.py — our own module).
            rule_id = "V-R1" if "does not resolve" in err else "V-R2"
            excs.append(exception(rule_id, err, objects=[rid]))
    return excs, failed


def v_r3_amounts_non_negative(
    sheet: str,
    rows: Sequence[Mapping[str, Any]],
    *,
    reversal_refs: frozenset[str] | set[str] = frozenset(),
) -> tuple[list[dict], set[int]]:
    """V-R3 BLOCK — amounts non-negative except explicit reversal rows.

    schema.json has no reversal flag, so a negative amount is accepted only
    when the row's ``source_document_ref`` is explicitly registered in
    ``reversal_refs`` (config["reversal_document_refs"]). No heuristic — a
    silent reversal convention would be a silent default (DECISIONS.md M2).
    Returns (exceptions, indices of failing rows).
    """
    amount_fields = [name for name, meta in gen.ENTITIES[sheet]["fields"].items()
                     if meta["type"] == "Decimal"]
    pk = gen.ENTITIES[sheet]["primary_key"]
    excs: list[dict] = []
    failed: set[int] = set()
    for i, row in enumerate(rows):
        if row.get("source_document_ref") in reversal_refs:
            continue  # explicit reversal row — negative amounts are its point
        for field in amount_fields:
            value = row.get(field)
            if not isinstance(value, str):
                continue  # absent or mis-typed: V-R2's job
            try:
                amount = Decimal(value)
            except InvalidOperation:
                continue  # malformed decimal: V-R2's job
            if amount < ZERO:
                rid = row.get(pk) or f"{sheet}[{i}]"
                excs.append(exception(
                    "V-R3",
                    f"{sheet}.{field}: negative amount {value} on {rid} is not a "
                    "registered reversal row (config reversal_document_refs)",
                    objects=[rid],
                ))
                failed.add(i)
    return excs, failed


# ------------------------------------------------------- pooling & mapping --


def split_percentages(mappings: Sequence[Mapping[str, Any]]) -> list[Decimal] | None:
    """``allocation_split_pct`` per mapping row, as decimal fractions.

    A single row with no pct means 100% (the schema marks the field
    Conditional — only impure cost centers split). Returns ``None`` when any
    pct on a multi-row mapping is missing or malformed (V-P2 fires).
    """
    if len(mappings) == 1 and mappings[0].get("allocation_split_pct") is None:
        return [ONE]
    pcts: list[Decimal] = []
    for m in mappings:
        raw = m.get("allocation_split_pct")
        if raw is None or not isinstance(raw, str):
            return None
        try:
            pcts.append(Decimal(raw))
        except InvalidOperation:
            return None
    return pcts


def v_p1_cost_center_mapping(
    line: Mapping[str, Any], mappings: Sequence[Mapping[str, Any]]
) -> list[dict]:
    """V-P1 BLOCK — every Service cost line maps to exactly one pool (post split).

    Fired when the as-of mapping set for (company_code, cost_center) is empty
    (unmapped cost centers -> exception queue), maps the same pool more than
    once, or contradicts a pre-assigned ``pool_id`` on the line (DECISIONS.md
    M2 — V-P1 covers every "not exactly one destination" failure).
    """
    lid = line.get("cost_line_id") or "?"
    cc = (line.get("company_code"), line.get("cost_center"))
    if not mappings:
        return [exception(
            "V-P1",
            f"cost line {lid}: cost center {cc} has no 2_CCMapping row in scope "
            "for the run period — unmapped cost centers go to the exception queue",
            objects=[lid],
        )]
    excs: list[dict] = []
    pools = [m["service_line_id"] for m in mappings]
    duplicated = sorted({p for p in pools if pools.count(p) > 1})
    if duplicated:
        excs.append(exception(
            "V-P1",
            f"cost line {lid}: cost center {cc} maps to {duplicated} more than "
            "once — post-split assignment is not exactly one pool per child",
            objects=[lid, *duplicated],
        ))
    pre_assigned = line.get("pool_id")
    if pre_assigned is not None:
        if len(mappings) > 1:
            excs.append(exception(
                "V-P1",
                f"cost line {lid}: pre-assigned pool_id {pre_assigned!r} on a "
                "split cost center is ambiguous",
                objects=[lid], pool_id=pre_assigned,
            ))
        elif pre_assigned != pools[0]:
            excs.append(exception(
                "V-P1",
                f"cost line {lid}: pre-assigned pool_id {pre_assigned!r} "
                f"contradicts mapping {mappings[0]['mapping_id']} -> {pools[0]!r}",
                objects=[lid], pool_id=pre_assigned,
            ))
    return excs


def v_p2_splits_sum_to_100(
    company_code: str, cost_center: str, mappings: Sequence[Mapping[str, Any]]
) -> list[dict]:
    """V-P2 BLOCK — ``allocation_split_pct`` per cost center sums to 100%.

    Splits are decimal fractions (DECISIONS.md M1: "0.8" = 80%); each split
    must be positive and the set must sum to exactly 1.
    """
    if not mappings:
        return []  # unmapped cost center is V-P1's territory
    ids = [m["mapping_id"] for m in mappings]
    cc = (company_code, cost_center)
    pcts = split_percentages(mappings)
    if pcts is None:
        return [exception(
            "V-P2",
            f"cost center {cc}: allocation_split_pct missing or malformed on a "
            "multi-pool mapping — splits cannot sum to 100%",
            objects=ids,
        )]
    excs: list[dict] = []
    if any(p <= ZERO for p in pcts):
        excs.append(exception(
            "V-P2",
            f"cost center {cc}: non-positive allocation_split_pct "
            f"{[str(p) for p in pcts]}",
            objects=ids,
        ))
    total = sum(pcts, ZERO)
    if total != ONE:
        excs.append(exception(
            "V-P2",
            f"cost center {cc}: allocation_split_pct sums to {total}, not 100%",
            objects=ids,
        ))
    return excs


def v_p3_pool_homogeneity(
    pool_id: str,
    lines: Sequence[Mapping[str, Any]],
    *,
    max_cost_centers: int = 25,
) -> list[dict]:
    """V-P3 WARN — pool homogeneity drift: a pool receiving lines from > N
    (default 25) distinct cost centers or > 1 function (SPEC §7)."""
    cost_centers = sorted({(l["company_code"], l["cost_center"]) for l in lines})
    functions = sorted({l["function"] for l in lines})
    excs: list[dict] = []
    if len(cost_centers) > max_cost_centers:
        excs.append(exception(
            "V-P3",
            f"pool {pool_id}: {len(cost_centers)} distinct cost centers exceed "
            f"the homogeneity threshold of {max_cost_centers}",
            objects=[f"{c}/{cc}" for c, cc in cost_centers], pool_id=pool_id,
        ))
    if len(functions) > 1:
        excs.append(exception(
            "V-P3",
            f"pool {pool_id}: constituent lines carry {len(functions)} functions "
            f"{functions} — a homogeneous pool serves one service line",
            objects=functions, pool_id=pool_id,
        ))
    return excs


def v_p4_pass_through_traceable(line: Mapping[str, Any]) -> list[dict]:
    """V-P4 BLOCK — pass-through lines must have ``traceable_recipient_id`` and
    must never receive markup.

    The recipient half is enforced here (Stage 2 routing). The no-markup half
    holds by construction at M2 — pass-through lines never enter pool totals —
    and is re-enforced at Stage 5 via the Pass-through 0% regime (V-M2, M4).
    """
    if line.get("pass_through_flag") and not line.get("traceable_recipient_id"):
        lid = line.get("cost_line_id") or "?"
        return [exception(
            "V-P4",
            f"pass-through cost line {lid}: traceable_recipient_id missing — "
            "a disbursement advanced for a recipient cannot be recharged at cost",
            objects=[lid],
        )]
    return []


def v_p5_single_provider(
    pool_row: Mapping[str, Any], lines: Sequence[Mapping[str, Any]]
) -> list[dict]:
    """V-P5 BLOCK — single provider per pool (v1 constraint, SPEC §3.3).

    Multi-provider needs are modelled as separate pools per provider; a cost
    line from any other provider compromises the pool total.
    """
    pool_id = pool_row["pool_id"]
    provider = pool_row["provider_entity_id"]
    foreign = sorted({l["provider_entity_id"] for l in lines} - {provider})
    if foreign:
        return [exception(
            "V-P5",
            f"pool {pool_id} (provider {provider}): received cost lines from "
            f"other provider(s) {foreign} — model multi-provider needs as "
            "separate pools per provider",
            objects=foreign, pool_id=pool_id,
        )]
    return []


# ------------------------------------------------------------ benefit test --


def v_b1_combined_exclusions(
    pool_id: str,
    original_total: Decimal,
    pcts: Sequence[Decimal],
    total_exclusions: Decimal,
) -> list[dict]:
    """V-B1 BLOCK — combined exclusions on a pool <= 100% of the pool.

    Percentage carve-outs apply to the ORIGINAL pool total (non-compounding,
    SPEC §4 Stage 3), so the bound is sum(pct) <= 100% and the combined amount
    within [0, original total]. Each pct must itself lie in [0, 1] — a
    negative carve-out would inflate the base (DECISIONS.md M2).
    """
    excs: list[dict] = []
    out_of_range = [str(p) for p in pcts if p < ZERO or p > ONE]
    if out_of_range:
        excs.append(exception(
            "V-B1",
            f"pool {pool_id}: exclusion_pct outside [0%, 100%]: {out_of_range}",
            objects=out_of_range, pool_id=pool_id,
        ))
    pct_sum = sum(pcts, ZERO)
    if pct_sum > ONE:
        excs.append(exception(
            "V-B1",
            f"pool {pool_id}: percentage exclusions sum to {pct_sum} of the "
            "original pool total — combined exclusions exceed 100%",
            objects=[str(pct_sum)], pool_id=pool_id,
        ))
    if total_exclusions < ZERO or total_exclusions > original_total:
        excs.append(exception(
            "V-B1",
            f"pool {pool_id}: combined exclusions {total_exclusions} outside "
            f"[0, pool total {original_total}]",
            objects=[str(total_exclusions)], pool_id=pool_id,
        ))
    return excs


def v_b2_management_pool_without_stewardship(
    pool_id: str,
    service_line: str,
    original_total: Decimal,
    exclusion_rows: Sequence[Mapping[str, Any]],
) -> list[dict]:
    """V-B2 WARN — pool with ``service_line`` in {Management} and no stewardship
    exclusion row (likely missing carve-out, SPEC §7).

    Zero-cost pools are skipped — with nothing pooled there is no carve-out to
    miss, and an out-of-period Management pool would otherwise warn on every
    scoped run (DECISIONS.md M2).
    """
    if service_line != "Management" or original_total <= ZERO:
        return []
    if any(r.get("exclusion_type") == "Stewardship" for r in exclusion_rows):
        return []
    return [exception(
        "V-B2",
        f"pool {pool_id}: Management service line with no stewardship exclusion "
        "row in scope — likely missing shareholder-activity carve-out "
        "(OECD TPG 7.9-7.10)",
        objects=[pool_id], pool_id=pool_id,
    )]


def v_b3_exclusion_basis(row: Mapping[str, Any]) -> list[dict]:
    """V-B3 BLOCK — every exclusion row has a non-empty ``basis_rationale``.

    A row must also carry exactly one of ``exclusion_pct`` /
    ``exclusion_amount`` ("Use pct OR amount", schema 5_Exclusions key note) —
    both or neither leaves the exclusion's basis indeterminate, which this
    rule treats as an undocumented basis (DECISIONS.md M2).
    """
    rid = row.get("exclusion_id") or "?"
    pool_id = row.get("pool_id")
    excs: list[dict] = []
    if not str(row.get("basis_rationale") or "").strip():
        excs.append(exception(
            "V-B3",
            f"exclusion {rid}: basis_rationale is empty — every exclusion needs "
            "a documented justification",
            objects=[rid], pool_id=pool_id,
        ))
    has_pct = row.get("exclusion_pct") is not None
    has_amount = row.get("exclusion_amount") is not None
    if has_pct == has_amount:
        which = "both" if has_pct else "neither"
        excs.append(exception(
            "V-B3",
            f"exclusion {rid}: {which} of exclusion_pct / exclusion_amount set — "
            "the carve-out basis must be exactly one of the two",
            objects=[rid], pool_id=pool_id,
        ))
    return excs
