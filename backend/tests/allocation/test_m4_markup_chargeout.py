"""M4 gate — Stages 5-6: markup, FX/charge-out, charge ledger + the DEMO
RECONCILIATION GATE (SPEC §10 M4 + §4 Stage-5/6 contracts + §5.6 rounding
boundaries 2-3 + §7 V-M rules; ADAPTATION D5).

Covers, in order:
- the V-M rule family on crafted fixtures (rule IDs in test names —
  ENGINE-CLAUDE.md): V-M1 missing/duplicate policy BLOCK (never default a
  markup), V-M2 regime/markup coherence (SCM & Pass-through must be 0%
  BLOCK; LVAIGS regime-fixed 5% with a WARN on a deviating policy rate;
  Benchmarked requires benchmark_study_ref), V-M3 SCM support fields,
  V-M4 undocumented LVAIGS/Benchmarked-divergence WARN;
- SPEC §5.6 boundary 2 (markup per charge HALF_EVEN to the minor unit) and
  the §9.1 edge cases owned by these stages: pass-through inside a marked-up
  pool (at cost, V-P4), direct charges marked up per policy, zero-base pool;
- Stage 6: schema-shaped 10_ChargeLedger rows, identity FX legs logged at
  1.0 with the configured fx_rate_type, conversion HALF_EVEN to the TARGET
  minor unit (boundary 3), FX to a zero-decimal currency (JPY, §9.1),
  missing FX snapshot row BLOCK, VAT/WHT jurisdiction-pair attributes,
  Budget/Actual tagging, posting file per provider, determinism under input
  reordering;
- the DEMO RECONCILIATION GATE (ADAPTATION D5 M4, the keystone): stages 1-6
  over the actual seeds for all 4 periods with ZERO exceptions; per
  (provider, recipient) FY: Σ cost_recovered_amount == warehouse SERVICE
  pair cost base AND Σ gross_charge_amount == warehouse pair gross, both TO
  THE CENT; blended markup == the 5.58% story; OTP-15 tie: total exclusions
  == 6,950,000.00 split 4,250,000.00 (1000) / 2,700,000.00 (3100).

NO float arithmetic on amounts anywhere in this file (ENGINE-CLAUDE.md).

Run from backend/:
    ../.venv/bin/python -m pytest tests/allocation/test_m4_markup_chargeout.py
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import duckdb
import pytest

from allocation.stages import (
    stage1_capture_and_classify,
    stage2_pool,
    stage3_benefit_gate,
    stage4_allocate,
    stage5_markup,
    stage6_chargeout,
)
from allocation.validation import rules
from config import SUPPLY_CHAIN

BACKEND = Path(__file__).resolve().parents[2]
SEED_DIR = BACKEND / "seeds" / "allocation"
PERIOD = "2026-05"
CFG5 = {"period": PERIOD}
CFG6 = {"period": PERIOD, "fxRateType": "monthly_average"}
ZERO = Decimal("0")
ONE = Decimal("1")


# ------------------------------------------------- crafted-fixture builders --


def mk_entity(entity_id: str, *, jurisdiction: str = "US",
              currency: str = "USD", **over) -> dict:
    row = {
        "entity_id": entity_id,
        "legal_entity_name": f"Entity {entity_id}",
        "company_code": entity_id,
        "jurisdiction": jurisdiction,
        "functional_currency": currency,
        "entity_role": "Both",
        "effective_from": "2026-01-01",
        "status": "Active",
    }
    row.update(over)
    return row


ENTITIES_T = [
    mk_entity("1000"),                                     # US provider, USD
    mk_entity("2000", jurisdiction="DE", currency="EUR"),
    mk_entity("2100", jurisdiction="GB", currency="GBP"),
    mk_entity("2200", jurisdiction="US", currency="USD"),  # SCM US leg
    mk_entity("2300", jurisdiction="JP", currency="JPY"),
]


def mk_policy(pool_id: str, jurisdiction: str, *, regime: str = "Benchmarked",
              pct: str = "0.06", **over) -> dict:
    row = {
        "markup_policy_id": f"MP-{pool_id}-{jurisdiction}",
        "pool_id": pool_id,
        "jurisdiction": jurisdiction,
        "regime": regime,
        "markup_pct": pct,
        "effective_from": "2026-01-01",
        "effective_to": "2026-12-31",
    }
    if regime == "Benchmarked":
        row["benchmark_study_ref"] = f"BM-{pool_id}-2026-{jurisdiction}"
    row.update(over)
    return row


def mk_alloc(pool_id: str, recipient: str, cost: str, *,
             ratio: str = "1", provider: str = "1000") -> dict:
    return {
        "pool_id": pool_id,
        "provider_entity_id": provider,
        "recipient_entity_id": recipient,
        "period": PERIOD,
        "key_id": "KEY-X",
        "key_value_id": f"KV-{pool_id}-{recipient}-{PERIOD}",
        "factor_value": Decimal(ratio),
        "allocation_ratio": Decimal(ratio),
        "allocated_cost": Decimal(cost),
    }


def mk_s4_pool(pool_id: str, allocations: list[dict], *,
               provider: str = "1000", **over) -> dict:
    """A Stage-4-shaped pool dict (the Stage-5 input contract)."""
    total = sum((a["allocated_cost"] for a in allocations), ZERO)
    row = {
        "pool_id": pool_id,
        "provider_entity_id": provider,
        "period": PERIOD,
        "service_line": "IT",
        "characterization": "Routine-benchmarked",
        "default_key_id": "KEY-X",
        "direct_charge_flag": False,
        "documentation_ref": None,
        "total_pooled_cost": total,
        "line_ids": [f"CL-{pool_id}-1"],
        "lines": [],
        "total_exclusions": ZERO,
        "chargeable_base": total,
        "exclusions_applied": [],
        "key_id": "KEY-X" if allocations else None,
        "total_factor_value": ONE if allocations else None,
        "allocations": allocations,
        "total_allocated": total,
    }
    row.update(over)
    return row


def mk_traceable_line(line_id: str, pool_id: str, recipient: str, amount: str,
                      *, provider: str = "1000", pass_through: bool = False,
                      **over) -> dict:
    row = {
        "cost_line_id": line_id,
        "provider_entity_id": provider,
        "company_code": provider,
        "cost_center": "CC-A",
        "cost_element": "6500-Salaries",
        "cost_nature": "Third-party fee" if pass_through else "Payroll",
        "function": "IT",
        "amount_local": amount,
        "currency_local": "USD",
        "posting_date": "2026-05-31",
        "fiscal_period": PERIOD,
        "fiscal_year": "2026",
        "flow_type": "Service",
        "charge_method": "Direct",
        "traceable_recipient_id": recipient,
        "pass_through_flag": pass_through,
        "pool_id": pool_id,
        "source_document_ref": f"DOC-{line_id}",
    }
    row.update(over)
    return row


def ref5(*, policies=None, entities=None) -> dict:
    return {"markup_policies": [] if policies is None else policies,
            "entities": ENTITIES_T if entities is None else entities}


def run_s5(pools, ref, *, direct=None, pass_through=None, config=CFG5) -> dict:
    return stage5_markup(
        {"pools": pools, "direct_charges": direct or [],
         "pass_through": pass_through or []},
        ref, config)


def run_s6(charges, *, entities=None, fx_rates=None, tax_rules=None,
           config=CFG6) -> dict:
    ref = {"entities": ENTITIES_T if entities is None else entities,
           "fx_rates": fx_rates or [], "tax_rules": tax_rules or []}
    return stage6_chargeout({"charges": charges}, ref, config)


def one_pool(*, pct="0.06", regime="Benchmarked", cost="100.00",
             jurisdiction="DE", recipient="2000", **policy_over):
    """One single-recipient pool + its policy (the common fixture)."""
    pools = [mk_s4_pool("POOL-A", [mk_alloc("POOL-A", recipient, cost)])]
    policy = mk_policy("POOL-A", jurisdiction, regime=regime, pct=pct,
                       **policy_over)
    return pools, [policy]


# ---------------------------------------------------- stage 5 — V-M rules --


def test_v_m1_missing_markup_policy_blocks_pool_never_default():
    """V-M1 BLOCK — no 4_MarkupPolicy for a charged (pool, recipient
    jurisdiction): the pool halts; the engine NEVER defaults a markup
    (SPEC §4 Stage 5, ENGINE-CLAUDE.md)."""
    pools, _ = one_pool()
    res = run_s5(pools, ref5(policies=[]))
    fired = rules.fired(res["exceptions"], "V-M1")
    assert len(fired) == 1 and fired[0]["severity"] == "BLOCK"
    assert "never a default" in fired[0]["message"]
    assert res["outputs"]["charges"] == []
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_v_m1_duplicate_markup_policies_block_pool():
    """V-M1 BLOCK — more than one policy in scope for (pool, jurisdiction,
    period) is not exactly one determinate policy (DECISIONS.md M4)."""
    pools, policies = one_pool()
    dup = dict(policies[0], markup_policy_id="MP-POOL-A-DE-2")
    res = run_s5(pools, ref5(policies=policies + [dup]))
    fired = rules.fired(res["exceptions"], "V-M1")
    assert len(fired) == 1 and "not exactly one determinate" in fired[0]["message"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_v_m2_scm_policy_with_nonzero_markup_blocks():
    """V-M2 BLOCK — SCM (0%) must carry exactly 0%."""
    pools, policies = one_pool(regime="SCM (0%)", pct="0.01",
                               scm_eligibility_basis="Low-margin <=7%",
                               business_judgment_conclusion="Support only.")
    res = run_s5(pools, ref5(policies=policies))
    fired = rules.fired(res["exceptions"], "V-M2")
    assert len(fired) == 1 and fired[0]["severity"] == "BLOCK"
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_v_m2_pass_through_policy_with_nonzero_markup_blocks():
    """V-M2 BLOCK — Pass-through (0%) must carry exactly 0%."""
    pools, policies = one_pool(regime="Pass-through (0%)", pct="0.05")
    res = run_s5(pools, ref5(policies=policies))
    fired = rules.fired(res["exceptions"], "V-M2")
    assert len(fired) == 1 and fired[0]["severity"] == "BLOCK"
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_v_m2_benchmarked_policy_without_study_ref_blocks():
    """V-M2 BLOCK — Benchmarked requires a benchmark_study_ref."""
    pools, policies = one_pool()
    del policies[0]["benchmark_study_ref"]
    res = run_s5(pools, ref5(policies=policies))
    fired = rules.fired(res["exceptions"], "V-M2")
    assert len(fired) == 1 and "benchmark_study_ref" in fired[0]["message"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_v_m2_lvaigs_deviation_warns_and_engine_applies_fixed_5pct():
    """V-M2 (LVAIGS facet) — LVAIGS is regime-FIXED at 5%: a deviating policy
    rate fires a WARN and the engine applies the fixed 5% (SPEC §4 Stage 5
    "warn if policy says otherwise"; DECISIONS.md M4)."""
    pools, policies = one_pool(regime="LVAIGS (5%)", pct="0.07")
    res = run_s5(pools, ref5(policies=policies))
    fired = rules.fired(res["exceptions"], "V-M2")
    assert len(fired) == 1 and fired[0]["severity"] == "WARN"
    assert res["outputs"]["blocked_pool_ids"] == []
    (charge,) = res["outputs"]["charges"]
    assert charge["markup_pct"] == Decimal("0.05")          # NOT the policy 7%
    assert charge["markup_amount"] == Decimal("5.00")
    assert charge["gross_charge"] == Decimal("105.00")
    # a compliant 5% LVAIGS policy is silent
    pools, policies = one_pool(regime="LVAIGS (5%)", pct="0.05")
    res = run_s5(pools, ref5(policies=policies))
    assert res["exceptions"] == []


def test_v_m3_scm_requires_eligibility_basis_and_conclusion():
    """V-M3 BLOCK — SCM needs scm_eligibility_basis != n/a AND a non-empty
    business_judgment_conclusion; a fully supported SCM leg prices at 0%
    (the golden run's US-leg preview, SPEC §9.2)."""
    pools, policies = one_pool(regime="SCM (0%)", pct="0",
                               jurisdiction="US", recipient="2200",
                               scm_eligibility_basis="n/a")
    res = run_s5(pools, ref5(policies=policies))
    fired = rules.fired(res["exceptions"], "V-M3")
    assert len(fired) == 2  # n/a basis AND missing conclusion
    assert all(e["severity"] == "BLOCK" for e in fired)
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]

    pools, policies = one_pool(
        regime="SCM (0%)", pct="0", jurisdiction="US", recipient="2200",
        scm_eligibility_basis="Specified covered service (IRS list)",
        business_judgment_conclusion="Support only; no key advantage.")
    res = run_s5(pools, ref5(policies=policies))
    assert res["exceptions"] == []
    (charge,) = res["outputs"]["charges"]
    assert charge["markup_pct"] == ZERO
    assert charge["markup_amount"] == Decimal("0.00")
    assert charge["gross_charge"] == charge["cost_recovered"] == Decimal("100.00")


