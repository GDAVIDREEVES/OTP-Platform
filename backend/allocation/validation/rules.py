"""Composable validation rules — the full SPEC §7 catalogue.

Implements the referential & schema rules (V-R1, V-R2, V-R3), the pooling &
mapping rules (V-P1..V-P5), the benefit-test rules (V-B1..V-B3), the key
rules (V-K1..V-K4), the markup rules (V-M1..V-M4), the cascade/reciprocal
rules (V-C1..V-C3) and the reconciliation rules (V-X1..V-X4) as pure,
composable functions.

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

import calendar
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping, Sequence

from allocation import validation
from allocation.algorithms.effective_dating import period_bounds
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
    "V-K1": BLOCK,  # key values exist for every resolved beneficiary (no silent zeroes)
    "V-K2": BLOCK,  # key value as_of_date within the freshness window
    "V-K3": BLOCK,  # engine-recomputed total_factor_value; ratios sum to 1 within 1e-12
    "V-K4": WARN,   # key changed vs. prior year for the same pool
    "V-M1": BLOCK,  # markup policy exists for every (pool, recipient jurisdiction)
    "V-M2": BLOCK,  # regime/markup coherence (LVAIGS deviation facet is WARN — SPEC §4 Stage 5)
    "V-M3": BLOCK,  # SCM requires eligibility basis + business judgment conclusion
    "V-M4": WARN,   # LVAIGS here / Benchmarked > 5% there without documentation_ref
    "V-C1": BLOCK,  # cycle detected and reciprocal solver disabled/unconverged
    "V-C2": WARN,   # perTier cascade margin policy in effect (every run)
    "V-C3": BLOCK,  # upstream charge lineage missing on a received-charge cost line
    "V-X1": BLOCK,  # unallocated_residual != 0 (v1 hard zero)
    "V-X2": BLOCK,  # Σ charges out (cost component) per pool == chargeable base exactly
    "V-X3": WARN,   # true-up exceeds trueUpWarnThreshold
    "V-X4": BLOCK,  # historic re-run hash mismatch (same inputs => identical outputs)
}

#: V-K3 — ratios sum to 1 within 1e-12 before apportionment (SPEC §7).
RATIO_TOLERANCE = Decimal("1E-12")


def exception(rule_id: str, message: str, *,
              objects: Iterable[Any] = (), pool_id: str | None = None,
              severity: str | None = None) -> dict:
    """One fired rule for the exception report (SPEC §8.4).

    ``severity`` overrides the catalogue default ONLY where the SPEC stage
    contract carves out a facet of a rule — the single user today is V-M2's
    LVAIGS deviation, which the Stage-5 contract downgrades to a warning
    ("warn if policy says otherwise", SPEC §4; DECISIONS.md M4).
    """
    return {
        "rule_id": rule_id,
        "severity": severity or SEVERITY[rule_id],
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


# -------------------------------------------------------------------- keys --


def _months_before(iso_date: str, months: int) -> str:
    """ISO date ``months`` months before ``iso_date`` (day clamped to the
    target month's length — e.g. 2026-03-31 minus 1 month = 2026-02-28)."""
    y, m, d = (int(part) for part in iso_date.split("-"))
    idx = y * 12 + (m - 1) - months
    y2, m2 = divmod(idx, 12)
    m2 += 1
    d2 = min(d, calendar.monthrange(y2, m2)[1])
    return f"{y2:04d}-{m2:02d}-{d2:02d}"


def v_k1_key_values_exist(
    pool_id: str,
    key_id: str,
    period: str,
    beneficiaries: Sequence[str],
    rows_by_recipient: Mapping[str, Sequence[Mapping[str, Any]]],
) -> list[dict]:
    """V-K1 BLOCK — key values exist for every beneficiary in the resolved
    population for the period (no silent zeroes, SPEC §7).

    Fires on: an empty resolved population for a chargeable pool (a
    participation gap — allocating nothing would strand the base as residual);
    a beneficiary with NO 7_KeyValue row for (key, pool, period) — a missing
    value must never be silently read as zero; and a beneficiary with MORE
    than one row (not exactly one determinate value). An explicit zero
    ``factor_value`` row is a measured zero and passes — that beneficiary is
    simply allocated nothing (SPEC §9.1 edge case; DECISIONS.md M3).
    """
    if not beneficiaries:
        return [exception(
            "V-K1",
            f"pool {pool_id}: resolved beneficiary population is empty for "
            f"{period} — a chargeable base cannot be apportioned "
            "(participation gap)",
            objects=[pool_id], pool_id=pool_id,
        )]
    excs: list[dict] = []
    missing = [b for b in beneficiaries if not rows_by_recipient.get(b)]
    if missing:
        excs.append(exception(
            "V-K1",
            f"pool {pool_id}: no {key_id} key value for beneficiar"
            f"{'y' if len(missing) == 1 else 'ies'} {missing} in {period} — "
            "a missing key value is not a silent zero",
            objects=missing, pool_id=pool_id,
        ))
    duplicated = [b for b in beneficiaries if len(rows_by_recipient.get(b, ())) > 1]
    if duplicated:
        excs.append(exception(
            "V-K1",
            f"pool {pool_id}: more than one {key_id} key value row for "
            f"{duplicated} in {period} — not exactly one determinate value",
            objects=duplicated, pool_id=pool_id,
        ))
    return excs


def v_k2_key_freshness(
    pool_id: str,
    key_def: Mapping[str, Any],
    period: str,
    rows: Sequence[Mapping[str, Any]],
    *,
    static_months: int = 12,
) -> list[dict]:
    """V-K2 BLOCK — ``as_of_date`` within the freshness window (SPEC §7).

    Default windows (config ``keyFreshnessStaticMonths`` feeds
    ``static_months``): Dynamic keys must be snapshotted within the run
    period; Static keys within the ``static_months`` months ending at
    period_end. Anything not explicitly Static gets the tighter dynamic
    window (conservative — DECISIONS.md M3).
    """
    period_start, period_end = period_bounds(period)
    if key_def.get("static_or_dynamic") == "Static":
        window_start, kind = _months_before(period_end, static_months), "static"
    else:
        window_start, kind = period_start, "dynamic"
    stale = [r for r in rows
             if not window_start <= str(r.get("as_of_date")) <= period_end]
    if not stale:
        return []
    ids = [r.get("key_value_id") for r in stale]
    return [exception(
        "V-K2",
        f"pool {pool_id}: key value as_of_date outside the {kind} freshness "
        f"window [{window_start}, {period_end}] for {ids} "
        f"(as_of {[str(r.get('as_of_date')) for r in stale]})",
        objects=ids, pool_id=pool_id,
    )]


def v_k3_total_factor_and_ratio_sum(
    pool_id: str,
    key_id: str,
    rows: Sequence[Mapping[str, Any]],
    recomputed_total: Decimal,
    ratios: Mapping[str, Decimal],
) -> list[dict]:
    """V-K3 BLOCK — engine-recomputed ``total_factor_value`` equals
    Σ ``factor_value`` over the resolved population; ratios sum to 1 within
    1e-12 before apportionment (SPEC §7).

    ``recomputed_total`` is the ENGINE's sum over the resolved beneficiary
    set — never trusted from input; every supplied ``total_factor_value``
    must equal it exactly. A non-positive total on a chargeable pool cannot
    form ratios and blocks. Supplied ``allocation_ratio`` values are ignored
    by design (the engine recomputes them — DECISIONS.md M3).
    """
    excs: list[dict] = []
    mismatched = [r.get("key_value_id") for r in rows
                  if Decimal(str(r["total_factor_value"])) != recomputed_total]
    if mismatched:
        excs.append(exception(
            "V-K3",
            f"pool {pool_id}: supplied total_factor_value differs from the "
            f"engine-recomputed Σ factor_value {recomputed_total} over the "
            f"resolved population on {mismatched}",
            objects=mismatched, pool_id=pool_id,
        ))
    if recomputed_total <= ZERO:
        excs.append(exception(
            "V-K3",
            f"pool {pool_id}: engine-recomputed total factor value "
            f"{recomputed_total} for {key_id} cannot form allocation ratios",
            objects=[key_id], pool_id=pool_id,
        ))
        return excs
    ratio_sum = sum(ratios.values(), ZERO)
    if abs(ONE - ratio_sum) > RATIO_TOLERANCE:
        excs.append(exception(
            "V-K3",
            f"pool {pool_id}: allocation ratios sum to {ratio_sum}, not 1 "
            f"within {RATIO_TOLERANCE}",
            objects=[str(ratio_sum)], pool_id=pool_id,
        ))
    return excs


def v_k4_key_changed_vs_prior_year(
    pool_id: str,
    key_id: str,
    prior_year_key_id: str | None,
) -> list[dict]:
    """V-K4 WARN — key changed vs. prior year for the same pool (consistency
    scrutiny, SPEC §7). ``prior_year_key_id`` comes from optional ref data
    (``prior_year_keys``); absent prior data means nothing to compare
    (DECISIONS.md M3)."""
    if prior_year_key_id is None or prior_year_key_id == key_id:
        return []
    return [exception(
        "V-K4",
        f"pool {pool_id}: allocation key changed from {prior_year_key_id!r} "
        f"(prior year) to {key_id!r} — consistency scrutiny",
        objects=[prior_year_key_id, key_id], pool_id=pool_id,
    )]


# ------------------------------------------------------------------ markup --


#: V-M2 — the OECD LVAIGS simplified approach is regime-FIXED at 5%
#: (TPG 7.61); SPEC §4 Stage 5 applies it and warns on a deviating policy.
LVAIGS_RATE = Decimal("0.05")

# 4_MarkupPolicy.regime enumeration values (schema.json "regime").
REGIME_LVAIGS = "LVAIGS (5%)"
REGIME_SCM = "SCM (0%)"
REGIME_BENCHMARKED = "Benchmarked"
REGIME_PASS_THROUGH = "Pass-through (0%)"


def v_m1_markup_policy_resolution(
    pool_id: str,
    jurisdiction: str,
    period: str,
    policies: Sequence[Mapping[str, Any]],
) -> list[dict]:
    """V-M1 BLOCK — a markup policy exists for every charged (pool, recipient
    jurisdiction) (SPEC §7).

    Zero 4_MarkupPolicy rows in scope as-of the period is a missing policy —
    a blocking exception by design, NEVER a defaulted markup (SPEC §4 Stage 5,
    ENGINE-CLAUDE.md "No silent defaults"). More than one row in scope is not
    exactly one determinate policy and blocks equally (DECISIONS.md M4).
    """
    if len(policies) == 1:
        return []
    if not policies:
        return [exception(
            "V-M1",
            f"pool {pool_id}: no 4_MarkupPolicy row in scope for jurisdiction "
            f"{jurisdiction!r} as-of {period} — a missing markup policy is a "
            "blocking exception, never a default",
            objects=[pool_id, jurisdiction], pool_id=pool_id,
        )]
    ids = [p.get("markup_policy_id") for p in policies]
    return [exception(
        "V-M1",
        f"pool {pool_id}: {len(policies)} 4_MarkupPolicy rows in scope for "
        f"jurisdiction {jurisdiction!r} as-of {period} ({ids}) — not exactly "
        "one determinate policy",
        objects=ids, pool_id=pool_id,
    )]


def v_m2_regime_markup_coherence(policy: Mapping[str, Any]) -> list[dict]:
    """V-M2 — regime/markup coherence (SPEC §7).

    SCM (0%) and Pass-through (0%) must carry exactly 0% (BLOCK); Benchmarked
    requires a non-empty ``benchmark_study_ref`` (BLOCK); LVAIGS (5%) is
    regime-FIXED at 5% — a deviating policy rate fires a WARN and the engine
    applies the fixed 5% (SPEC §4 Stage 5 "warn if policy says otherwise";
    DECISIONS.md M4). Callers schema-gate the row first, so ``markup_pct``
    parses.
    """
    pid = policy["markup_policy_id"]
    pool_id = policy["pool_id"]
    regime = policy["regime"]
    pct = Decimal(policy["markup_pct"])
    if regime in (REGIME_SCM, REGIME_PASS_THROUGH) and pct != ZERO:
        return [exception(
            "V-M2",
            f"policy {pid}: regime {regime!r} must carry a 0% markup, got "
            f"{policy['markup_pct']} — at-cost regimes never bear a margin",
            objects=[pid], pool_id=pool_id,
        )]
    if regime == REGIME_LVAIGS and pct != LVAIGS_RATE:
        return [exception(
            "V-M2",
            f"policy {pid}: LVAIGS is regime-fixed at 5% but the policy says "
            f"{policy['markup_pct']} — the engine applies the fixed 5% "
            "(SPEC §4 Stage 5)",
            objects=[pid], pool_id=pool_id, severity=WARN,
        )]
    if regime == REGIME_BENCHMARKED \
            and not str(policy.get("benchmark_study_ref") or "").strip():
        return [exception(
            "V-M2",
            f"policy {pid}: Benchmarked regime requires a benchmark_study_ref "
            "— an unsupported benchmarked markup is undocumented by design",
            objects=[pid], pool_id=pool_id,
        )]
    return []


def v_m3_scm_support(policy: Mapping[str, Any]) -> list[dict]:
    """V-M3 BLOCK — SCM policies require ``scm_eligibility_basis ≠ n/a`` and a
    non-empty ``business_judgment_conclusion`` (SPEC §7; the mandatory support
    for a US Treas. Reg. §1.482-9(b) services-cost-method position)."""
    if policy["regime"] != REGIME_SCM:
        return []
    pid = policy["markup_policy_id"]
    pool_id = policy["pool_id"]
    excs: list[dict] = []
    basis = policy.get("scm_eligibility_basis")
    if basis is None or basis == "n/a":
        excs.append(exception(
            "V-M3",
            f"policy {pid}: SCM regime with scm_eligibility_basis "
            f"{basis!r} — a 0% SCM position needs a specified-covered-service "
            "or low-margin eligibility basis",
            objects=[pid], pool_id=pool_id,
        ))
    if not str(policy.get("business_judgment_conclusion") or "").strip():
        excs.append(exception(
            "V-M3",
            f"policy {pid}: SCM regime without a business_judgment_conclusion "
            "— the not-core/no-key-advantage conclusion is mandatory support",
            objects=[pid], pool_id=pool_id,
        ))
    return excs


def v_m4_lvaigs_benchmarked_divergence(
    pool_id: str,
    documentation_ref: str | None,
    used_policies: Sequence[Mapping[str, Any]],
) -> list[dict]:
    """V-M4 WARN — same pool charged under LVAIGS in one jurisdiction and
    Benchmarked > 5% elsewhere without a documentation_ref (SPEC §7:
    divergence is fine; undocumented divergence is not).

    ``used_policies`` are the policies actually applied to the pool's charges
    in this run; the documentation_ref is the pool's (3_Pool) — DECISIONS.md
    M4."""
    if str(documentation_ref or "").strip():
        return []
    lvaigs = sorted(p["markup_policy_id"] for p in used_policies
                    if p["regime"] == REGIME_LVAIGS)
    rich = sorted(p["markup_policy_id"] for p in used_policies
                  if p["regime"] == REGIME_BENCHMARKED
                  and Decimal(p["markup_pct"]) > LVAIGS_RATE)
    if not (lvaigs and rich):
        return []
    return [exception(
        "V-M4",
        f"pool {pool_id}: charged under LVAIGS ({lvaigs}) in one jurisdiction "
        f"and Benchmarked > 5% ({rich}) elsewhere with no pool "
        "documentation_ref — undocumented divergence",
        objects=lvaigs + rich, pool_id=pool_id,
    )]


# ---------------------------------------------------- cascade & reciprocal --


#: 1_CostLine.cost_nature value for a charge received from an upstream pool
#: (SPEC §5.2; schema.json "cost_nature" enumeration).
COST_NATURE_RECEIVED = "Intercompany charge received"


def v_c1_cycle_unsolvable(
    scc_pool_ids: Iterable[str], reason: str
) -> list[dict]:
    """V-C1 BLOCK — cycle detected and reciprocal solver disabled/unconverged
    (SPEC §7).

    One exception per SCC member pool so the standard blocked-pool accounting
    applies ("BLOCK halts the run for the affected pool"); every member names
    the full cycle in ``objects`` so the report reads as one event.
    """
    members = sorted(scc_pool_ids)
    return [exception(
        "V-C1",
        f"pool {pid}: member of the reciprocal cycle {members} that cannot "
        f"be solved — {reason}",
        objects=members, pool_id=pid,
    ) for pid in members]


def v_c2_per_tier_margin_policy() -> list[dict]:
    """V-C2 WARN — ``perTier`` margin policy in effect, emitted on EVERY run
    (SPEC §7): received intercompany charges are re-margined at each tier —
    double-margining must be deliberate (SPEC §5.2)."""
    return [exception(
        "V-C2",
        "cascadeMarkupPolicy 'perTier' is in effect: received intercompany "
        "charges are re-margined at every downstream tier (double margin) — "
        "this must be a deliberate choice (SPEC §5.2)",
        objects=["cascadeMarkupPolicy=perTier"],
    )]


def v_c3_received_charge_lineage(
    pool_id: str,
    lines: Sequence[Mapping[str, Any]],
    lineage_refs: Mapping[str, Any] | set[str] | frozenset[str],
) -> list[dict]:
    """V-C3 BLOCK — upstream charge lineage missing on a received-charge cost
    line (SPEC §7).

    A line with ``cost_nature = "Intercompany charge received"`` must appear
    in the received-charge lineage registry: engine-synthesized lines register
    at creation (SPEC §5.2 "full lineage to the originating charge");
    GL-booked received lines register via ``ref_data["received_charge_lineage"]``
    with a COMPLETE record — ``upstream_charge_ref`` + ``markup_exempt`` — an
    incomplete record is missing lineage (DECISIONS.md M5).
    """
    excs: list[dict] = []
    for line in lines:
        if line.get("cost_nature") != COST_NATURE_RECEIVED:
            continue
        lid = line.get("cost_line_id") or "?"
        if lid in lineage_refs:
            continue
        excs.append(exception(
            "V-C3",
            f"pool {pool_id}: received-charge cost line {lid} has no upstream "
            "charge lineage — every received charge must trace to its "
            "originating charge",
            objects=[lid], pool_id=pool_id,
        ))
    return excs


# ------------------------------------------------------------ reconciliation --


def v_x1_unallocated_residual(pool_id: str, residual: Decimal) -> list[dict]:
    """V-X1 BLOCK — ``unallocated_residual != 0`` (SPEC §7; v1 hard zero,
    ``unallocatedResidualTolerance: 0`` per SPEC §6).

    A nonzero residual after largest-remainder apportionment is a logic or
    participation gap, never rounding (SPEC §4 Stage 7).
    """
    if residual == ZERO:
        return []
    return [exception(
        "V-X1",
        f"pool {pool_id}: unallocated residual {residual} != 0 — pool cost "
        "neither charged nor excluded (trapped stewardship or pooling gap)",
        objects=[str(residual)], pool_id=pool_id,
    )]


def v_x2_charges_out_equal_chargeable_base(
    pool_ids: Sequence[str],
    chargeable_base: Decimal,
    charged_cost: Decimal,
) -> list[dict]:
    """V-X2 BLOCK — Σ charges out (cost component) per pool == chargeable base
    EXACTLY (SPEC §7).

    Evaluated per pool for acyclic pools and at SCC grain for reciprocal
    groups (inside a cycle the per-pool ledger total differs from the pool's
    own base by design — the group sums tie exactly; DECISIONS.md M5 #54).
    One exception per member pool, V-C1 style, so the standard blocked-pool
    accounting applies.
    """
    if charged_cost == chargeable_base:
        return []
    members = sorted(pool_ids)
    scope = f"reciprocal group {members}" if len(members) > 1 else f"pool {members[0]}"
    return [exception(
        "V-X2",
        f"pool {pid}: Σ charged-out cost {charged_cost} != chargeable base "
        f"{chargeable_base} for {scope} — the ledger does not tie to the "
        "pooled cost",
        objects=members, pool_id=pid,
    ) for pid in members]


def v_x3_true_up_exceeds_threshold(
    pool_id: str,
    delta: Decimal,
    actual_full_year: Decimal,
    threshold: Decimal,
) -> list[dict]:
    """V-X3 WARN — true-up exceeds ``trueUpWarnThreshold`` (SPEC §7):
    |delta| / actual_full_year > threshold flags the pool as a KPI exception
    (SPEC §5.4). A zero actual year has no ratio — nothing fires."""
    if actual_full_year <= ZERO:
        return []
    ratio = abs(delta) / actual_full_year
    if ratio <= threshold:
        return []
    return [exception(
        "V-X3",
        f"pool {pool_id}: true-up delta {delta} is {ratio:.4f} of the actual "
        f"full year {actual_full_year} — exceeds the trueUpWarnThreshold "
        f"{threshold} (budget-vs-actual divergence KPI)",
        objects=[str(delta), str(actual_full_year)], pool_id=pool_id,
    )]


def v_x4_reproducibility_failure(
    context: str, detail: str, *,
    objects: Iterable[Any] = (), pool_id: str | None = None,
) -> list[dict]:
    """V-X4 BLOCK — historic re-run hash mismatch: the same inputs must yield
    identical outputs (SPEC §7).

    Two facets share the rule (DECISIONS.md M6): (a) a run whose input
    snapshot hash matches a prior succeeded run must reproduce that run's
    output hash; (b) the true-up's booked Budget ledger rows must be exactly
    reproduced by the deterministic budget recompute (a booked charge that
    cannot be rebuilt from the inputs is a reproducibility break).
    """
    return [exception(
        "V-X4",
        f"{context}: {detail} — same inputs must yield identical outputs",
        objects=objects, pool_id=pool_id,
    )]
