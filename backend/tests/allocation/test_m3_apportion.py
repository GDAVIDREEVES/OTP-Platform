"""M3 gate — Stage 4 flat apportionment, largest remainder
(SPEC §10 M3 + §5.1 + §4 Stage-4 contract + §7 V-K rules; ADAPTATION D5).

Covers, in order:
- the largest-remainder algorithm exactly per SPEC §5.1: floor to the minor
  unit, residual one minor unit at a time by descending fractional remainder,
  tie-break ascending recipient_entity_id, exact-sum assert; contract
  violations raise (base not minor-unit-grain, ratios off 1, negative);
- property tests over random Decimal pools/ratios: Σ allocations == base
  EXACTLY; determinism under input reordering (SPEC §9.3);
- Stage 4: beneficiary resolution from 9_Participation as-of period + entity
  effective dates; ENGINE-recomputed total_factor_value; every V-K rule fired
  on a crafted bad input — V-K1..V-K4 (rule IDs in test names,
  ENGINE-CLAUDE.md) — plus V-R1/V-R2/V-R3 at the key layer;
- SPEC §9.1 edge cases: single-beneficiary pool, beneficiary with zero key
  value (explicit zero allocates 0; a MISSING value is V-K1 BLOCK), zero-cost
  pool flowing through;
- the demo gate (ADAPTATION D5 M3): seeds flow Stages 1-4 with zero
  exceptions and the allocated cost per (provider, recipient) equals the
  warehouse SERVICE pair cost base per period AND for the FY, to the cent.

NO float arithmetic on amounts anywhere in this file (ENGINE-CLAUDE.md).

Run from backend/:  ../.venv/bin/python -m pytest tests/allocation/test_m3_apportion.py
"""

from __future__ import annotations

import json
import random
from decimal import Decimal
from pathlib import Path

import duckdb
import pytest

from allocation.algorithms.apportion import apportion
from allocation.stages import (
    stage1_capture_and_classify,
    stage2_pool,
    stage3_benefit_gate,
    stage4_allocate,
)
from allocation.validation import rules
from config import SUPPLY_CHAIN

BACKEND = Path(__file__).resolve().parents[2]
SEED_DIR = BACKEND / "seeds" / "allocation"
PERIOD = "2026-05"
CFG = {"period": PERIOD}
ZERO = Decimal("0")
ONE = Decimal("1")
CENT = Decimal("0.01")


def _seed_doc(fname: str) -> dict:
    return json.loads((SEED_DIR / fname).read_text(encoding="utf-8"))


# ------------------------------------------------- crafted-fixture builders --


def mk_entity(entity_id: str, **over) -> dict:
    row = {
        "entity_id": entity_id,
        "legal_entity_name": f"Entity {entity_id}",
        "company_code": entity_id,
        "jurisdiction": "US",
        "functional_currency": "USD",
        "entity_role": "Both",
        "effective_from": "2026-01-01",
        "status": "Active",
    }
    row.update(over)
    return row


def mk_participation(pool_id: str, entity_id: str, **over) -> dict:
    row = {
        "participation_id": f"PP-{pool_id}-{entity_id}",
        "pool_id": pool_id,
        "entity_id": entity_id,
        "role": "Beneficiary",
        "effective_from": "2026-01-01",
    }
    row.update(over)
    return row


def mk_key_def(key_id: str = "KEY-X", **over) -> dict:
    row = {
        "key_id": key_id,
        "key_name": f"Key {key_id}",
        "key_factor": "Headcount",
        "source_system": "HR master",
        "static_or_dynamic": "Dynamic",
        "owner": "TP Ops Lead",
    }
    row.update(over)
    return row


