"""M2 gate — Stages 1-3: capture/classify, pooling, benefit-test gate
(SPEC §10 M2 + §4 stage contracts + §7 V-P/V-B rules; ADAPTATION D5).

Covers, in order:
- SPEC §9.1 edge cases relevant to Stages 1-3: split cost center remainder
  cent, pool that is 100% excluded, pass-through inside a marked-up pool,
  zero-cost pool;
- every M2 catalogue rule fired on a crafted bad input — V-R1, V-R2, V-R3,
  V-P1..V-P5, V-B1..V-B3 (rule IDs in test names, ENGINE-CLAUDE.md);
- effective-dating resolution (SPEC §5.5);
- determinism under input reordering (SPEC §5.1 convention);
- the demo seeds flowing through Stages 1-3 with zero exceptions, producing
  chargeable bases that equal the warehouse SERVICE pair cost-base sums per
  provider (and per period) TO THE CENT, with the management pools 100%
  stewardship-excluded (ADAPTATION D2).

NO float arithmetic on amounts anywhere in this file (ENGINE-CLAUDE.md).

Run from backend/:  ../.venv/bin/python -m pytest tests/allocation/test_m2_stages.py
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import duckdb
import pytest

from allocation.algorithms.effective_dating import period_bounds, resolve_as_of
from allocation.stages import (
    stage1_capture_and_classify,
    stage2_pool,
    stage3_benefit_gate,
)
from allocation.validation import rules
from config import SUPPLY_CHAIN

BACKEND = Path(__file__).resolve().parents[2]
SEED_DIR = BACKEND / "seeds" / "allocation"
PERIOD = "2026-05"
CFG = {"period": PERIOD}
ZERO = Decimal("0")


def _seed_doc(fname: str) -> dict:
    return json.loads((SEED_DIR / fname).read_text(encoding="utf-8"))


# ------------------------------------------------- crafted-fixture builders --


def mk_entity(entity_id: str, *, jurisdiction: str = "US",
              role: str = "Both", currency: str = "USD") -> dict:
    return {
        "entity_id": entity_id,
        "legal_entity_name": f"Entity {entity_id}",
        "company_code": entity_id,
        "jurisdiction": jurisdiction,
        "functional_currency": currency,
        "entity_role": role,
        "effective_from": "2026-01-01",
        "status": "Active",
    }


def mk_pool(pool_id: str, provider: str, *, service_line: str = "IT",
            **over) -> dict:
    row = {
        "pool_id": pool_id,
        "pool_name": f"Pool {pool_id}",
        "service_line": service_line,
        "service_description": "Crafted test pool.",
        "provider_entity_id": provider,
        "characterization": "Routine-benchmarked",
        "core_or_support": "Support",
        "unique_intangible_flag": False,
        "significant_risk_flag": False,
        "cost_base_definition": "Total services cost",
        "default_key_id": "KEY-X",
        "direct_charge_flag": False,
        "effective_from": "2026-01-01",
        "status": "Active",
    }
    row.update(over)
    return row


def mk_mapping(mapping_id: str, cost_center: str, pool_id: str, *,
               company: str = "1000", function: str = "IT",
               pct: str | None = None, **over) -> dict:
    row = {
        "mapping_id": mapping_id,
        "company_code": company,
        "cost_center": cost_center,
        "service_line_id": pool_id,
        "function": function,
        "effective_from": "2026-01-01",
        "effective_to": "2026-12-31",
        "version": 1,
        "owner": "TP Ops Lead",
    }
    if pct is not None:
        row["allocation_split_pct"] = pct
    row.update(over)
    return row


def mk_line(line_id: str, *, cost_center: str = "CC-A", company: str = "1000",
            provider: str = "1000", amount: str = "100.00", **over) -> dict:
    row = {
        "cost_line_id": line_id,
        "provider_entity_id": provider,
        "company_code": company,
        "cost_center": cost_center,
        "cost_element": "6500-Salaries",
        "cost_nature": "Payroll",
        "function": "IT",
        "amount_local": amount,
        "currency_local": "USD",
        "posting_date": "2026-05-31",
        "fiscal_period": PERIOD,
        "fiscal_year": "2026",
        "flow_type": "Service",
        "charge_method": "Indirect",
        "pass_through_flag": False,
        "source_document_ref": f"DOC-{line_id}",
    }
    row.update(over)
    return row


def mk_exclusion(exclusion_id: str, pool_id: str, *, pct: str | None = None,
                 amount: str | None = None, **over) -> dict:
    row = {
        "exclusion_id": exclusion_id,
        "pool_id": pool_id,
        "exclusion_type": "Stewardship",
        "basis_rationale": "Crafted test carve-out (shareholder activity).",
        "effective_from": "2026-05-01",
        "effective_to": "2026-05-31",
        "owner": "TP Manager",
    }
    if pct is not None:
        row["exclusion_pct"] = pct
    if amount is not None:
        row["exclusion_amount"] = amount
    row.update(over)
    return row


ENTITIES_T = [mk_entity("1000"), mk_entity("2000", jurisdiction="DE",
                                           role="Recipient", currency="EUR"),
              mk_entity("3100", jurisdiction="CH")]
POOLS_T = [mk_pool("POOL-A", "1000"),
           mk_pool("POOL-B", "1000", service_line="Management"),
           mk_pool("POOL-C", "1000", service_line="HR")]
MAPPINGS_T = [mk_mapping("MAP-A", "CC-A", "POOL-A")]


def ref_t(mappings=None, pools=None) -> dict:
    return {
        "entities": ENTITIES_T,
        "cc_mapping": MAPPINGS_T if mappings is None else mappings,
        "pools": POOLS_T if pools is None else pools,
    }


def run_s1(lines, mappings=None, config=CFG, pools=None) -> dict:
    return stage1_capture_and_classify(
        {"cost_lines": lines}, ref_t(mappings, pools), config)


def run_s1_s2(lines, mappings=None, config=CFG, pools=None) -> dict:
    s1 = run_s1(lines, mappings, config, pools)
    assert s1["exceptions"] == []
    return stage2_pool({"classified_lines": s1["outputs"]["classified_lines"]},
                       ref_t(mappings, pools), config)


def run_s3(pools_in, exclusions, config=CFG) -> dict:
    return stage3_benefit_gate({"pools": pools_in},
                               {"exclusions": exclusions}, config)


def pooled(lines, exclusions, mappings=None, config=CFG, pools=None) -> dict:
    s2 = run_s1_s2(lines, mappings, config, pools)
    assert s2["exceptions"] == []
    return run_s3(s2["outputs"]["pools"], exclusions, config)


# -------------------------------------------------------- effective dating --


def test_period_bounds_month_and_year():
    """SPEC §5.5 — period windows for monthly runs and the annual true-up."""
    assert period_bounds("2026-02") == ("2026-02-01", "2026-02-28")
    assert period_bounds("2026-05") == ("2026-05-01", "2026-05-31")
    assert period_bounds("2026") == ("2026-01-01", "2026-12-31")
    with pytest.raises(ValueError):
        period_bounds("2026-13")
    with pytest.raises(ValueError):
        period_bounds("May 2026")


def test_resolve_as_of_window_rule():
    """A row is in scope iff effective_from <= period_end and effective_to is
    null or >= period_start (SPEC §5.5)."""
    rows = [
        {"id": "open", "effective_from": "2026-01-01"},
        {"id": "spans", "effective_from": "2026-05-01", "effective_to": "2026-05-31"},
        {"id": "ended", "effective_from": "2026-01-01", "effective_to": "2026-04-30"},
        {"id": "future", "effective_from": "2026-06-01"},
        {"id": "overlaps-start", "effective_from": "2026-04-15", "effective_to": "2026-05-01"},
    ]
    in_scope = [r["id"] for r in resolve_as_of(rows, "2026-05")]
    assert in_scope == ["open", "spans", "overlaps-start"]


# ------------------------------------------------------ stage 1 — capture --


def test_stage1_split_remainder_cent_goes_to_largest_split():
    """SPEC §9.1 edge case: split cost center remainder cent. Children sum
    EXACTLY to the parent; the remainder cent lands on the largest split."""
    mappings = MAPPINGS_T + [
        mk_mapping("MAP-S1", "CC-SPLIT", "POOL-A", pct="0.6"),
        mk_mapping("MAP-S2", "CC-SPLIT", "POOL-B", pct="0.4", function="Management"),
    ]
    res = run_s1([mk_line("L1", cost_center="CC-SPLIT", amount="100.01")], mappings)
    assert res["exceptions"] == []
    children = res["outputs"]["classified_lines"]
    assert [c["cost_line_id"] for c in children] == ["L1::POOL-A", "L1::POOL-B"]
    # raw 60.006 / 40.004 -> floors 60.00 / 40.00; the remainder cent goes to
    # the largest split (60%).
    assert [c["amount_local"] for c in children] == ["60.01", "40.00"]
    assert sum(Decimal(c["amount_local"]) for c in children) == Decimal("100.01")
    assert [c["function"] for c in children] == ["IT", "Management"]
    # full lineage: child -> parent, mapping, split
    lineage = {l["cost_line_id"]: l for l in res["outputs"]["lineage"]}
    assert lineage["L1::POOL-A"]["source_cost_line_id"] == "L1"
    assert lineage["L1::POOL-A"]["mapping_id"] == "MAP-S1"
    assert lineage["L1::POOL-B"]["split_pct"] == "0.4"


def test_stage1_three_way_split_sums_exactly():
    """Multi-way split: every residual cent goes to the largest split and the
    children still sum exactly to the parent."""
    mappings = [
        mk_mapping("MAP-S1", "CC-SPLIT", "POOL-A", pct="0.5"),
        mk_mapping("MAP-S2", "CC-SPLIT", "POOL-B", pct="0.3", function="Management"),
        mk_mapping("MAP-S3", "CC-SPLIT", "POOL-C", pct="0.2", function="HR"),
    ]
    res = run_s1([mk_line("L1", cost_center="CC-SPLIT", amount="0.04")], mappings)
    assert res["exceptions"] == []
    amounts = [c["amount_local"] for c in res["outputs"]["classified_lines"]]
    # raw 0.02 / 0.012 / 0.008 -> floors 0.02 / 0.01 / 0.00; +0.01 to largest
    assert amounts == ["0.03", "0.01", "0.00"]
    assert sum(Decimal(a) for a in amounts) == Decimal("0.04")


def test_stage1_non_service_flows_route_to_excluded_flows():
    """Stage-1 flow_type gate: non-Service flows are classified and rejected
    to the excluded_flows holding output — no exception (SPEC §1 non-goals)."""
    res = run_s1([mk_line("L1"), mk_line("L2", flow_type="Royalty")])
    assert res["exceptions"] == []
    assert [c["cost_line_id"] for c in res["outputs"]["classified_lines"]] == ["L1"]
    held = res["outputs"]["excluded_flows"]
    assert [(h["cost_line_id"], h["flow_type"]) for h in held] == [("L2", "Royalty")]
    assert "out of scope" in held[0]["reason"]


def test_stage1_deterministic_under_input_reordering():
    """Determinism (SPEC §5.1 convention): identical outputs regardless of
    input order — lines process in ascending cost_line_id."""
    lines = [mk_line("L2", amount="2.00"), mk_line("L1"), mk_line("L3", amount="3.00")]
    a = run_s1(lines)
    b = run_s1(list(reversed(lines)))
    assert a == b
    assert [c["cost_line_id"] for c in a["outputs"]["classified_lines"]] == \
        ["L1", "L2", "L3"]


def test_v_r1_unresolved_fk_blocks_line():
    """V-R1 BLOCK — every FK in schema.json `references` must resolve."""
    res = run_s1([mk_line("L1", provider="9999")])
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-R1"]
    assert res["exceptions"][0]["severity"] == "BLOCK"
    assert res["outputs"]["classified_lines"] == []
    assert res["outputs"]["held_line_ids"] == ["L1"]


def test_v_r2_schema_violations_block_line():
    """V-R2 BLOCK — enum fields validate against the enumerations; floats on
    amounts and missing mandatory fields are equally schema-gate failures."""
    res = run_s1([mk_line("L1", flow_type="Dividend")])
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-R2"]
    assert "flow_type" in res["exceptions"][0]["message"]

    bad_float = mk_line("L2")
    bad_float["amount_local"] = 100.0  # float on an amount — forbidden
    res = run_s1([bad_float])
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-R2"]
    assert "float" in res["exceptions"][0]["message"]
    assert res["outputs"]["held_line_ids"] == ["L2"]


def test_v_r3_negative_amount_blocks_unless_registered_reversal():
    """V-R3 BLOCK — amounts non-negative except explicit reversal rows
    (registered via config['reversal_document_refs']; no silent heuristic)."""
    res = run_s1([mk_line("L1", amount="-50.00")])
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-R3"]
    assert res["outputs"]["held_line_ids"] == ["L1"]

    cfg = dict(CFG, reversal_document_refs=["DOC-L1"])
    res = run_s1([mk_line("L1", amount="-50.00")], config=cfg)
    assert res["exceptions"] == []
    assert [c["amount_local"] for c in res["outputs"]["classified_lines"]] == ["-50.00"]


def test_v_p1_unmapped_cost_center_blocks_line():
    """V-P1 BLOCK — every Service cost line maps to exactly one pool; a
    mapping that has expired as-of the run period leaves the cost center
    unmapped (exception queue)."""
    expired = [mk_mapping("MAP-A", "CC-A", "POOL-A", effective_to="2026-01-31")]
    res = run_s1([mk_line("L1")], expired)
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-P1"]
    assert "no 2_CCMapping row in scope" in res["exceptions"][0]["message"]
    assert res["outputs"]["held_line_ids"] == ["L1"]


def test_v_p1_pre_assigned_pool_conflict_blocks_line():
    """V-P1 BLOCK — a pre-assigned pool_id contradicting the as-of mapping is
    not 'exactly one pool'."""
    res = run_s1([mk_line("L1", pool_id="POOL-B")])  # mapping says POOL-A
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-P1"]
    assert "contradicts mapping" in res["exceptions"][0]["message"]


def test_v_p2_split_pcts_must_sum_to_100():
    """V-P2 BLOCK — allocation_split_pct per cost center sums to 100%; the
    rule fires once per cost center and all its lines are held."""
    bad = [
        mk_mapping("MAP-S1", "CC-SPLIT", "POOL-A", pct="0.6"),
        mk_mapping("MAP-S2", "CC-SPLIT", "POOL-B", pct="0.3", function="Management"),
    ]
    res = run_s1([mk_line("L1", cost_center="CC-SPLIT"),
                  mk_line("L2", cost_center="CC-SPLIT")], bad)
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-P2"]  # once per CC
    assert "sums to 0.9" in res["exceptions"][0]["message"]
    assert res["outputs"]["classified_lines"] == []
    assert res["outputs"]["held_line_ids"] == ["L1", "L2"]


# -------------------------------------------------------- stage 2 — pool --


def test_stage2_pool_totals_with_line_id_lineage():
    """Stage-2 contract: pool totals carry full lineage to constituent line
    IDs; zero-cost in-scope pools are emitted (SPEC §9.1 zero-cost pool)."""
    res = run_s1_s2([mk_line("L1"), mk_line("L2", amount="23.45")])
    assert res["exceptions"] == []
    by_id = {p["pool_id"]: p for p in res["outputs"]["pools"]}
    assert by_id["POOL-A"]["total_pooled_cost"] == Decimal("123.45")
    assert by_id["POOL-A"]["line_ids"] == ["L1", "L2"]
    assert by_id["POOL-A"]["provider_entity_id"] == "1000"
    # POOL-B / POOL-C are in scope and active but received no lines
    assert by_id["POOL-B"]["total_pooled_cost"] == ZERO
    assert by_id["POOL-B"]["line_ids"] == []


def test_stage2_pass_through_inside_marked_up_pool_routes_at_cost():
    """SPEC §9.1 edge case: a pass-through line inside a marked-up pool joins
    the pass-through stream (at cost, no markup — V-P4) and never dilutes the
    pool total."""
    pt = mk_line("L2", amount="77.00", pass_through_flag=True,
                 traceable_recipient_id="2000")
    res = run_s1_s2([mk_line("L1"), pt])
    assert res["exceptions"] == []
    pool_a = next(p for p in res["outputs"]["pools"] if p["pool_id"] == "POOL-A")
    assert pool_a["total_pooled_cost"] == Decimal("100.00")  # L2 not pooled
    assert pool_a["line_ids"] == ["L1"]
    stream = res["outputs"]["pass_through"]
    assert [(l["cost_line_id"], l["traceable_recipient_id"]) for l in stream] == \
        [("L2", "2000")]


def test_stage2_direct_charge_stream_bypasses_pooling():
    """Stage-2 stream (a): Direct lines with a traceable recipient bypass
    Stage-4 apportionment; Direct lines without one cannot be routed (V-P1)."""
    direct = mk_line("L2", charge_method="Direct", traceable_recipient_id="2000")
    res = run_s1_s2([mk_line("L1"), direct])
    assert res["exceptions"] == []
    assert [l["cost_line_id"] for l in res["outputs"]["direct_charges"]] == ["L2"]
    pool_a = next(p for p in res["outputs"]["pools"] if p["pool_id"] == "POOL-A")
    assert pool_a["line_ids"] == ["L1"]

    res = run_s1_s2([mk_line("L3", charge_method="Direct")])
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-P1"]
    assert res["outputs"]["held_line_ids"] == ["L3"]


def test_v_p3_pool_homogeneity_drift_warns_but_pool_continues():
    """V-P3 WARN — a pool receiving more than one function drifts from
    homogeneity; the pool is reported but NOT withheld."""
    mappings = MAPPINGS_T + [mk_mapping("MAP-B", "CC-B", "POOL-A", function="HR")]
    res = run_s1_s2([mk_line("L1"), mk_line("L2", cost_center="CC-B")], mappings)
    fired = rules.fired(res["exceptions"], "V-P3")
    assert len(fired) == 1 and fired[0]["severity"] == "WARN"
    assert fired[0]["pool_id"] == "POOL-A"
    pool_a = next(p for p in res["outputs"]["pools"] if p["pool_id"] == "POOL-A")
    assert pool_a["total_pooled_cost"] == Decimal("200.00")  # WARN: continues


def test_v_p3_pool_homogeneity_cost_center_threshold():
    """V-P3 WARN — > N (config, default 25) distinct cost centers."""
    mappings = [mk_mapping(f"MAP-{i:02d}", f"CC-{i:02d}", "POOL-A")
                for i in range(3)]
    lines = [mk_line(f"L{i}", cost_center=f"CC-{i:02d}") for i in range(3)]
    cfg = dict(CFG, poolHomogeneityMaxCostCenters=2)
    res = run_s1_s2(lines, mappings, config=cfg)
    fired = rules.fired(res["exceptions"], "V-P3")
    assert len(fired) == 1
    assert "3 distinct cost centers" in fired[0]["message"]


def test_v_p4_pass_through_without_recipient_blocks():
    """V-P4 BLOCK — pass-through lines must have traceable_recipient_id (and
    by construction never receive markup: they bypass pool totals)."""
    res = run_s1_s2([mk_line("L1", pass_through_flag=True)])
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-P4"]
    assert res["exceptions"][0]["severity"] == "BLOCK"
    assert res["outputs"]["pass_through"] == []
    assert res["outputs"]["held_line_ids"] == ["L1"]


def test_v_p5_single_provider_per_pool_blocks_pool():
    """V-P5 BLOCK — single provider per pool (v1, SPEC §3.3): a foreign
    provider's line halts the pool, which is withheld from the outputs."""
    mappings = MAPPINGS_T + [
        mk_mapping("MAP-F", "CC-F", "POOL-A", company="3100")]
    foreign = mk_line("L2", cost_center="CC-F", company="3100", provider="3100")
    res = run_s1_s2([mk_line("L1"), foreign], mappings)
    fired = rules.fired(res["exceptions"], "V-P5")
    assert len(fired) == 1 and fired[0]["pool_id"] == "POOL-A"
    assert fired[0]["objects"] == ["3100"]
    assert "POOL-A" not in [p["pool_id"] for p in res["outputs"]["pools"]]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