def test_v_m4_undocumented_lvaigs_benchmarked_divergence_warns():
    """V-M4 WARN — same pool charged under LVAIGS in one jurisdiction and
    Benchmarked > 5% elsewhere without a pool documentation_ref; the
    documented pool is silent (divergence is fine, undocumented divergence
    is not — SPEC §7)."""
    allocations = [mk_alloc("POOL-A", "2000", "60.00", ratio="0.6"),
                   mk_alloc("POOL-A", "2100", "40.00", ratio="0.4")]
    policies = [mk_policy("POOL-A", "DE", regime="LVAIGS (5%)", pct="0.05"),
                mk_policy("POOL-A", "GB", regime="Benchmarked", pct="0.08")]
    pools = [mk_s4_pool("POOL-A", allocations)]
    res = run_s5(pools, ref5(policies=policies))
    fired = rules.fired(res["exceptions"], "V-M4")
    assert len(fired) == 1 and fired[0]["severity"] == "WARN"
    assert res["outputs"]["blocked_pool_ids"] == []          # WARN continues
    assert len(res["outputs"]["charges"]) == 2

    pools = [mk_s4_pool("POOL-A", allocations,
                        documentation_ref="DOC/TP/POOL-A-2026")]
    res = run_s5(pools, ref5(policies=policies))
    assert rules.fired(res["exceptions"], "V-M4") == []