def mk_key_value(pool_id: str, recipient: str, factor: str, total: str,
                 *, key_id: str = "KEY-X", period: str = PERIOD, **over) -> dict:
    row = {
        "key_value_id": f"KV-{pool_id}-{recipient}-{period}",
        "key_id": key_id,
        "pool_id": pool_id,
        "recipient_entity_id": recipient,
        "period": period,
        "factor_value": factor,
        "total_factor_value": total,
        "allocation_ratio": "0",  # supplied ratio is never trusted (V-K3)
        "as_of_date": "2026-05-31",
    }
    row.update(over)
    return row


def mk_stage3_pool(pool_id: str, base: str, *, provider: str = "1000",
                   key_id: str = "KEY-X", **over) -> dict:
    """A Stage-3-shaped pool dict (the Stage-4 input contract)."""
    row = {
        "pool_id": pool_id,
        "provider_entity_id": provider,
        "period": PERIOD,
        "service_line": "IT",
        "characterization": "Routine-benchmarked",
        "default_key_id": key_id,
        "direct_charge_flag": False,
        "total_pooled_cost": Decimal(base),
        "line_ids": [],
        "lines": [],
        "total_exclusions": ZERO,
        "chargeable_base": Decimal(base),
        "exclusions_applied": [],
    }
    row.update(over)
    return row


ENTITIES_T = [mk_entity("1000"), mk_entity("2000"), mk_entity("2100"),
              mk_entity("2200")]


def ref_t(*, participation=None, key_values=None, key_defs=None,
          entities=None, **extra) -> dict:
    ref = {
        "entities": ENTITIES_T if entities is None else entities,
        "participation": [] if participation is None else participation,
        "key_defs": [mk_key_def()] if key_defs is None else key_defs,
        "key_values": [] if key_values is None else key_values,
    }
    ref.update(extra)
    return ref


def run_s4(pools, ref, config=CFG) -> dict:
    return stage4_allocate({"pools": pools}, ref, config)


# ------------------------------------------ apportion — SPEC §5.1 verbatim --


def test_apportion_floor_and_residual_by_descending_remainder():
    """SPEC §5.1: floor to the minor unit; the residual goes one cent at a
    time in DESCENDING fractional-remainder order."""
    # raw: A 0.335 / B 0.333 / C 0.332 -> floors 0.33 each, residual 0.01 -> A
    out = apportion(Decimal("1.00"), {"A": Decimal("0.335"),
                                      "B": Decimal("0.333"),
                                      "C": Decimal("0.332")})
    assert out == {"A": Decimal("0.34"), "B": Decimal("0.33"),
                   "C": Decimal("0.33")}
    assert sum(out.values()) == Decimal("1.00")


def test_apportion_tie_break_ascending_recipient_entity_id():
    """SPEC §5.1: equal remainders tie-break by recipient_entity_id ASCENDING
    (determinism)."""
    out = apportion(Decimal("0.01"), {"B": Decimal("0.5"), "A": Decimal("0.5")})
    assert out == {"A": Decimal("0.01"), "B": ZERO}
    # and with three-way ties the cents land on the lowest ids first
    out = apportion(Decimal("0.02"), {"C": Decimal("1") / 3, "B": Decimal("1") / 3,
                                      "A": Decimal("1") / 3})
    assert out == {"A": Decimal("0.01"), "B": Decimal("0.01"), "C": ZERO}


def test_apportion_deterministic_under_input_reordering():
    """SPEC §9.3 property: the result is independent of the mapping's
    iteration order."""
    ratios = {"R3": Decimal("0.2"), "R1": Decimal("0.5"), "R2": Decimal("0.3")}
    expected = apportion(Decimal("100.01"), ratios)
    reordered = dict(sorted(ratios.items(), reverse=True))
    assert apportion(Decimal("100.01"), reordered) == expected
    assert list(expected) == ["R1", "R2", "R3"]  # ascending recipient order


def test_apportion_zero_base_and_single_recipient():
    """SPEC §9.1 edge cases: a zero-cost pool allocates zeroes; a single
    beneficiary takes the whole base."""
    assert apportion(ZERO, {}) == {}
    assert apportion(ZERO, {"A": ONE}) == {"A": ZERO}
    assert apportion(Decimal("123.45"), {"A": ONE}) == {"A": Decimal("123.45")}