# ------------------------------------------------- stage 3 — benefit gate --


def test_stage3_pool_100_percent_excluded_yields_zero_chargeable_base():
    """SPEC §9.1 edge case: a pool that is 100% excluded flows through with a
    zero chargeable base — exactly 100% is allowed (V-B1 is >100%)."""
    res = pooled([mk_line("L1", amount="500.00")],
                 [mk_exclusion("EX-1", "POOL-A", pct="1")])
    assert res["exceptions"] == []
    pool_a = next(p for p in res["outputs"]["pools"] if p["pool_id"] == "POOL-A")
    assert pool_a["total_exclusions"] == Decimal("500.00")
    assert pool_a["chargeable_base"] == ZERO
    ledger = res["outputs"]["exclusion_ledger"]
    assert [(e["exclusion_id"], e["amount"]) for e in ledger] == \
        [("EX-1", Decimal("500.00"))]
    # pct carve-outs keep line-level lineage
    assert ledger[0]["line_allocations"] == \
        [{"cost_line_id": "L1", "amount": Decimal("500.00")}]


def test_stage3_pct_exclusions_apply_to_original_total_non_compounding():
    """SPEC §4 Stage 3: multiple percentage exclusions each apply to the
    ORIGINAL pool total — 30% + 20% of 1000 is 500, not 300 + 140."""
    res = pooled(
        [mk_line("L1", amount="600.00"), mk_line("L2", amount="400.00")],
        [mk_exclusion("EX-1", "POOL-A", pct="0.3"),
         mk_exclusion("EX-2", "POOL-A", pct="0.2")],
    )
    assert res["exceptions"] == []
    pool_a = next(p for p in res["outputs"]["pools"] if p["pool_id"] == "POOL-A")
    assert pool_a["total_exclusions"] == Decimal("500.00")
    assert pool_a["chargeable_base"] == Decimal("500.00")
    assert pool_a["exclusions_applied"] == ["EX-1", "EX-2"]
    by_id = {e["exclusion_id"]: e for e in res["outputs"]["exclusion_ledger"]}
    # pro-rata across constituent lines, summing exactly to each row's amount
    assert by_id["EX-1"]["line_allocations"] == [
        {"cost_line_id": "L1", "amount": Decimal("180.000")},
        {"cost_line_id": "L2", "amount": Decimal("120.000")},
    ]
    assert by_id["EX-2"]["amount"] == Decimal("200.000")