# --------------------------------------- stage 5 — pricing & §9.1 edges ----


def test_stage5_markup_rounds_half_even_to_the_cent_boundary_2():
    """SPEC §5.6 boundary 2 — markup per charge quantizes HALF_EVEN to the
    minor unit: 2.50 x 5% = 0.125 -> 0.12 (down to even), 3.50 x 5% = 0.175
    -> 0.18 (up to even); gross = cost + markup exactly."""
    allocations = [mk_alloc("POOL-A", "2000", "2.50", ratio="0.5"),
                   mk_alloc("POOL-A", "2100", "3.50", ratio="0.5")]
    policies = [mk_policy("POOL-A", "DE", regime="LVAIGS (5%)", pct="0.05"),
                mk_policy("POOL-A", "GB", regime="LVAIGS (5%)", pct="0.05")]
    res = run_s5([mk_s4_pool("POOL-A", allocations)], ref5(policies=policies))
    assert res["exceptions"] == []
    by_rec = {c["recipient_entity_id"]: c for c in res["outputs"]["charges"]}
    assert by_rec["2000"]["markup_amount"] == Decimal("0.12")  # HALF_EVEN
    assert by_rec["2100"]["markup_amount"] == Decimal("0.18")  # HALF_EVEN
    assert by_rec["2000"]["gross_charge"] == Decimal("2.62")
    assert by_rec["2100"]["gross_charge"] == Decimal("3.68")