def test_apportion_minor_unit_parameter_zero_decimal_currency():
    """The minor unit is a parameter (JPY-style zero-decimal currencies)."""
    out = apportion(Decimal("100"), {"A": Decimal("0.5"), "B": Decimal("0.5")},
                    minor_unit=Decimal("1"))
    assert out == {"A": Decimal("50"), "B": Decimal("50")}
    out = apportion(Decimal("101"), {"A": Decimal("0.5"), "B": Decimal("0.5")},
                    minor_unit=Decimal("1"))
    assert out == {"A": Decimal("51"), "B": Decimal("50")}


def test_apportion_contract_violations_raise():
    """Caller-contract violations raise ValueError (they are engine bugs or
    upstream gate failures, not V-rule exceptions — DECISIONS.md M3)."""
    with pytest.raises(ValueError, match="non-negative"):
        apportion(Decimal("-1.00"), {"A": ONE})
    with pytest.raises(ValueError, match="minor unit"):
        apportion(Decimal("70.007"), {"A": ONE})  # sub-cent base
    with pytest.raises(ValueError, match="no recipients"):
        apportion(Decimal("1.00"), {})
    with pytest.raises(ValueError, match="negative ratios"):
        apportion(Decimal("1.00"), {"A": Decimal("2"), "B": Decimal("-1")})
    with pytest.raises(ValueError, match="ratios sum"):
        apportion(Decimal("1.00"), {"A": Decimal("0.4"), "B": Decimal("0.4")})


def test_apportion_property_random_pools_sum_exactly_and_deterministic():
    """SPEC §9.3 property test: for random Decimal pools and ratios,
    Σ allocations == base EXACTLY and reordering the input changes nothing.
    All randomness is integer-driven — no floats near amounts."""
    rng = random.Random(20260610)
    for trial in range(250):
        n = rng.randint(1, 12)
        base = Decimal(rng.randint(0, 10**9)) / 100  # cent-grain
        weights = [Decimal(rng.randint(0, 10**6)) for _ in range(n)]
        if sum(weights) == 0:
            weights[rng.randrange(n)] = ONE
        total = sum(weights)
        ratios = {f"E{i:03d}": w / total for i, w in enumerate(weights)}
        out = apportion(base, ratios)
        assert sum(out.values(), ZERO) == base, (trial, base)
        assert all(v >= ZERO for v in out.values())
        assert all(v == v.quantize(CENT) for v in out.values())  # cent-grain
        items = list(ratios.items())
        rng.shuffle(items)
        assert apportion(base, dict(items)) == out, trial


# --------------------------------------------- stage 4 — resolution & V-K --


def test_stage4_engine_recomputes_total_and_allocates_exact_sum():
    """SPEC §4 Stage 4: ratios come from factor / ENGINE-recomputed total
    over the resolved population; allocations sum exactly to the base."""
    pools = [mk_stage3_pool("POOL-A", "100.01")]
    ref = ref_t(
        participation=[mk_participation("POOL-A", "2000"),
                       mk_participation("POOL-A", "2100")],
        key_values=[mk_key_value("POOL-A", "2000", "60", "100"),
                    mk_key_value("POOL-A", "2100", "40", "100")],
    )
    res = run_s4(pools, ref)
    assert res["exceptions"] == []
    pool = res["outputs"]["pools"][0]
    assert pool["key_id"] == "KEY-X"
    assert pool["total_factor_value"] == Decimal("100")
    allocs = {a["recipient_entity_id"]: a for a in pool["allocations"]}
    assert allocs["2000"]["allocated_cost"] == Decimal("60.01")  # largest split
    assert allocs["2100"]["allocated_cost"] == Decimal("40.00")
    assert allocs["2000"]["allocation_ratio"] == Decimal("0.6")
    assert pool["total_allocated"] == Decimal("100.01") == pool["chargeable_base"]
    assert [a["key_value_id"] for a in pool["allocations"]] == \
        ["KV-POOL-A-2000-2026-05", "KV-POOL-A-2100-2026-05"]  # lineage
    assert res["outputs"]["allocations"] == pool["allocations"]