def test_stage3_fixed_amount_exclusion_deducts_at_pool_level():
    """Fixed-amount exclusions deduct from the pool with a documented basis;
    they carry no per-line allocation (pool-level by design)."""
    res = pooled([mk_line("L1", amount="500.00")],
                 [mk_exclusion("EX-1", "POOL-A", amount="125.00")])
    assert res["exceptions"] == []
    pool_a = next(p for p in res["outputs"]["pools"] if p["pool_id"] == "POOL-A")
    assert pool_a["chargeable_base"] == Decimal("375.00")
    entry = res["outputs"]["exclusion_ledger"][0]
    assert entry["pct"] is None and entry["line_allocations"] == []
    assert entry["basis_rationale"].startswith("Crafted test carve-out")


def test_v_b1_combined_exclusions_over_100_pct_block_pool():
    """V-B1 BLOCK — combined exclusions on a pool <= 100%: percentage rows
    summing past 100% (or fixed amounts exceeding the pool) halt the pool."""
    res = pooled([mk_line("L1", amount="500.00")],
                 [mk_exclusion("EX-1", "POOL-A", pct="0.7"),
                  mk_exclusion("EX-2", "POOL-A", pct="0.5")])
    fired = rules.fired(res["exceptions"], "V-B1")
    assert fired and all(e["severity"] == "BLOCK" for e in fired)
    assert "POOL-A" not in [p["pool_id"] for p in res["outputs"]["pools"]]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]
    assert res["outputs"]["exclusion_ledger"] == []  # withheld with the pool

    res = pooled([mk_line("L1", amount="100.00")],
                 [mk_exclusion("EX-1", "POOL-A", amount="150.00")])
    fired = rules.fired(res["exceptions"], "V-B1")
    assert fired and fired[0]["pool_id"] == "POOL-A"
    assert "POOL-A" not in [p["pool_id"] for p in res["outputs"]["pools"]]