def test_stage5_pass_through_inside_marked_up_pool_at_cost_v_p4():
    """SPEC §9.1 edge case — a pass-through disbursement inside a marked-up
    pool recharges AT COST to its traceable recipient: 0% markup, no policy
    lookup (V-P4), while the pool's allocated legs still bear the markup."""
    pools, policies = one_pool(pct="0.06")
    pt = [mk_traceable_line("CL-PT-1", "POOL-A", "2100", "70.00",
                            pass_through=True),
          mk_traceable_line("CL-PT-2", "POOL-A", "2100", "30.00",
                            pass_through=True)]
    res = run_s5(pools, ref5(policies=policies), pass_through=pt)
    assert res["exceptions"] == []  # no GB policy exists — and none is needed
    by_kind = {c["charge_kind"]: c for c in res["outputs"]["charges"]}
    assert by_kind["allocated"]["markup_amount"] == Decimal("6.00")
    passthru = by_kind["pass_through"]
    assert passthru["recipient_entity_id"] == "2100"
    assert passthru["cost_recovered"] == Decimal("100.00")   # aggregated
    assert passthru["markup_pct"] == ZERO                    # V-P4: never
    assert passthru["markup_amount"] == Decimal("0.00")      # marked up
    assert passthru["gross_charge"] == Decimal("100.00")     # at cost
    assert passthru["markup_policy_id"] is None
    assert passthru["line_ids"] == ["CL-PT-1", "CL-PT-2"]    # lineage


def test_stage5_direct_charges_marked_up_per_policy():
    """Direct-charge legs (Stage-2 stream a) bypass the key but DO bear the
    (pool, recipient jurisdiction) markup; aggregated per recipient with
    line lineage."""
    pools, policies = one_pool(pct="0.06")
    policies.append(mk_policy("POOL-A", "GB", pct="0.10"))
    direct = [mk_traceable_line("CL-D-1", "POOL-A", "2100", "200.00"),
              mk_traceable_line("CL-D-2", "POOL-A", "2100", "50.00")]
    res = run_s5(pools, ref5(policies=policies), direct=direct)
    assert res["exceptions"] == []
    by_kind = {c["charge_kind"]: c for c in res["outputs"]["charges"]}
    d = by_kind["direct"]
    assert d["cost_recovered"] == Decimal("250.00")
    assert d["markup_pct"] == Decimal("0.10")
    assert d["markup_amount"] == Decimal("25.00")
    assert d["gross_charge"] == Decimal("275.00")
    assert d["markup_policy_id"] == "MP-POOL-A-GB"
    assert d["allocation_key_id"] is None and d["allocation_ratio"] is None
    assert d["line_ids"] == ["CL-D-1", "CL-D-2"]
    # a direct leg with no policy for its jurisdiction is V-M1 (never default)
    res = run_s5(pools, ref5(policies=policies[:1]), direct=direct)
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-M1"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]


def test_stage5_zero_base_pool_emits_no_charges():
    """SPEC §9.1 edge case — a zero-chargeable-base pool (the demo's 100%-
    excluded management pools) flows through unpriced; no policy support is
    required where nothing is charged."""
    pools = [mk_s4_pool("POOL-Z", [])]
    res = run_s5(pools, ref5(policies=[]))
    assert res["exceptions"] == []
    (pool,) = res["outputs"]["pools"]
    assert pool["charges"] == []
    assert pool["total_markup"] == ZERO and pool["total_gross"] == ZERO
    assert res["outputs"]["charges"] == []


def test_stage5_deterministic_under_input_reordering():
    """Determinism (SPEC §5.1 convention): identical outputs regardless of
    the ordering of pools, policies and traceable lines."""
    allocations = [mk_alloc("POOL-A", "2000", "60.00", ratio="0.6"),
                   mk_alloc("POOL-A", "2100", "40.00", ratio="0.4")]
    pools = [mk_s4_pool("POOL-A", allocations),
             mk_s4_pool("POOL-B", [mk_alloc("POOL-B", "2000", "10.01")])]
    policies = [mk_policy("POOL-A", "DE"), mk_policy("POOL-A", "GB"),
                mk_policy("POOL-B", "DE", pct="0.04")]
    direct = [mk_traceable_line("CL-D-1", "POOL-A", "2000", "5.00"),
              mk_traceable_line("CL-D-2", "POOL-A", "2000", "7.00")]
    a = run_s5(pools, ref5(policies=policies), direct=direct)
    b = run_s5(list(reversed(pools)),
               ref5(policies=list(reversed(policies))),
               direct=list(reversed(direct)))
    assert a == b