def test_stage4_deterministic_under_input_reordering():
    """Determinism (SPEC §5.1 convention): identical outputs regardless of
    the ordering of pools, participation and key value inputs."""
    pools = [mk_stage3_pool("POOL-A", "777.77"),
             mk_stage3_pool("POOL-B", "0.05", key_id="KEY-X")]
    participation = [mk_participation("POOL-A", "2000"),
                     mk_participation("POOL-A", "2100"),
                     mk_participation("POOL-B", "2000"),
                     mk_participation("POOL-B", "2200")]
    key_values = [mk_key_value("POOL-A", "2000", "3", "7"),
                  mk_key_value("POOL-A", "2100", "4", "7"),
                  mk_key_value("POOL-B", "2000", "1", "3"),
                  mk_key_value("POOL-B", "2200", "2", "3")]
    a = run_s4(pools, ref_t(participation=participation, key_values=key_values))
    b = run_s4(list(reversed(pools)),
               ref_t(participation=list(reversed(participation)),
                     key_values=list(reversed(key_values))))
    assert a == b
    assert sum((x["allocated_cost"] for x in a["outputs"]["allocations"]), ZERO) \
        == Decimal("777.82")


def test_stage4_zero_cost_pool_flows_through_without_key_support():
    """SPEC §9.1 edge case: a zero-chargeable-base pool flows through with no
    allocations — no key values are required where nothing is charged
    (DECISIONS.md M3; the demo's 100%-excluded management pools)."""
    pools = [mk_stage3_pool("POOL-Z", "0", key_id="KEY-UNSEEN")]
    res = run_s4(pools, ref_t(participation=[mk_participation("POOL-Z", "2000")],
                              key_defs=[]))
    assert res["exceptions"] == []
    pool = res["outputs"]["pools"][0]
    assert pool["allocations"] == [] and pool["total_allocated"] == ZERO
    assert pool["key_id"] is None and pool["total_factor_value"] is None
    assert res["outputs"]["blocked_pool_ids"] == []


def test_stage4_single_beneficiary_takes_the_whole_base():
    """SPEC §9.1 edge case: single-beneficiary pool — ratio exactly 1."""
    pools = [mk_stage3_pool("POOL-A", "3522150.00")]
    ref = ref_t(participation=[mk_participation("POOL-A", "2000")],
                key_values=[mk_key_value("POOL-A", "2000", "3522.15", "3522.15")])
    res = run_s4(pools, ref)
    assert res["exceptions"] == []
    (alloc,) = res["outputs"]["allocations"]
    assert alloc["allocation_ratio"] == ONE
    assert alloc["allocated_cost"] == Decimal("3522150.00")


def test_stage4_beneficiary_with_explicit_zero_key_value_allocates_nothing():
    """SPEC §9.1 edge case: a beneficiary with an EXPLICIT zero factor_value
    is a measured zero — allocated 0.00, never blocked (DECISIONS.md M3)."""
    pools = [mk_stage3_pool("POOL-A", "500.00")]
    ref = ref_t(
        participation=[mk_participation("POOL-A", "2000"),
                       mk_participation("POOL-A", "2100")],
        key_values=[mk_key_value("POOL-A", "2000", "120", "120"),
                    mk_key_value("POOL-A", "2100", "0", "120")],
    )
    res = run_s4(pools, ref)
    assert res["exceptions"] == []
    allocs = {a["recipient_entity_id"]: a["allocated_cost"]
              for a in res["outputs"]["allocations"]}
    assert allocs == {"2000": Decimal("500.00"), "2100": ZERO}


