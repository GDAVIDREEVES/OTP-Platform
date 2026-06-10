"""M6 gate — Stage 7 recon, true-up, documentation pack, exception report,
orchestrator atomicity (SPEC §4 Stage 7 + §5.4 + §8 + §7 V-X rules;
ADAPTATION D5).

Covers, in order (rule IDs in test names — ENGINE-CLAUDE.md):
- stage7_reconcile: Balanced rows with EXACTLY zero residual; V-X1 BLOCK on
  a nonzero residual; V-X2 BLOCK on ledger ≠ chargeable base (per pool, and
  at GROUP grain for reciprocal SCCs); the 100%-excluded zero-base pool;
  true_up_delta recording;
- algorithms/trueup.py: deltas per (pool, provider, recipient) vs the booked
  Budget charges; parents = latest booked charge; negative delta rows
  (corrections are reversing rows); V-X3 WARN over the threshold only; the
  V-X4 facets (amount mismatch / duplicate booking / unreproducible booked
  row); never-booked recompute legs excluded from the subtrahend; FX of the
  delta at the trueUpFxRateType (identity logged, missing snapshot V-R1);
- the SPEC §5.2 "single" guarantee in an SCC: an upstream received component
  injected into a cycle member is NOT re-margined (DECISIONS.md M6);
- docpack: SPEC §8.3 sections rendered with the run's own figures; SPEC §8.4
  exception report with per-rule remediation;
- the orchestrator: all-or-nothing persistence (a V-M1 BLOCK fails the run
  and writes NO ledger rows) and the V-X4 prior-run output-hash gate.

NO float arithmetic on amounts anywhere in this file (ENGINE-CLAUDE.md).

Run from backend/:
    ../.venv/bin/python -m pytest tests/allocation/test_m6_stage7_trueup_docpack.py
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest

import services.allocation_runner as runner
import state.allocation_store as store
from allocation import docpack
from allocation.algorithms.cascade import cascade_allocate
from allocation.algorithms.trueup import true_up
from allocation.stages import stage7_reconcile
from allocation.validation import rules

PERIOD = "2026-05"
YEAR = "2026"
ZERO = Decimal("0")
CFG = {"period": PERIOD}

GOLD = Path(__file__).resolve().parent / "golden"


# ------------------------------------------------- crafted-fixture builders --


def mk_leg(pool: str, recipient: str, cost: str, *, markup: str = "0.00",
           pct: str = "0.05", kind: str = "allocated",
           provider: str = "1000", period: str = PERIOD,
           currency: str = "USD") -> dict:
    return {
        "pool_id": pool,
        "provider_entity_id": provider,
        "recipient_entity_id": recipient,
        "period": period,
        "charge_kind": kind,
        "cost_currency": currency,
        "cost_recovered": Decimal(cost),
        "markup_pct": Decimal(pct),
        "markup_amount": Decimal(markup),
        "gross_charge": Decimal(cost) + Decimal(markup),
    }


def mk_pool5(pool: str, *, pooled: str, exclusions: str = "0",
             legs: list[dict] | None = None, provider: str = "1000",
             scc: list[str] | None = None, **over) -> dict:
    legs = legs or []
    row = {
        "pool_id": pool,
        "provider_entity_id": provider,
        "period": PERIOD,
        "service_line": "IT",
        "characterization": "LVAIGS",
        "documentation_ref": None,
        "total_pooled_cost": Decimal(pooled),
        "total_exclusions": Decimal(exclusions),
        "chargeable_base": Decimal(pooled) - Decimal(exclusions),
        "key_id": "KEY-X",
        "total_factor_value": Decimal("1"),
        "lines": [],
        "allocations": [],
        "charges": legs,
        "total_markup": sum((c["markup_amount"] for c in legs), ZERO),
        "total_gross": sum((c["gross_charge"] for c in legs), ZERO),
    }
    if scc:
        row["reciprocal_scc"] = scc
    row.update(over)
    return row


def run_s7(pools, true_up_by_pool=None, config=CFG):
    inputs = {"pools": pools}
    if true_up_by_pool is not None:
        inputs["true_up_by_pool"] = true_up_by_pool
    return stage7_reconcile(inputs, {}, config)


# ----------------------------------------------------------- stage 7 — V-X --


def test_stage7_balanced_pool_zero_residual():
    """Sheet-11 row per (pool, provider, period): pooled − exclusions −
    recovered = 0 → Balanced, no exceptions."""
    legs = [mk_leg("POOL-A", "2000", "60.00", markup="3.00"),
            mk_leg("POOL-A", "2100", "40.00", markup="2.00")]
    res = run_s7([mk_pool5("POOL-A", pooled="125.00", exclusions="25.00",
                           legs=legs)])
    assert res["exceptions"] == []
    (row,) = res["outputs"]["recon"]
    assert row["recon_status"] == "Balanced"
    assert row["unallocated_residual"] == ZERO
    assert row["total_pooled_cost"] == Decimal("125.00")
    assert row["total_exclusions"] == Decimal("25.00")
    assert row["total_cost_recovered"] == Decimal("100.00")
    assert row["total_markup"] == Decimal("5.00")
    assert row["total_charged_out"] == Decimal("105.00")
    assert row["break_amount"] is None
    assert row["true_up_delta"] is None


def test_stage7_v_x1_v_x2_nonzero_residual_blocks_and_breaks():
    """V-X1 BLOCK — residual != 0 (v1 hard zero); V-X2 BLOCK — Σ charged-out
    cost != chargeable base. The recon row is still emitted as evidence
    (status Break, break_amount set) and the pool is blocked."""
    legs = [mk_leg("POOL-A", "2000", "90.00", markup="4.50")]  # 10 short
    res = run_s7([mk_pool5("POOL-A", pooled="100.00", legs=legs)])
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-X2", "V-X1"]
    assert all(e["severity"] == "BLOCK" for e in res["exceptions"])
    (row,) = res["outputs"]["recon"]
    assert row["recon_status"] == "Break"
    assert row["unallocated_residual"] == Decimal("10.00")
    assert row["break_amount"] == Decimal("10.00")
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_stage7_zero_base_fully_excluded_pool_balances():
    """SPEC §9.1 edge case — the 100%-excluded pool: pooled == exclusions,
    nothing recovered, residual exactly zero, Balanced."""
    res = run_s7([mk_pool5("POOL-Z", pooled="500.00", exclusions="500.00")])
    assert res["exceptions"] == []
    (row,) = res["outputs"]["recon"]
    assert row["recon_status"] == "Balanced"
    assert row["total_cost_recovered"] == ZERO
    assert row["unallocated_residual"] == ZERO


def test_stage7_scc_reconciles_at_group_grain_v_x2():
    """DECISIONS.md M5 #54 / M6 — inside a reciprocal cycle the per-pool
    ledger differs from the pool's own base by design; the GROUP sums tie
    and each member reports full recovery of its base (residual zero)."""
    scc = ["POOL-A", "POOL-B"]
    # group base 100 + 50 = 150; ledger keyed 120 (A) + 30 (B) = 150
    a = mk_pool5("POOL-A", pooled="100.00", scc=scc,
                 legs=[mk_leg("POOL-A", "3000", "120.00", markup="6.00")])
    b = mk_pool5("POOL-B", pooled="50.00", provider="2000", scc=scc,
                 legs=[mk_leg("POOL-B", "3000", "30.00", markup="1.50",
                              provider="2000")])
    res = run_s7([a, b])
    assert res["exceptions"] == []
    rows = {r["pool_id"]: r for r in res["outputs"]["recon"]}
    assert rows["POOL-A"]["total_cost_recovered"] == Decimal("100.00")
    assert rows["POOL-B"]["total_cost_recovered"] == Decimal("50.00")
    assert all(r["recon_status"] == "Balanced" for r in rows.values())
    # a group that does NOT tie fires V-X2 per member pool
    b_short = mk_pool5("POOL-B", pooled="50.00", provider="2000", scc=scc,
                       legs=[mk_leg("POOL-B", "3000", "20.00",
                                    provider="2000")])
    res = run_s7([a, b_short])
    fired = rules.fired(res["exceptions"], "V-X2")
    assert sorted(e["pool_id"] for e in fired) == ["POOL-A", "POOL-B"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A", "POOL-B"]


def test_stage7_records_true_up_delta_on_recon():
    """SPEC §5.4 — true_up_delta lands on the 11_Recon row (the V-X3
    threshold WARN itself is the true-up algorithm's, not stage 7's)."""
    legs = [mk_leg("POOL-A", "2000", "100.00", markup="5.00")]
    res = run_s7([mk_pool5("POOL-A", pooled="100.00", legs=legs)],
                 true_up_by_pool={"POOL-A": {"delta_gross": Decimal("42.00"),
                                             "actual_gross": Decimal("105.00")}})
    assert res["exceptions"] == []
    (row,) = res["outputs"]["recon"]
    assert row["true_up_delta"] == Decimal("42.00")


# ------------------------------------------------------------- true-up -------


def mk_booked(pool: str, recipient: str, period: str, cost: str, markup: str,
              *, run: str = "RUN-B", provider: str = "1000",
              fx: str = "1.0", currency: str = "USD") -> dict:
    return {
        "charge_id": f"{run}:CHG-{period}-{pool}-{recipient}",
        "pool_id": pool,
        "provider_entity_id": provider,
        "recipient_entity_id": recipient,
        "period": period,
        "fiscal_year": YEAR,
        "budget_or_actual": "Budget",
        "cost_recovered_amount": cost,
        "markup_pct_applied": "0.05",
        "markup_amount": markup,
        "gross_charge_amount": str(Decimal(cost) + Decimal(markup)),
        "charge_currency": currency,
        "fx_rate": fx,
        "fx_rate_type": "Monthly average",
        "fx_rate_date": f"{period}-28",
        "posting_date": f"{period}-28",
    }


ENTITIES_T = [
    {"entity_id": "1000", "legal_entity_name": "P", "company_code": "1000",
     "jurisdiction": "US", "functional_currency": "USD",
     "entity_role": "Both", "effective_from": "2026-01-01",
     "status": "Active"},
    {"entity_id": "2000", "legal_entity_name": "R", "company_code": "2000",
     "jurisdiction": "DE", "functional_currency": "EUR",
     "entity_role": "Recipient", "effective_from": "2026-01-01",
     "status": "Active"},
]

TU_CFG = {"year": YEAR, "trueUpFxRateType": "year_end_closing",
          "trueUpWarnThreshold": 0.10, "chargeCurrency": "provider"}


def run_tu(actual, budget, booked, *, ref=None, config=None):
    return true_up(
        {"actual_charges": actual, "budget_charges": budget,
         "booked_budget_rows": booked},
        ref or {"entities": ENTITIES_T, "trueup_fx_rates": []},
        config or TU_CFG)


def test_trueup_delta_per_triple_with_latest_booked_parent_v_x3():
    """SPEC §5.4 — delta = actual full year − Σ booked Budget charges per
    (pool, provider, recipient); one True-up row per triple, parent = the
    LATEST booked Budget charge; V-X3 fires only over the threshold."""
    budget = [mk_leg("POOL-A", "2000", "100.00", markup="5.00", period="2026-01"),
              mk_leg("POOL-A", "2000", "100.00", markup="5.00", period="2026-02")]
    actual = [mk_leg("POOL-A", "2000", "120.00", markup="6.00", period="2026-01"),
              mk_leg("POOL-A", "2000", "120.00", markup="6.00", period="2026-02")]
    booked = [mk_booked("POOL-A", "2000", "2026-01", "100.00", "5.00"),
              mk_booked("POOL-A", "2000", "2026-02", "100.00", "5.00")]
    res = run_tu(actual, budget, booked)
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-X3"]  # 42/252 > 10%
    (row,) = res["outputs"]["true_up_rows"]
    assert row["charge_id"] == "CHG-2026-POOL-A-2000-TRUEUP"
    assert row["budget_or_actual"] == "True-up"
    assert row["period"] == YEAR
    assert row["cost_recovered_amount"] == "40.00"
    assert row["markup_amount"] == "2.00"
    assert row["gross_charge_amount"] == "42.00"
    assert row["markup_pct_applied"] == "0.05"
    assert row["true_up_parent_charge_id"] == "RUN-B:CHG-2026-02-POOL-A-2000"
    kpi = res["outputs"]["by_pool"]["POOL-A"]
    assert kpi["delta_gross"] == Decimal("42.00")
    assert kpi["actual_gross"] == Decimal("252.00")


def test_trueup_under_threshold_emits_row_without_v_x3():
    """A 5% divergence emits its delta row but no KPI warning."""
    budget = [mk_leg("POOL-A", "2000", "100.00", markup="5.00", period="2026-01")]
    actual = [mk_leg("POOL-A", "2000", "105.00", markup="5.25", period="2026-01")]
    booked = [mk_booked("POOL-A", "2000", "2026-01", "100.00", "5.00")]
    res = run_tu(actual, budget, booked)
    assert res["exceptions"] == []
    (row,) = res["outputs"]["true_up_rows"]
    assert row["gross_charge_amount"] == "5.25"


def test_trueup_negative_delta_is_a_reversing_correction_row():
    """Actual under budget → a NEGATIVE True-up row: the append-only
    ledger's sanctioned correction (reversing) row, linked to its parent
    (the V-R3 explicit-reversal reading — DECISIONS.md M6)."""
    budget = [mk_leg("POOL-A", "2000", "100.00", markup="5.00", period="2026-01")]
    actual = [mk_leg("POOL-A", "2000", "80.00", markup="4.00", period="2026-01")]
    booked = [mk_booked("POOL-A", "2000", "2026-01", "100.00", "5.00")]
    res = run_tu(actual, budget, booked)
    (row,) = res["outputs"]["true_up_rows"]
    assert row["cost_recovered_amount"] == "-20.00"
    assert row["gross_charge_amount"] == "-21.00"
    assert row["true_up_parent_charge_id"] == "RUN-B:CHG-2026-01-POOL-A-2000"
    assert rules.fired(res["exceptions"], "V-X3")  # 21/84 = 25% > 10%


def test_trueup_zero_delta_triple_emits_no_row():
    """Nothing to adjust — no row (DECISIONS.md M6)."""
    budget = [mk_leg("POOL-A", "2000", "100.00", markup="5.00", period="2026-01")]
    actual = [mk_leg("POOL-A", "2000", "100.00", markup="5.00", period="2026-01")]
    booked = [mk_booked("POOL-A", "2000", "2026-01", "100.00", "5.00")]
    res = run_tu(actual, budget, booked)
    assert res["outputs"]["true_up_rows"] == []
    assert res["exceptions"] == []


def test_trueup_v_x4_booked_amount_mismatch_blocks():
    """V-X4 BLOCK — a booked Budget charge the deterministic budget
    recompute cannot reproduce (amount drift) fails the pool."""
    budget = [mk_leg("POOL-A", "2000", "100.00", markup="5.00", period="2026-01")]
    actual = [mk_leg("POOL-A", "2000", "120.00", markup="6.00", period="2026-01")]
    booked = [mk_booked("POOL-A", "2000", "2026-01", "99.00", "5.00")]
    res = run_tu(actual, budget, booked)
    fired = rules.fired(res["exceptions"], "V-X4")
    assert len(fired) == 1 and fired[0]["severity"] == "BLOCK"
    assert "not reproduced" in fired[0]["message"] \
        or "differ from the deterministic" in fired[0]["message"]
    assert res["outputs"]["true_up_rows"] == []
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_trueup_v_x4_duplicate_booking_blocks():
    """V-X4 BLOCK — two booked rows for the same engine charge make the
    booked year ambiguous."""
    budget = [mk_leg("POOL-A", "2000", "100.00", markup="5.00", period="2026-01")]
    actual = [mk_leg("POOL-A", "2000", "100.00", markup="5.00", period="2026-01")]
    booked = [mk_booked("POOL-A", "2000", "2026-01", "100.00", "5.00"),
              mk_booked("POOL-A", "2000", "2026-01", "100.00", "5.00",
                        run="RUN-C")]
    res = run_tu(actual, budget, booked)
    fired = rules.fired(res["exceptions"], "V-X4")
    assert len(fired) == 1 and "duplicates" in fired[0]["message"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_trueup_v_x4_booked_row_with_no_recompute_leg_blocks():
    """V-X4 BLOCK — a booked charge with no matching recompute leg means the
    booked year is not reproducible from the current inputs."""
    budget: list[dict] = []
    actual = [mk_leg("POOL-A", "2000", "100.00", markup="5.00", period="2026-01")]
    booked = [mk_booked("POOL-A", "2000", "2026-01", "100.00", "5.00")]
    res = run_tu(actual, budget, booked)
    fired = rules.fired(res["exceptions"], "V-X4")
    assert len(fired) == 1 and "no matching leg" in fired[0]["message"]


def test_trueup_unbooked_recompute_leg_is_excluded_from_the_subtrahend():
    """Only BOOKED charges are subtracted (SPEC §5.4): a budget month that
    was never booked stays out of the booked sum — logged, no V-X4."""
    budget = [mk_leg("POOL-A", "2000", "100.00", markup="5.00", period="2026-01"),
              mk_leg("POOL-A", "2000", "100.00", markup="5.00", period="2026-02")]
    actual = [mk_leg("POOL-A", "2000", "100.00", markup="5.00", period="2026-01"),
              mk_leg("POOL-A", "2000", "100.00", markup="5.00", period="2026-02")]
    booked = [mk_booked("POOL-A", "2000", "2026-01", "100.00", "5.00")]
    res = run_tu(actual, budget, booked)
    assert rules.fired(res["exceptions"], "V-X4") == []
    (row,) = res["outputs"]["true_up_rows"]
    # actual year 210.00 − booked 105.00 (NOT 210.00)
    assert row["gross_charge_amount"] == "105.00"
    assert any("never booked" in line for line in res["log"])


def test_trueup_fx_converts_the_delta_at_the_year_end_closing_rate():
    """SPEC §5.4 — the provider-currency delta converts ONCE at the
    trueUpFxRateType snapshot (cost and markup separately, HALF_EVEN,
    boundary 3); the schema row maps year_end_closing → Spot."""
    budget = [mk_leg("POOL-A", "2000", "100.00", markup="5.00", period="2026-01")]
    actual = [mk_leg("POOL-A", "2000", "120.01", markup="6.00", period="2026-01")]
    booked = [mk_booked("POOL-A", "2000", "2026-01", "92.00", "4.60",
                        fx="0.92", currency="EUR")]
    ref = {"entities": ENTITIES_T,
           "trueup_fx_rates": [{"from_currency": "USD", "to_currency": "EUR",
                                "fx_rate_type": "year_end_closing",
                                "rate": "0.95", "rate_date": "2026-12-31"}]}
    res = run_tu(actual, budget, booked, ref=ref,
                 config={**TU_CFG, "chargeCurrency": "recipient"})
    assert rules.fired(res["exceptions"], "V-X4") == []  # booked verified @0.92
    (row,) = res["outputs"]["true_up_rows"]
    # delta cost 20.01 × 0.95 = 19.0095 → 19.01 ; markup 1.00 × 0.95 = 0.95
    assert row["cost_recovered_amount"] == "19.01"
    assert row["markup_amount"] == "0.95"
    assert row["gross_charge_amount"] == "19.96"
    assert row["charge_currency"] == "EUR"
    assert row["fx_rate"] == "0.95"
    assert row["fx_rate_type"] == "Spot"
    assert row["fx_rate_date"] == "2026-12-31"
    # a missing true-up snapshot row is V-R1 — never a defaulted rate
    res = run_tu(actual, budget, booked,
                 config={**TU_CFG, "chargeCurrency": "recipient"})
    fired = rules.fired(res["exceptions"], "V-R1")
    assert len(fired) == 1 and "true-up rate reference" in fired[0]["message"]
    assert res["outputs"]["true_up_rows"] == []


# --------------------------------- SPEC §5.2 "single" inside an SCC (M6 fix) --


def test_scc_member_does_not_remargin_an_upstream_received_component():
    """DECISIONS.md M6 — an upstream charge injected into a reciprocal-cycle
    member is markup-exempt under "single": the member's external markup is
    identical with and without the injection (only the cost grows)."""
    def mk_entity(eid):
        return {"entity_id": eid, "legal_entity_name": eid,
                "company_code": eid, "jurisdiction": "US",
                "functional_currency": "USD", "entity_role": "Both",
                "effective_from": "2026-01-01", "status": "Active"}

    def mk_kv(pool, key, recipient, factor, total):
        return {"key_value_id": f"KV-{pool}-{recipient}", "key_id": key,
                "pool_id": pool, "recipient_entity_id": recipient,
                "period": PERIOD, "factor_value": factor,
                "total_factor_value": total, "allocation_ratio": "0",
                "as_of_date": "2026-05-31"}

    def mk_pp(pool, entity):
        return {"participation_id": f"PP-{pool}-{entity}", "pool_id": pool,
                "entity_id": entity, "role": "Beneficiary",
                "effective_from": "2026-01-01"}

    def mk_policy(pool):
        return {"markup_policy_id": f"MP-{pool}-US", "pool_id": pool,
                "jurisdiction": "US", "regime": "LVAIGS (5%)",
                "markup_pct": "0.05", "effective_from": "2026-01-01"}

    def stage3_pool(pool, provider, key, base):
        return {"pool_id": pool, "provider_entity_id": provider,
                "period": PERIOD, "service_line": "IT",
                "characterization": "LVAIGS", "default_key_id": key,
                "direct_charge_flag": False, "documentation_ref": None,
                "total_pooled_cost": Decimal(base), "line_ids": [],
                "lines": [], "total_exclusions": ZERO,
                "chargeable_base": Decimal(base), "exclusions_applied": []}

    # U provides P-UP into A (the SCC entry); A ⇄ B reciprocal; X external.
    entities = [mk_entity(e) for e in ("A", "B", "U", "X")]
    ref = {
        "entities": entities,
        "participation": [mk_pp("P-UP", "A"),
                          mk_pp("P-A", "B"), mk_pp("P-A", "X"),
                          mk_pp("P-B", "A"), mk_pp("P-B", "X")],
        "key_defs": [{"key_id": k, "key_name": k, "key_factor": "Headcount",
                      "source_system": "HR", "static_or_dynamic": "Dynamic",
                      "owner": "o"} for k in ("K-UP", "K-A", "K-B")],
        "key_values": [mk_kv("P-UP", "K-UP", "A", "1", "1"),
                       mk_kv("P-A", "K-A", "B", "1", "4"),
                       mk_kv("P-A", "K-A", "X", "3", "4"),
                       mk_kv("P-B", "K-B", "A", "1", "4"),
                       mk_kv("P-B", "K-B", "X", "3", "4")],
        "markup_policies": [mk_policy("P-UP"), mk_policy("P-A"),
                            mk_policy("P-B")],
    }
    pool_up = stage3_pool("P-UP", "U", "K-UP", "100.00")
    pool_a = stage3_pool("P-A", "A", "K-A", "1000.00")
    pool_b = stage3_pool("P-B", "B", "K-B", "400.00")

    with_inj = cascade_allocate(
        {"pools": [pool_up, dict(pool_a), dict(pool_b)]}, ref, CFG)
    assert with_inj["exceptions"] == []
    without_inj = cascade_allocate(
        {"pools": [dict(pool_a), dict(pool_b)]}, ref, CFG)
    assert without_inj["exceptions"] == []

    def markup_x(res, pool):
        return next(c["markup_amount"] for c in res["outputs"]["charges"]
                    if c["pool_id"] == pool
                    and c["recipient_entity_id"] == "X")

    # P-UP's 105.00 gross joined P-A's base (received line, exempt) …
    assert len(with_inj["outputs"]["received_lines"]) == 1
    a_pool = next(p for p in with_inj["outputs"]["pools"]
                  if p["pool_id"] == "P-A")
    assert a_pool["chargeable_base"] == Decimal("1105.00")
    # … and A's external markup is UNCHANGED: the received component is
    # never re-margined; only A's own 1000.00 bears A's 5%.
    assert markup_x(with_inj, "P-A") == markup_x(without_inj, "P-A")
    # B's markup is unchanged too (the injection reaches B only internally)
    assert markup_x(with_inj, "P-B") == markup_x(without_inj, "P-B")


# ------------------------------------------------------------- doc pack ------


def _docpack_fixture():
    legs = [mk_leg("POOL-A", "2000", "70.00", markup="3.50"),
            mk_leg("POOL-A", "2100", "30.00", markup="1.50")]
    for leg, jur, policy in zip(legs, ("DE", "GB"), ("MP-A-DE", "MP-A-GB")):
        leg.update(recipient_jurisdiction=jur, markup_policy_id=policy,
                   regime="LVAIGS (5%)")
    pool = mk_pool5("POOL-A", pooled="125.00", exclusions="25.00", legs=legs)
    pool["lines"] = [
        {"cost_line_id": "CL-1", "cost_nature": "Payroll",
         "amount_local": "100.00"},
        {"cost_line_id": "CL-2", "cost_nature": "Software",
         "amount_local": "25.00"},
    ]
    pool["allocations"] = [
        {"recipient_entity_id": "2000", "factor_value": Decimal("7"),
         "allocation_ratio": Decimal("0.7"), "allocated_cost": Decimal("70.00")},
        {"recipient_entity_id": "2100", "factor_value": Decimal("3"),
         "allocation_ratio": Decimal("0.3"), "allocated_cost": Decimal("30.00")},
    ]
    recon = run_s7([pool])["outputs"]["recon"]
    return docpack.build_doc_pack(
        period=PERIOD, run_type="actual", pools=[pool],
        pool_catalog=[{"pool_id": "POOL-A", "pool_name": "Pool Alpha",
                       "service_description": "Alpha services.",
                       "cost_base_definition": "Total services cost"}],
        exclusion_ledger=[{"exclusion_id": "EX-1", "pool_id": "POOL-A",
                           "exclusion_type": "Stewardship",
                           "basis_rationale": "Shareholder oversight only.",
                           "pct": Decimal("0.20"),
                           "amount": Decimal("25.00"),
                           "line_allocations": []}],
        participation=[{"pool_id": "POOL-A", "entity_id": "2000",
                        "role": "Beneficiary",
                        "benefit_rationale": "Uses alpha daily."}],
        key_defs=[{"key_id": "KEY-X", "key_name": "Key X",
                   "key_factor": "Headcount", "source_system": "HR",
                   "static_or_dynamic": "Dynamic"}],
        entities=ENTITIES_T,
        recon_rows=recon,
        ledger_rows=[{"charge_id": "R1:CHG-1", "pool_id": "POOL-A",
                      "recipient_entity_id": "2000", "period": PERIOD,
                      "budget_or_actual": "Actual",
                      "cost_recovered_amount": "64.40",
                      "markup_amount": "3.22", "gross_charge_amount": "67.62",
                      "charge_currency": "EUR", "fx_rate": "0.92"}],
        run_id="RUN-T")


def test_docpack_renders_all_eight_spec_sections_with_run_figures():
    """SPEC §8.3 — the Markdown support document per pool per period carries
    all eight sections, populated from the run's own figures."""
    docs = _docpack_fixture()
    assert list(docs) == ["POOL-A.md"]
    md = docs["POOL-A.md"]
    for heading in (
        "## 1. Pool description & characterization",
        "## 2. Cost composition by nature",
        "## 3. Exclusions applied (benefit-test gate)",
        "## 4. Beneficiary population & benefit rationale",
        "## 5. Allocation key",
        "## 6. Cost base, regime & markup",
        "## 7. Resulting charges (ledger)",
        "## 8. Reconciliation tie-out",
    ):
        assert heading in md, heading
    assert "Pool Alpha" in md and "RUN-T" in md
    assert "| Payroll | 100.00 |" in md            # composition by nature
    assert "Shareholder oversight only." in md      # exclusion rationale
    assert "Uses alpha daily." in md                # benefit rationale
    assert "**Chargeable base:** 100.00" in md
    assert "MP-A-DE" in md and "LVAIGS (5%)" in md  # regime & policy basis
    assert "R1:CHG-1" in md and "67.62" in md       # resulting charge
    assert "Balanced" in md                         # recon tie-out
    assert "unallocated_residual" in md