# ------------------------------------------------- stage 6 — charge-out ----


def s5_charges(*, pct="0.06", cost="100.00", recipient="2000",
               jurisdiction="DE") -> list[dict]:
    pools, policies = one_pool(pct=pct, cost=cost, recipient=recipient,
                               jurisdiction=jurisdiction)
    res = run_s5(pools, ref5(policies=policies))
    assert res["exceptions"] == []
    return res["outputs"]["charges"]


def test_stage6_identity_leg_logs_fx_rate_1_0_and_configured_type():
    """An identity leg (charge currency == cost currency) logs fx_rate 1.0
    with the configured fx_rate_type and the period-end rate date — logged,
    not defaulted (DECISIONS.md M4)."""
    res = run_s6(s5_charges(), config=dict(CFG6, chargeCurrency="provider"))
    assert res["exceptions"] == []
    (row,) = res["outputs"]["charges"]
    assert row["charge_id"] == "CHG-2026-05-POOL-A-2000"
    assert row["charge_currency"] == "USD"                  # provider booking
    assert row["fx_rate"] == "1.0"
    assert row["fx_rate_type"] == "Monthly average"
    assert row["fx_rate_date"] == "2026-05-31"
    assert row["cost_recovered_amount"] == "100.00"
    assert row["markup_amount"] == "6.00"
    assert row["gross_charge_amount"] == "106.00"
    assert row["budget_or_actual"] == "Actual"              # default runType
    assert row["allocation_key_id"] == "KEY-X"
    assert row["allocation_ratio_applied"] == "1"
    assert row["posting_date"] == "2026-05-31"


def test_stage6_converts_at_boundary_3_half_even_to_recipient_currency():
    """SPEC §5.6 boundary 3 — cost and markup each convert HALF_EVEN to the
    TARGET minor unit; gross is their exact sum (cost + markup == gross holds
    in the charge currency)."""
    fx = [{"from_currency": "USD", "to_currency": "EUR",
           "fx_rate_type": "Monthly average", "rate": "0.9237",
           "rate_date": "2026-05-31"}]
    res = run_s6(s5_charges(pct="0.05", cost="100.01"), fx_rates=fx)
    assert res["exceptions"] == []
    (row,) = res["outputs"]["charges"]
    assert row["charge_currency"] == "EUR"                  # recipient default
    assert row["fx_rate"] == "0.9237"
    assert row["fx_rate_date"] == "2026-05-31"
    # 100.01 x 0.9237 = 92.3792337 -> 92.38 ; 5.00 x 0.9237 = 4.6185 -> 4.62
    assert row["cost_recovered_amount"] == "92.38"
    assert row["markup_amount"] == "4.62"
    assert row["gross_charge_amount"] == "97.00"            # exact sum


def test_stage6_fx_to_jpy_quantizes_to_zero_decimal_minor_unit():
    """SPEC §9.1 edge case — FX to a zero-decimal currency (JPY): amounts
    quantize to whole yen (minor unit 1), HALF_EVEN."""
    fx = [{"from_currency": "USD", "to_currency": "JPY",
           "fx_rate_type": "Monthly average", "rate": "150.25",
           "rate_date": "2026-05-31"}]
    res = run_s6(s5_charges(pct="0.05", cost="100.00", recipient="2300",
                            jurisdiction="JP"), fx_rates=fx)
    assert res["exceptions"] == []
    (row,) = res["outputs"]["charges"]
    assert row["charge_currency"] == "JPY"
    # 100.00 x 150.25 = 15025 ; 5.00 x 150.25 = 751.25 -> 751 (HALF_EVEN)
    assert row["cost_recovered_amount"] == "15025"
    assert row["markup_amount"] == "751"
    assert row["gross_charge_amount"] == "15776"


def test_stage6_missing_fx_snapshot_row_blocks_v_r1():
    """V-R1 BLOCK — a cross-currency leg without exactly one snapshot row for
    (from, to, configured type) withholds the pool's charges: the rate
    reference must resolve (never a defaulted rate)."""
    res = run_s6(s5_charges())  # USD -> EUR with an empty snapshot
    fired = rules.fired(res["exceptions"], "V-R1")
    assert len(fired) == 1 and fired[0]["severity"] == "BLOCK"
    assert "USD->EUR" in str(fired[0]["objects"])
    assert res["outputs"]["charges"] == []
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-A"]
    # and a rate of the WRONG type does not satisfy the configured one
    fx = [{"from_currency": "USD", "to_currency": "EUR",
           "fx_rate_type": "Spot", "rate": "0.92", "rate_date": "2026-05-31"}]
    res = run_s6(s5_charges(), fx_rates=fx)
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-R1"]