def test_stage4_participation_and_entities_resolve_as_of_period():
    """Stage-4 contract: the population comes from 9_Participation as-of the
    period AND the entity must be active per 8_Entity effective dates
    (SPEC §5.5); stale key totals over the shrunken population then fail
    V-K3 unless recomputed."""
    pools = [mk_stage3_pool("POOL-A", "100.00")]
    participation = [
        mk_participation("POOL-A", "2000"),
        mk_participation("POOL-A", "2100", effective_to="2026-04-30"),  # left pool
        mk_participation("POOL-A", "2200"),  # entity disposed of below
        mk_participation("POOL-A", "1000", role="Provider"),  # not a beneficiary
    ]
    entities = [mk_entity("1000"), mk_entity("2000"), mk_entity("2100"),
                mk_entity("2200", effective_to="2026-03-31")]
    # keys recomputed for the one remaining beneficiary -> clean run
    ref = ref_t(participation=participation, entities=entities,
                key_values=[mk_key_value("POOL-A", "2000", "5", "5")])
    res = run_s4(pools, ref)
    assert res["exceptions"] == []
    (alloc,) = res["outputs"]["allocations"]
    assert alloc["recipient_entity_id"] == "2000"
    assert alloc["allocated_cost"] == Decimal("100.00")
    # same population, but key rows still carry the pre-exit totals -> V-K3
    stale = [mk_key_value("POOL-A", "2000", "5", "9"),
             mk_key_value("POOL-A", "2100", "4", "9")]
    res = run_s4(pools, ref_t(participation=participation, entities=entities,
                              key_values=stale))
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-K3"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_v_k1_missing_key_value_blocks_pool():
    """V-K1 BLOCK — key values exist for every beneficiary in the resolved
    population (no silent zeroes): a zero-key beneficiary halts the pool."""
    pools = [mk_stage3_pool("POOL-A", "100.00")]
    ref = ref_t(
        participation=[mk_participation("POOL-A", "2000"),
                       mk_participation("POOL-A", "2100")],
        key_values=[mk_key_value("POOL-A", "2000", "60", "60")],  # 2100 missing
    )
    res = run_s4(pools, ref)
    fired = rules.fired(res["exceptions"], "V-K1")
    assert len(fired) == 1 and fired[0]["severity"] == "BLOCK"
    assert fired[0]["objects"] == ["2100"]
    assert res["outputs"]["pools"] == []
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_v_k1_empty_population_on_chargeable_pool_blocks():
    """V-K1 BLOCK — an empty resolved beneficiary population on a pool with a
    chargeable base is a participation gap (DECISIONS.md M3)."""
    pools = [mk_stage3_pool("POOL-A", "100.00")]
    res = run_s4(pools, ref_t(participation=[]))
    fired = rules.fired(res["exceptions"], "V-K1")
    assert len(fired) == 1 and "population is empty" in fired[0]["message"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_v_k1_duplicate_key_value_rows_block():
    """V-K1 BLOCK — more than one key value row per (key, pool, recipient,
    period) is not exactly one determinate value."""
    pools = [mk_stage3_pool("POOL-A", "100.00")]
    dup = mk_key_value("POOL-A", "2000", "60", "60",
                       key_value_id="KV-POOL-A-2000-2026-05-DUP")
    ref = ref_t(participation=[mk_participation("POOL-A", "2000")],
                key_values=[mk_key_value("POOL-A", "2000", "60", "60"), dup])
    res = run_s4(pools, ref)
    fired = rules.fired(res["exceptions"], "V-K1")
    assert len(fired) == 1 and "more than one" in fired[0]["message"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_v_k2_dynamic_key_as_of_must_lie_within_the_run_period():
    """V-K2 BLOCK — dynamic keys must be snapshotted within the run period."""
    pools = [mk_stage3_pool("POOL-A", "100.00")]
    ref = ref_t(participation=[mk_participation("POOL-A", "2000")],
                key_values=[mk_key_value("POOL-A", "2000", "5", "5",
                                         as_of_date="2026-04-30")])
    res = run_s4(pools, ref)
    fired = rules.fired(res["exceptions"], "V-K2")
    assert len(fired) == 1 and fired[0]["severity"] == "BLOCK"
    assert "dynamic freshness window" in fired[0]["message"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_v_k2_static_key_window_is_12_months_and_configurable():
    """V-K2 BLOCK — static keys default to a 12-month window ending at
    period_end (config keyFreshnessStaticMonths)."""
    pools = [mk_stage3_pool("POOL-A", "100.00")]
    static_def = mk_key_def(static_or_dynamic="Static")

    def res_for(as_of: str, config=CFG) -> dict:
        ref = ref_t(participation=[mk_participation("POOL-A", "2000")],
                    key_defs=[static_def],
                    key_values=[mk_key_value("POOL-A", "2000", "5", "5",
                                             as_of_date=as_of)])
        return run_s4(pools, ref, config)

    assert res_for("2025-06-30")["exceptions"] == []  # 11 months back: fresh
    res = res_for("2025-05-01")  # 13 months back: stale
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-K2"]
    res = res_for("2026-06-01")  # snapshot after period end: stale
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-K2"]
    # tighter window via config
    res = res_for("2025-06-30", dict(CFG, keyFreshnessStaticMonths=3))
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-K2"]


def test_v_k3_supplied_total_must_match_engine_recomputed_total():
    """V-K3 BLOCK — the engine NEVER trusts total_factor_value from input:
    any supplied total differing from Σ factor_value over the resolved
    population halts the pool."""
    pools = [mk_stage3_pool("POOL-A", "100.00")]
    ref = ref_t(
        participation=[mk_participation("POOL-A", "2000"),
                       mk_participation("POOL-A", "2100")],
        key_values=[mk_key_value("POOL-A", "2000", "60", "100"),
                    mk_key_value("POOL-A", "2100", "40", "999")],  # tampered
    )
    res = run_s4(pools, ref)
    fired = rules.fired(res["exceptions"], "V-K3")
    assert len(fired) == 1 and fired[0]["severity"] == "BLOCK"
    assert fired[0]["objects"] == ["KV-POOL-A-2100-2026-05"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_v_k3_all_zero_factors_cannot_form_ratios():
    """V-K3 BLOCK — a non-positive recomputed total on a chargeable pool
    cannot form allocation ratios."""
    pools = [mk_stage3_pool("POOL-A", "100.00")]
    ref = ref_t(participation=[mk_participation("POOL-A", "2000")],
                key_values=[mk_key_value("POOL-A", "2000", "0", "0")])
    res = run_s4(pools, ref)
    fired = rules.fired(res["exceptions"], "V-K3")
    assert len(fired) == 1 and "cannot form allocation ratios" in fired[0]["message"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_v_k4_key_changed_vs_prior_year_warns_but_pool_continues():
    """V-K4 WARN — key changed vs. prior year for the same pool (consistency
    scrutiny); the pool still allocates."""
    pools = [mk_stage3_pool("POOL-A", "100.00")]
    ref = ref_t(participation=[mk_participation("POOL-A", "2000")],
                key_values=[mk_key_value("POOL-A", "2000", "5", "5")],
                prior_year_keys={"POOL-A": "KEY-HEADCOUNT-OLD"})
    res = run_s4(pools, ref)
    fired = rules.fired(res["exceptions"], "V-K4")
    assert len(fired) == 1 and fired[0]["severity"] == "WARN"
    assert "KEY-HEADCOUNT-OLD" in fired[0]["message"]
    assert res["outputs"]["blocked_pool_ids"] == []
    assert res["outputs"]["allocations"][0]["allocated_cost"] == Decimal("100.00")


def test_v_r1_unresolved_default_key_blocks_pool():
    """V-R1 BLOCK — a pool default_key_id that does not resolve to 6_KeyDef
    halts the pool (never a silent fallback key)."""
    pools = [mk_stage3_pool("POOL-A", "100.00", key_id="KEY-NOPE")]
    res = run_s4(pools, ref_t(participation=[mk_participation("POOL-A", "2000")]))
    fired = rules.fired(res["exceptions"], "V-R1")
    assert len(fired) == 1 and "KEY-NOPE" in fired[0]["message"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_v_r2_v_r3_malformed_key_value_rows_block_pool():
    """V-R2/V-R3 BLOCK at the key layer — a float factor_value or a negative
    factor corrupts the apportionment and halts the pool."""
    pools = [mk_stage3_pool("POOL-A", "100.00")]
    bad_float = mk_key_value("POOL-A", "2000", "5", "5")
    bad_float["factor_value"] = 5.0  # float on an amount — forbidden
    res = run_s4(pools, ref_t(participation=[mk_participation("POOL-A", "2000")],
                              key_values=[bad_float]))
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-R2"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]

    negative = mk_key_value("POOL-A", "2000", "-5", "5")
    res = run_s4(pools, ref_t(participation=[mk_participation("POOL-A", "2000")],
                              key_values=[negative]))
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-R3"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


# ----------------------------------------------- demo seeds, end to end ----


PROVIDER_PERIODS = {"1000": ("2026-05", "2026-11"), "3100": ("2026-04", "2026-10")}
MGMT_POOLS = {"1000": "POOL-MGMT-US", "3100": "POOL-MGMT-CH"}
SERVICE_POOLS = {"1000": "POOL-IT-US", "3100": "POOL-RSS-CH"}


def _demo_ref() -> tuple[dict, dict, list[dict]]:
    ref = {
        "entities": _seed_doc("entities.v1.json")["rows"],
        "cc_mapping": _seed_doc("cc_mapping.v1.json")["rows"],
        "pools": _seed_doc("pools.v1.json")["rows"],
        "key_defs": _seed_doc("key_defs.v1.json")["rows"],
        "participation": _seed_doc("participation.v1.json")["rows"],
        "key_values": _seed_doc("key_values.v1.json")["actual"],
    }
    exclusions = {"exclusions": _seed_doc("exclusions.v1.json")["rows"]}
    cost_lines = _seed_doc("cost_lines.v1.json")["actual"]
    return ref, exclusions, cost_lines


def _warehouse_pair_cb() -> tuple[dict, dict]:
    """Warehouse SERVICE pair cost base per (provider, recipient, period) and
    per (provider, recipient) FY — Decimal end to end (DuckDB DECIMAL)."""
    con = duckdb.connect()
    rows = con.execute(
        f"""
        SELECT SELLING_COMPANY, BUYING_COMPANY, GJAHR, POPER,
               SUM(STANDARD_COST * TOTAL_VOLUME)
        FROM read_parquet('{SUPPLY_CHAIN}')
        WHERE MATERIAL_TYPE = 'SERVICE'
        GROUP BY 1, 2, 3, 4
        """
    ).fetchall()
    con.close()
    per_period: dict[tuple[str, str, str], Decimal] = {}
    fy: dict[tuple[str, str], Decimal] = {}
    for provider, recipient, gjahr, poper, total in rows:
        assert isinstance(total, Decimal)  # no floats off the warehouse
        period = f"{gjahr}-{int(poper):02d}"
        per_period[(provider, recipient, period)] = total
        fy[(provider, recipient)] = fy.get((provider, recipient), ZERO) + total
    return per_period, fy


def test_demo_gate_allocated_cost_equals_warehouse_pair_cb_to_the_cent():
    """M3 demo gate (ADAPTATION D5): the seeds flow Stages 1-4 with ZERO
    exceptions; Stage-4 allocated cost per (provider, recipient) equals the
    warehouse SERVICE pair cost base per period AND for the FY, TO THE CENT;
    the 100%-excluded management pools emit no allocations."""
    ref, exclusions, cost_lines = _demo_ref()
    wh_period, wh_fy = _warehouse_pair_cb()

    fy_allocated: dict[tuple[str, str], Decimal] = {}
    for provider, periods in PROVIDER_PERIODS.items():
        for period in periods:
            lines = [r for r in cost_lines
                     if r["provider_entity_id"] == provider
                     and r["fiscal_period"] == period]
            config = {"period": period,
                      "scope": {"providerEntityIds": [provider]}}
            s1 = stage1_capture_and_classify({"cost_lines": lines}, ref, config)
            assert s1["exceptions"] == [], (provider, period)
            s2 = stage2_pool(
                {"classified_lines": s1["outputs"]["classified_lines"]},
                ref, config)
            assert s2["exceptions"] == [], (provider, period)
            s3 = stage3_benefit_gate({"pools": s2["outputs"]["pools"]},
                                     exclusions, config)
            assert s3["exceptions"] == [], (provider, period)
            s4 = stage4_allocate({"pools": s3["outputs"]["pools"]}, ref, config)
            assert s4["exceptions"] == [], (provider, period)
            assert s4["outputs"]["blocked_pool_ids"] == []

            by_id = {p["pool_id"]: p for p in s4["outputs"]["pools"]}
            assert set(by_id) == {SERVICE_POOLS[provider], MGMT_POOLS[provider]}
            # management pool: 100% excluded -> zero base, no allocations
            mgmt = by_id[MGMT_POOLS[provider]]
            assert mgmt["allocations"] == [] and mgmt["total_allocated"] == ZERO
            # service pool: allocated cost per recipient == warehouse pair cb
            service = by_id[SERVICE_POOLS[provider]]
            assert service["key_id"] == service["default_key_id"]
            assert sum((a["allocated_cost"] for a in service["allocations"]),
                       ZERO) == service["chargeable_base"]
            expected = {rec: cb for (prov, rec, per), cb in wh_period.items()
                        if prov == provider and per == period}
            got = {a["recipient_entity_id"]: a["allocated_cost"]
                   for a in service["allocations"]}
            assert got == expected, (provider, period)
            assert abs(ONE - sum((a["allocation_ratio"]
                                  for a in service["allocations"]), ZERO)) \
                <= rules.RATIO_TOLERANCE
            for a in service["allocations"]:
                key = (a["provider_entity_id"], a["recipient_entity_id"])
                fy_allocated[key] = fy_allocated.get(key, ZERO) + a["allocated_cost"]

    # FY: allocated cost per (provider, recipient) == warehouse pair cb sums
    assert fy_allocated == wh_fy
    assert set(fy_allocated) == {("1000", "3000"), ("3100", "3200"),
                                 ("3100", "3300"), ("3100", "3800")}


def test_demo_participation_seed_matches_actual_service_pairs():
    """The 9_Participation seed carries the beneficiary populations per the
    actual warehouse pairs (1000->3000; 3100->3200/3300/3800) for every pool,
    plus one Provider row per pool."""
    rows = _seed_doc("participation.v1.json")["rows"]
    by_pool: dict[str, dict[str, list[str]]] = {}
    for r in rows:
        by_pool.setdefault(r["pool_id"], {}).setdefault(r["role"], []).append(
            r["entity_id"])
    assert set(by_pool) == {"POOL-IT-US", "POOL-MGMT-US",
                            "POOL-RSS-CH", "POOL-MGMT-CH"}
    for pool_id, provider, beneficiaries in (
        ("POOL-IT-US", "1000", ["3000"]),
        ("POOL-MGMT-US", "1000", ["3000"]),
        ("POOL-RSS-CH", "3100", ["3200", "3300", "3800"]),
        ("POOL-MGMT-CH", "3100", ["3200", "3300", "3800"]),
    ):
        assert by_pool[pool_id]["Provider"] == [provider], pool_id
        assert sorted(by_pool[pool_id]["Beneficiary"]) == beneficiaries, pool_id
    # beneficiaries carry a benefit rationale (benefit-test evidence)
    assert all(r.get("benefit_rationale")
               for r in rows if r["role"] == "Beneficiary")