def test_v_b2_management_pool_without_stewardship_warns():
    """V-B2 WARN — a Management pool with cost and no stewardship exclusion
    row is a likely missing carve-out; the pool continues."""
    mappings = [mk_mapping("MAP-B", "CC-A", "POOL-B", function="Management")]
    res = pooled([mk_line("L1", function="Management")], [], mappings)
    fired = rules.fired(res["exceptions"], "V-B2")
    assert len(fired) == 1 and fired[0]["severity"] == "WARN"
    assert fired[0]["pool_id"] == "POOL-B"
    pool_b = next(p for p in res["outputs"]["pools"] if p["pool_id"] == "POOL-B")
    assert pool_b["chargeable_base"] == Decimal("100.00")  # WARN: continues
    # zero-cost Management pools do not warn (nothing to carve out)
    res = pooled([], [], mappings)
    assert rules.fired(res["exceptions"], "V-B2") == []


def test_v_b3_exclusion_rows_need_a_determinate_basis():
    """V-B3 BLOCK — every exclusion row has a non-empty basis_rationale and
    exactly one of exclusion_pct / exclusion_amount ('Use pct OR amount')."""
    no_basis = mk_exclusion("EX-1", "POOL-A", pct="0.1", basis_rationale="   ")
    res = pooled([mk_line("L1")], [no_basis])
    fired = rules.fired(res["exceptions"], "V-B3")
    assert len(fired) == 1 and "basis_rationale is empty" in fired[0]["message"]
    assert "POOL-A" not in [p["pool_id"] for p in res["outputs"]["pools"]]

    both = mk_exclusion("EX-2", "POOL-A", pct="0.1", amount="10.00")
    res = pooled([mk_line("L1")], [both])
    assert "both" in rules.fired(res["exceptions"], "V-B3")[0]["message"]

    neither = mk_exclusion("EX-3", "POOL-A")
    res = pooled([mk_line("L1")], [neither])
    assert "neither" in rules.fired(res["exceptions"], "V-B3")[0]["message"]