def test_exception_report_carries_severity_objects_and_remediation():
    """SPEC §8.4 — every fired rule with severity, affected objects and a
    suggested remediation; BLOCK/WARN counts for the console."""
    exceptions = [
        rules.exception("V-M1", "no policy", objects=["POOL-A", "DE"],
                        pool_id="POOL-A"),
        rules.exception("V-X3", "true-up KPI", objects=["42"],
                        pool_id="POOL-B"),
    ]
    report = docpack.build_exception_report(exceptions, run_id="RUN-T",
                                            period=PERIOD)
    assert report["counts"] == {"BLOCK": 1, "WARN": 1}
    by_rule = {e["rule_id"]: e for e in report["exceptions"]}
    assert by_rule["V-M1"]["severity"] == "BLOCK"
    assert by_rule["V-M1"]["objects"] == ["POOL-A", "DE"]
    assert "never default a markup" in by_rule["V-M1"]["remediation"]
    assert "divergence" in by_rule["V-X3"]["remediation"]
    # every catalogued rule has a remediation (SPEC §7 ↔ §8.4 1:1)
    assert set(docpack.REMEDIATION) == set(rules.SEVERITY)


# ----------------------------------------------- orchestrator (adapter) ------


def test_runner_block_fails_the_whole_run_and_persists_no_ledger_rows(state_db):
    """SPEC §4 — atomic, all-or-nothing per run: a V-M1 BLOCK (markup policy
    removed) fails the run; NO charge/recon rows reach the ledgers; the
    exception report is persisted on the failed run."""
    dataset = runner.load_demo_dataset()
    dataset = {**dataset, "markup_policies": [
        p for p in dataset["markup_policies"]
        if p["pool_id"] != "POOL-IT-US"]}
    res = runner.run_allocation(period="2026-05", run_type="actual",
                                actor="t", dataset=dataset)
    assert res["status"] == "failed"
    run_id = res["run_id"]
    assert store.list_charges(run_id=run_id) == []
    assert store.list_recon(run_id=run_id) == []
    report = json.loads(store.get_artifact(run_id,
                                           "exceptions.json")["content"])
    assert any(e["rule_id"] == "V-M1" for e in report["exceptions"])
    assert store.get_run(run_id)["status"] == "failed"