def test_stage6_vat_wht_attributes_from_jurisdiction_pair_rules():
    """VAT/WHT v1 — treatment + simple rate-based amounts from the
    jurisdiction-pair lookup; reverse-charge legs carry zero VAT; a pair with
    no rule omits the attributes."""
    tax = [{"provider_jurisdiction": "US", "recipient_jurisdiction": "DE",
            "vat_gst_treatment": "Reverse charge", "wht_rate": "0.05"}]
    res = run_s6(s5_charges(pct="0.06", cost="100.00"),
                 config=dict(CFG6, chargeCurrency="provider"), tax_rules=tax)
    assert res["exceptions"] == []
    (row,) = res["outputs"]["charges"]
    assert row["vat_gst_treatment"] == "Reverse charge"
    assert row["vat_amount"] == "0.00"
    assert row["wht_rate"] == "0.05"
    assert row["wht_amount"] == "5.30"                      # 106.00 x 5%
    # standard-rated computes VAT on gross; no pair rule -> attrs omitted
    tax = [{"provider_jurisdiction": "US", "recipient_jurisdiction": "DE",
            "vat_gst_treatment": "Standard-rated", "vat_rate": "0.19"}]
    res = run_s6(s5_charges(pct="0.06", cost="100.00"),
                 config=dict(CFG6, chargeCurrency="provider"), tax_rules=tax)
    (row,) = res["outputs"]["charges"]
    assert row["vat_amount"] == "20.14"                     # 106.00 x 19%
    res = run_s6(s5_charges(pct="0.06", cost="100.00"),
                 config=dict(CFG6, chargeCurrency="provider"))
    (row,) = res["outputs"]["charges"]
    assert "vat_gst_treatment" not in row and "wht_rate" not in row


def test_stage6_budget_run_tags_rows_budget():
    """SPEC §6 runType maps onto the schema budget_or_actual enumeration
    (Budget in-year; Actual recompute; True-up deltas are Stage 7's)."""
    res = run_s6(s5_charges(), config=dict(CFG6, chargeCurrency="provider",
                                           runType="budget"))
    (row,) = res["outputs"]["charges"]
    assert row["budget_or_actual"] == "Budget"
    (pf,) = res["outputs"]["posting_files"]
    assert pf["budget_or_actual"] == "Budget"


def test_stage6_posting_file_per_provider_and_schema_shaped_rows():
    """SPEC §8.2 — one posting file per provider entity (provider, recipient,
    period, gross amount, currency, account hints, invoice-required); emitted
    ledger rows validate against the generated 10_ChargeLedger schema."""
    from allocation import validation
    charges = s5_charges(pct="0.06", cost="100.00")          # 1000 -> 2000 (DE)
    # a domestic leg (1000 US -> 2200 US) and a second provider (2100 GB)
    pools = [mk_s4_pool("POOL-B", [mk_alloc("POOL-B", "2200", "50.00")]),
             mk_s4_pool("POOL-C", [mk_alloc("POOL-C", "2000", "80.00",
                                            provider="2100")],
                        provider="2100")]
    res5 = run_s5(pools, ref5(policies=[
        mk_policy("POOL-B", "US", pct="0.04"),
        mk_policy("POOL-C", "DE", pct="0.07")]))
    assert res5["exceptions"] == []
    fx = [{"from_currency": "GBP", "to_currency": "USD",
           "fx_rate_type": "Monthly average", "rate": "1.27",
           "rate_date": "2026-05-31"}]
    res = run_s6(charges + res5["outputs"]["charges"], fx_rates=fx,
                 config=dict(CFG6, chargeCurrency="provider"))
    assert res["exceptions"] == []
    rows = res["outputs"]["charges"]
    assert validation.validate_rows("10_ChargeLedger", rows) == []
    files = res["outputs"]["posting_files"]
    assert [f["provider_entity_id"] for f in files] == ["1000", "2100"]
    by_pool = {c["charge_id"]: c for f in files for c in f["charges"]}
    cross_border = by_pool["CHG-2026-05-POOL-A-2000"]
    assert cross_border["gross_amount"] == "106.00"
    assert cross_border["currency"] == "USD"
    assert cross_border["invoice_required"] is True          # US -> DE
    assert cross_border["account_hints"]["provider_revenue"]
    domestic = by_pool["CHG-2026-05-POOL-B-2200"]
    assert domestic["invoice_required"] is False             # US -> US
    second = by_pool["CHG-2026-05-POOL-C-2000"]
    assert second["invoice_required"] is True                # GB -> DE
    assert second["currency"] == "GBP"                       # provider booking
    # lineage drill: every charge carries its key/lines lineage
    assert {l["charge_id"] for l in res["outputs"]["lineage"]} \
        == {r["charge_id"] for r in rows}


def test_stage6_deterministic_under_input_reordering():
    """Determinism: identical outputs regardless of charge input ordering."""
    charges = s5_charges() + s5_charges(cost="50.00", recipient="2100",
                                        jurisdiction="GB")
    fx = [{"from_currency": "USD", "to_currency": "EUR",
           "fx_rate_type": "Monthly average", "rate": "0.92",
           "rate_date": "2026-05-31"},
          {"from_currency": "USD", "to_currency": "GBP",
           "fx_rate_type": "Monthly average", "rate": "0.79",
           "rate_date": "2026-05-31"}]
    a = run_s6(charges, fx_rates=fx)
    b = run_s6(list(reversed(charges)), fx_rates=list(reversed(fx)))
    assert a == b