def test_stage3_exclusions_resolve_as_of_period():
    """Exclusion rows are effective-dated: a row bounded to another month
    never reaches this period's gate (SPEC §5.5)."""
    other_month = mk_exclusion("EX-1", "POOL-A", pct="1",
                               effective_from="2026-11-01",
                               effective_to="2026-11-30")
    res = pooled([mk_line("L1")], [other_month])
    assert res["exceptions"] == []
    pool_a = next(p for p in res["outputs"]["pools"] if p["pool_id"] == "POOL-A")
    assert pool_a["total_exclusions"] == ZERO
    assert pool_a["chargeable_base"] == Decimal("100.00")


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
    }
    exclusions = {"exclusions": _seed_doc("exclusions.v1.json")["rows"]}
    cost_lines = _seed_doc("cost_lines.v1.json")["actual"]
    return ref, exclusions, cost_lines


def _warehouse_cb() -> tuple[dict, dict]:
    """Warehouse SERVICE pair cost base per provider and per (provider, period)
    — Decimal end to end (DuckDB DECIMAL)."""
    con = duckdb.connect()
    rows = con.execute(
        f"""
        SELECT SELLING_COMPANY, GJAHR, POPER, SUM(STANDARD_COST * TOTAL_VOLUME)
        FROM read_parquet('{SUPPLY_CHAIN}')
        WHERE MATERIAL_TYPE = 'SERVICE'
        GROUP BY 1, 2, 3
        """
    ).fetchall()
    con.close()
    per_period: dict[tuple[str, str], Decimal] = {}
    per_provider: dict[str, Decimal] = {}
    for provider, gjahr, poper, total in rows:
        assert isinstance(total, Decimal)  # no floats off the warehouse
        period = f"{gjahr}-{int(poper):02d}"
        per_period[(provider, period)] = total
        per_provider[provider] = per_provider.get(provider, ZERO) + total
    return per_provider, per_period