def test_runner_v_x4_output_hash_mismatch_fails_the_run(state_db):
    """V-X4 BLOCK — a prior succeeded run with the SAME input snapshot hash
    but a DIFFERENT output hash makes the new run fail (historic re-run
    hash mismatch)."""
    first = runner.run_allocation(period="2026-05", run_type="actual",
                                  actor="t")
    assert first["status"] == "succeeded"
    # forge a prior run claiming the same inputs produced different outputs
    store.insert_run(run_id="RUN-9999-actual-2026-05", period="2026-05",
                     run_type="actual",
                     input_snapshot_hash=first["input_snapshot_hash"])
    store.persist_run_success(
        "RUN-9999-actual-2026-05", charges=[], recon_rows=[],
        artifacts=[{"name": "output.sha256", "content_type": "text/plain",
                    "content": "deadbeef"}])
    res = runner.run_allocation(period="2026-05", run_type="actual",
                                actor="t")
    assert res["status"] == "failed"
    fired = [e for e in res["exception_report"]["exceptions"]
             if e["rule_id"] == "V-X4"]
    assert len(fired) == 1 and fired[0]["severity"] == "BLOCK"
    assert store.list_charges(run_id=res["run_id"]) == []


def test_runner_identical_rerun_is_v_x4_green_and_appends(state_db):
    """A genuine re-run of identical inputs reproduces the identical output
    hash, succeeds, and APPENDS its own rows under the new run_id (the
    ledger is never updated in place)."""
    first = runner.run_allocation(period="2026-05", run_type="actual",
                                  actor="t")
    second = runner.run_allocation(period="2026-05", run_type="actual",
                                   actor="t")
    assert second["status"] == "succeeded"
    h1 = store.get_artifact(first["run_id"], "output.sha256")["content"]
    h2 = store.get_artifact(second["run_id"], "output.sha256")["content"]
    assert h1 == h2
    assert len(store.list_charges(run_id=second["run_id"])) \
        == len(store.list_charges(run_id=first["run_id"]))


def test_store_ledgers_remain_append_only_no_update_api():
    """ENGINE-CLAUDE.md — the persistence module exposes NO update/delete
    for the four ledgers; corrections are reversing rows (True-up)."""
    for name in dir(store):
        assert not name.startswith(("update_", "delete_")), name