# --------------------------------------- DEMO RECONCILIATION GATE (keystone) --


PROVIDER_PERIODS = {"1000": ("2026-05", "2026-11"), "3100": ("2026-04", "2026-10")}
MGMT_POOLS = {"1000": "POOL-MGMT-US", "3100": "POOL-MGMT-CH"}
SERVICE_POOLS = {"1000": "POOL-IT-US", "3100": "POOL-RSS-CH"}
STEWARDSHIP = {"1000": Decimal("4250000.00"), "3100": Decimal("2700000.00")}


def _seed_doc(fname: str) -> dict:
    return json.loads((SEED_DIR / fname).read_text(encoding="utf-8"))


def _warehouse_pairs() -> tuple[dict, dict, dict]:
    """SERVICE pair cost base + gross per (provider, recipient, period) and
    FY — Decimal end to end (DuckDB DECIMAL; no floats off the warehouse)."""
    con = duckdb.connect()
    rows = con.execute(
        f"""
        SELECT SELLING_COMPANY, BUYING_COMPANY, GJAHR, POPER,
               SUM(STANDARD_COST * TOTAL_VOLUME), SUM(TOTAL_LEGAL_PRICE)
        FROM read_parquet('{SUPPLY_CHAIN}')
        WHERE MATERIAL_TYPE = 'SERVICE'
        GROUP BY 1, 2, 3, 4
        """
    ).fetchall()
    con.close()
    cb_period: dict[tuple[str, str, str], Decimal] = {}
    cb_fy: dict[tuple[str, str], Decimal] = {}
    gross_fy: dict[tuple[str, str], Decimal] = {}
    for provider, recipient, gjahr, poper, cb, gross in rows:
        assert isinstance(cb, Decimal) and isinstance(gross, Decimal)
        period = f"{gjahr}-{int(poper):02d}"
        cb_period[(provider, recipient, period)] = cb
        cb_fy[(provider, recipient)] = cb_fy.get((provider, recipient), ZERO) + cb
        gross_fy[(provider, recipient)] = \
            gross_fy.get((provider, recipient), ZERO) + gross
    return cb_period, cb_fy, gross_fy


@pytest.fixture(scope="module")
def demo_runs() -> list[dict]:
    """Stages 1-6 over the actual seeds for all 4 periods — ZERO exceptions,
    zero blocked pools (the M4 demo pipeline, ADAPTATION D5)."""
    ref = {
        "entities": _seed_doc("entities.v1.json")["rows"],
        "cc_mapping": _seed_doc("cc_mapping.v1.json")["rows"],
        "pools": _seed_doc("pools.v1.json")["rows"],
        "key_defs": _seed_doc("key_defs.v1.json")["rows"],
        "participation": _seed_doc("participation.v1.json")["rows"],
        "key_values": _seed_doc("key_values.v1.json")["actual"],
        "markup_policies": _seed_doc("markup_policies.v1.json")["rows"],
    }
    exclusions = {"exclusions": _seed_doc("exclusions.v1.json")["rows"]}
    cost_lines = _seed_doc("cost_lines.v1.json")["actual"]

    runs: list[dict] = []
    for provider, periods in PROVIDER_PERIODS.items():
        for period in periods:
            lines = [r for r in cost_lines
                     if r["provider_entity_id"] == provider
                     and r["fiscal_period"] == period]
            config = {"period": period,
                      "scope": {"providerEntityIds": [provider]},
                      "runType": "actual", "fxRateType": "monthly_average",
                      "chargeCurrency": "provider"}
            s1 = stage1_capture_and_classify({"cost_lines": lines}, ref, config)
            s2 = stage2_pool(
                {"classified_lines": s1["outputs"]["classified_lines"]},
                ref, config)
            s3 = stage3_benefit_gate({"pools": s2["outputs"]["pools"]},
                                     exclusions, config)
            s4 = stage4_allocate({"pools": s3["outputs"]["pools"]}, ref, config)
            s5 = stage5_markup(
                {"pools": s4["outputs"]["pools"],
                 "direct_charges": s2["outputs"]["direct_charges"],
                 "pass_through": s2["outputs"]["pass_through"]},
                ref, config)
            s6 = stage6_chargeout({"charges": s5["outputs"]["charges"]},
                                  ref, config)
            for name, stage in (("s1", s1), ("s2", s2), ("s3", s3),
                                ("s4", s4), ("s5", s5), ("s6", s6)):
                assert stage["exceptions"] == [], (provider, period, name)
                assert stage["outputs"].get("blocked_pool_ids", []) == [], \
                    (provider, period, name)
            runs.append({"provider": provider, "period": period,
                         "s3": s3, "s5": s5, "s6": s6})
    return runs