def test_demo_seeds_flow_stages_1_to_3_and_tie_to_warehouse_to_the_cent():
    """M2 gate (ADAPTATION D5): the demo seeds flow through Stages 1-3 with
    ZERO exceptions; per (provider, period) the service pool's chargeable base
    equals the warehouse SERVICE pair cost-base sum exactly; the management
    pools are 100% stewardship-excluded (base 0); per provider the FY total of
    chargeable bases equals the warehouse pair cb sum TO THE CENT."""
    ref, exclusions, cost_lines = _demo_ref()
    wh_provider, wh_period = _warehouse_cb()
    assert set(wh_provider) == {"1000", "3100"}

    fy_chargeable: dict[str, Decimal] = {"1000": ZERO, "3100": ZERO}
    for provider, periods in PROVIDER_PERIODS.items():
        for period in periods:
            lines = [r for r in cost_lines
                     if r["provider_entity_id"] == provider
                     and r["fiscal_period"] == period]
            config = {"period": period,
                      "scope": {"providerEntityIds": [provider]}}
            s1 = stage1_capture_and_classify({"cost_lines": lines}, ref, config)
            assert s1["exceptions"] == [], (provider, period)
            assert s1["outputs"]["excluded_flows"] == []
            assert s1["outputs"]["held_line_ids"] == []
            s2 = stage2_pool(
                {"classified_lines": s1["outputs"]["classified_lines"]},
                ref, config)
            assert s2["exceptions"] == [], (provider, period)
            assert s2["outputs"]["direct_charges"] == []
            assert s2["outputs"]["pass_through"] == []
            s3 = stage3_benefit_gate({"pools": s2["outputs"]["pools"]},
                                     exclusions, config)
            assert s3["exceptions"] == [], (provider, period)

            by_id = {p["pool_id"]: p for p in s3["outputs"]["pools"]}
            assert set(by_id) == {SERVICE_POOLS[provider], MGMT_POOLS[provider]}
            service = by_id[SERVICE_POOLS[provider]]
            mgmt = by_id[MGMT_POOLS[provider]]
            # service pool: chargeable base == warehouse pair cb, to the cent
            assert service["total_exclusions"] == ZERO
            assert service["chargeable_base"] == wh_period[(provider, period)], \
                (provider, period)
            # management pool: 100% stewardship-excluded (SPEC §9.1 edge case)
            assert mgmt["total_exclusions"] == mgmt["total_pooled_cost"]
            assert mgmt["chargeable_base"] == ZERO
            assert all(e["exclusion_type"] == "Stewardship"
                       for e in s3["outputs"]["exclusion_ledger"])
            for pool in by_id.values():
                fy_chargeable[provider] += pool["chargeable_base"]

    # FY: Σ chargeable bases per provider == warehouse pair cb sums, to the cent
    assert fy_chargeable["1000"] == wh_provider["1000"]
    assert fy_chargeable["3100"] == wh_provider["3100"]


def test_demo_corporate_center_splits_20_80_with_lineage():
    """Each impure corporate sub-center (PB1: Finance/HR/Legal/Facilities/Board)
    splits 20/80 into the provider's service and management pools via cc_mapping
    (V-P2 sums to 100%), with child IDs and lineage tying back to the parent
    line. Exercised here on the Group Finance sub-center (CC-1000-CORP-FIN)."""
    ref, _exclusions, cost_lines = _demo_ref()
    lines = [r for r in cost_lines
             if r["provider_entity_id"] == "1000" and r["fiscal_period"] == "2026-05"]
    config = {"period": "2026-05", "scope": {"providerEntityIds": ["1000"]}}
    s1 = stage1_capture_and_classify({"cost_lines": lines}, ref, config)
    assert s1["exceptions"] == []
    fin_children = {
        l["cost_line_id"]: l for l in s1["outputs"]["classified_lines"]
        if l["cost_center"] == "CC-1000-CORP-FIN"
    }
    assert set(fin_children) == {
        "CL-1000-2026-05-CORP-FIN::POOL-IT-US",
        "CL-1000-2026-05-CORP-FIN::POOL-MGMT-US",
    }
    parent_amount = Decimal("796875.00")  # 0.30 of the 2,656,250.00 corp cost
    assert Decimal(fin_children["CL-1000-2026-05-CORP-FIN::POOL-IT-US"]["amount_local"]) \
        == parent_amount * Decimal("0.2")
    assert sum(Decimal(c["amount_local"]) for c in fin_children.values()) \
        == parent_amount
    lineage = {l["cost_line_id"]: l for l in s1["outputs"]["lineage"]}
    assert lineage["CL-1000-2026-05-CORP-FIN::POOL-MGMT-US"]["source_cost_line_id"] \
        == "CL-1000-2026-05-CORP-FIN"
    assert lineage["CL-1000-2026-05-CORP-FIN::POOL-MGMT-US"]["split_pct"] == "0.8"
    # stage 2 lineage: the service pool total is the 6 pure IT lines + the 5
    # corporate sub-center service children (PB1 finer grain).
    s2 = stage2_pool({"classified_lines": s1["outputs"]["classified_lines"]},
                     ref, config)
    pool_it = next(p for p in s2["outputs"]["pools"]
                   if p["pool_id"] == "POOL-IT-US")
    assert pool_it["line_ids"] == [
        "CL-1000-2026-05-CORP-BOARD::POOL-IT-US",
        "CL-1000-2026-05-CORP-FAC::POOL-IT-US",
        "CL-1000-2026-05-CORP-FIN::POOL-IT-US",
        "CL-1000-2026-05-CORP-HR::POOL-IT-US",
        "CL-1000-2026-05-CORP-LEGAL::POOL-IT-US",
        "CL-1000-2026-05-IT-HOST-CLOUD",
        "CL-1000-2026-05-IT-HOST-COLO",
        "CL-1000-2026-05-IT-NET-INET",
        "CL-1000-2026-05-IT-NET-MPLS",
        "CL-1000-2026-05-IT-OPS-ERP",
        "CL-1000-2026-05-IT-OPS-SUPPORT",
    ]