def test_demo_gate_fy_pair_cost_and_gross_tie_to_warehouse_to_the_cent(demo_runs):
    """THE M4 DEMO RECONCILIATION GATE (ADAPTATION D5): per (provider,
    recipient): FY Σ cost_recovered_amount == warehouse SERVICE pair cost
    base AND FY Σ gross_charge_amount == warehouse pair gross — TO THE CENT.
    Per-period engine charges are policy-smooth (cb + HALF_EVEN markup at the
    pair-effective benchmarked rate); the in-period gaps vs. noisy postings
    are the policy-vs-posted story (feeds OTP-43)."""
    cb_period, cb_fy, gross_fy = _warehouse_pairs()
    policy_rate = {(p["pool_id"], p["jurisdiction"]): Decimal(p["markup_pct"])
                   for p in _seed_doc("markup_policies.v1.json")["rows"]}
    entities = {e["entity_id"]: e for e in _seed_doc("entities.v1.json")["rows"]}

    fy_cost: dict[tuple[str, str], Decimal] = {}
    fy_gross: dict[tuple[str, str], Decimal] = {}
    for run in demo_runs:
        provider, period = run["provider"], run["period"]
        rows = run["s6"]["outputs"]["charges"]
        # the management pools are 100% excluded -> no charges, ever
        assert all(r["pool_id"] == SERVICE_POOLS[provider] for r in rows)
        for r in rows:
            recipient = r["recipient_entity_id"]
            cost = Decimal(r["cost_recovered_amount"])
            gross = Decimal(r["gross_charge_amount"])
            markup = Decimal(r["markup_amount"])
            assert cost + markup == gross                    # schema identity
            # per period: cost == warehouse pair cb; markup == HALF_EVEN
            # (cb x pair-effective rate) — verified via the seeded policy
            assert cost == cb_period[(provider, recipient, period)]
            rate = policy_rate[(r["pool_id"],
                                entities[recipient]["jurisdiction"])]
            assert Decimal(r["markup_pct_applied"]) == rate
            assert markup == (cost * rate).quantize(Decimal("0.01"))
            key = (provider, recipient)
            fy_cost[key] = fy_cost.get(key, ZERO) + cost
            fy_gross[key] = fy_gross.get(key, ZERO) + gross

    assert fy_cost == cb_fy                                  # cb to the cent
    assert fy_gross == gross_fy                              # gross to the cent
    assert set(fy_cost) == {("1000", "3000"), ("3100", "3200"),
                            ("3100", "3300"), ("3100", "3800")}


def test_demo_gate_blended_markup_is_the_5_58_pct_story(demo_runs):
    """The blended FY markup across all pairs (Σ gross / Σ cost − 1) is the
    5.58% story (ADAPTATION D2), to four decimal places."""
    total_cost = total_gross = ZERO
    for run in demo_runs:
        for r in run["s6"]["outputs"]["charges"]:
            total_cost += Decimal(r["cost_recovered_amount"])
            total_gross += Decimal(r["gross_charge_amount"])
    blended = total_gross / total_cost - ONE
    assert blended.quantize(Decimal("0.0001")) == Decimal("0.0558")


def test_demo_gate_otp15_exclusions_tie_to_the_stewardship_register(demo_runs):
    """OTP-15 tie (ADAPTATION D2): total Stage-3 exclusions across the FY ==
    6,950,000.00, split 4,250,000.00 (provider 1000) / 2,700,000.00 (3100) —
    the stewardship register's flagged lines, to the cent."""
    by_provider: dict[str, Decimal] = {}
    for run in demo_runs:
        provider = run["provider"]
        for pool in run["s3"]["outputs"]["pools"]:
            assert pool["total_exclusions"] >= ZERO
            # exclusions live on the management pools only
            if pool["pool_id"] != MGMT_POOLS[provider]:
                assert pool["total_exclusions"] == ZERO
            by_provider[provider] = (by_provider.get(provider, ZERO)
                                     + pool["total_exclusions"])
    assert by_provider == STEWARDSHIP
    assert sum(by_provider.values(), ZERO) == Decimal("6950000.00")


def test_demo_gate_charge_rows_fx_and_posting_files(demo_runs):
    """Demo charge-out attributes (ADAPTATION D2/D5): every leg charges in
    USD (provider booking currency) with the identity rate 1.0 logged and the
    configured fx_rate_type; one posting file per provider per run with
    invoice_required on every cross-border leg."""
    for run in demo_runs:
        provider = run["provider"]
        rows = run["s6"]["outputs"]["charges"]
        assert len(rows) == (1 if provider == "1000" else 3)
        for r in rows:
            assert r["charge_currency"] == "USD"
            assert r["fx_rate"] == "1.0"
            assert r["fx_rate_type"] == "Monthly average"
            assert r["budget_or_actual"] == "Actual"
            assert r["allocation_key_id"] is not None
        (pf,) = run["s6"]["outputs"]["posting_files"]
        assert pf["provider_entity_id"] == provider
        assert [c["charge_id"] for c in pf["charges"]] \
            == [r["charge_id"] for r in rows]
        assert all(c["invoice_required"] for c in pf["charges"])
        assert {c["gross_amount"] for c in pf["charges"]} \
            == {r["gross_charge_amount"] for r in rows}