def test_demo_exclusion_ledger_matches_stewardship_register_rows():
    """Stage-3 exclusion ledger carries the OTP-15 register's flagged lines
    (fixed amounts + rationale) for the period, summing to the period's
    management cost exactly."""
    ref, exclusions, cost_lines = _demo_ref()
    lines = [r for r in cost_lines
             if r["provider_entity_id"] == "3100" and r["fiscal_period"] == "2026-04"]
    config = {"period": "2026-04", "scope": {"providerEntityIds": ["3100"]}}
    s1 = stage1_capture_and_classify({"cost_lines": lines}, ref, config)
    s2 = stage2_pool({"classified_lines": s1["outputs"]["classified_lines"]},
                     ref, config)
    s3 = stage3_benefit_gate({"pools": s2["outputs"]["pools"]},
                             exclusions, config)
    assert s3["exceptions"] == []
    ledger = [e for e in s3["outputs"]["exclusion_ledger"]
              if e["pool_id"] == "POOL-MGMT-CH"]
    assert [e["exclusion_id"] for e in ledger] == \
        ["EX-STW-3-2026-04", "EX-STW-5-2026-04"]
    assert sum((e["amount"] for e in ledger), ZERO) == Decimal("1350000.00")
    assert all(e["pct"] is None for e in ledger)  # fixed-amount carve-outs
    assert all("OTP-15" in e["basis_rationale"] for e in ledger)
