"""M5 gate — cascade (topological) + reciprocal (SCC simultaneous equations)
(SPEC §10 M5 + §5.2-5.3 + §7 V-C rules; ADAPTATION D5).

Covers, in order:
- the graph algorithms directly: Tarjan SCC (deterministic, reverse-topo
  emission), condensation topological order, and the Decimal reciprocal
  solver (Gaussian elimination matching the hand algebra; contract
  violations; singular system exhausting the iterative fallback);
- the HAND-COMPUTED 3-ENTITY CASCADE FIXTURE (SPEC §5.2): topological run
  order, the tier-1 charge received by the hub becoming a schema-shaped cost
  line (cost_nature "Intercompany charge received", lineage to the
  originating charge — V-C3 by construction), the "single" margin policy
  carrying markup_exempt_component so the hub marks up ONLY its own cost,
  and "perTier" re-margining everything with V-C2 WARN on every run;
- the HAND-SOLVED 2-ENTITY RECIPROCAL PAIR (SPEC §5.3, the ADAPTATION D5 M5
  gate): the solved S match the algebraic solution and every external charge
  matches the hand solution Decimal-exact TO THE CENT, markup once on each
  department's own cost component;
- the conservation property (SPEC §9.3): total in == total charged out
  across the SCC, exactly, plus determinism under input reordering;
- V-C rule firing: V-C1 BLOCK (solver disabled; unconverged singular cycle),
  V-C2 WARN (perTier, every run), V-C3 BLOCK (received-charge line without
  lineage; incomplete supplied lineage record);
- cascade guard rails: indeterminate routing (hub providing two pools) and
  cross-currency edges BLOCK as V-R1; an upstream BLOCK propagates to every
  downstream pool; a flat (edge-free) graph degrades to exactly the plain
  Stage-4 + Stage-5 pass; the DEMO dataset stays flat (ADAPTATION D3).

NO float arithmetic on amounts anywhere in this file (ENGINE-CLAUDE.md).

Run from backend/:
    ../.venv/bin/python -m pytest tests/allocation/test_m5_cascade_reciprocal.py
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest

from allocation import validation
from allocation.algorithms.cascade import (
    cascade_allocate,
    received_charge_cost_line,
    upstream_charge_ref,
)
from allocation.algorithms.reciprocal import (
    ReciprocalSolverError,
    condensation_order,
    solve_reciprocal,
    tarjan_scc,
)
from allocation.generated import types as gen
from allocation.stages import stage4_allocate, stage5_markup
from allocation.validation import rules

BACKEND = Path(__file__).resolve().parents[2]
SEED_DIR = BACKEND / "seeds" / "allocation"
PERIOD = "2026-05"
CFG = {"period": PERIOD}
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


def mk_key_def(key_id: str, **over) -> dict:
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


def mk_key_value(pool_id: str, key_id: str, recipient: str, factor: str,
                 total: str, **over) -> dict:
    row = {
        "key_value_id": f"KV-{pool_id}-{recipient}-{PERIOD}",
        "key_id": key_id,
        "pool_id": pool_id,
        "recipient_entity_id": recipient,
        "period": PERIOD,
        "factor_value": factor,
        "total_factor_value": total,
        "allocation_ratio": "0",  # supplied ratio is never trusted (V-K3)
        "as_of_date": "2026-05-31",
    }
    row.update(over)
    return row


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


def mk_line(line_id: str, provider: str, pool_id: str, amount: str,
            *, cost_nature: str = "Payroll", function: str = "IT",
            **over) -> dict:
    row = {
        "cost_line_id": line_id,
        "provider_entity_id": provider,
        "company_code": provider,
        "cost_center": f"CC-{provider}",
        "cost_element": "6500-Salaries",
        "cost_nature": cost_nature,
        "function": function,
        "amount_local": amount,
        "currency_local": "USD",
        "posting_date": "2026-05-31",
        "fiscal_period": PERIOD,
        "fiscal_year": "2026",
        "flow_type": "Service",
        "charge_method": "Indirect",
        "pass_through_flag": False,
        "pool_id": pool_id,
        "source_document_ref": f"DOC-{line_id}",
    }
    row.update(over)
    return row


def mk_stage3_pool(pool_id: str, base: str, *, provider: str,
                   key_id: str, service_line: str = "IT",
                   lines: list[dict] | None = None, **over) -> dict:
    """A Stage-3-shaped pool dict (the cascade_allocate input contract)."""
    lines = [] if lines is None else lines
    row = {
        "pool_id": pool_id,
        "provider_entity_id": provider,
        "period": PERIOD,
        "service_line": service_line,
        "characterization": "Routine-benchmarked",
        "default_key_id": key_id,
        "direct_charge_flag": False,
        "documentation_ref": None,
        "total_pooled_cost": Decimal(base),
        "line_ids": [l["cost_line_id"] for l in lines],
        "lines": lines,
        "total_exclusions": ZERO,
        "chargeable_base": Decimal(base),
        "exclusions_applied": [],
    }
    row.update(over)
    return row


def run_cascade(pools, ref, config=CFG) -> dict:
    return cascade_allocate({"pools": pools}, ref, config)


# ------------------------------------------ graph + solver units (SPEC §5.2-3) --


def test_tarjan_scc_detects_cycles_in_reverse_topological_order():
    """Tarjan SCC: {B, C} is one component (B->C->B); emission is reverse
    topological (a component only after everything it points to);
    deterministic ascending order inside each component."""
    edges = {"A": {"B"}, "B": {"C"}, "C": {"B", "D"}, "D": set()}
    sccs = tarjan_scc(["A", "B", "C", "D"], edges)
    assert sccs == [["D"], ["B", "C"], ["A"]]
    # edges to unknown nodes are ignored
    assert tarjan_scc(["A"], {"A": {"Z"}}) == [["A"]]


def test_condensation_order_is_topological_sources_first():
    """condensation_order reverses Tarjan's emission: sources first — the
    SPEC §5.2 cascade run order."""
    edges = {"A": {"B"}, "B": {"C"}, "C": {"B", "D"}, "D": set()}
    assert condensation_order(["A", "B", "C", "D"], edges) \
        == [["A"], ["B", "C"], ["D"]]


def test_solve_reciprocal_gaussian_matches_hand_algebra():
    """S_A = 1000 + 0.5·S_B and S_B = 600 + 0.2·S_A solve to S_A = 13000/9,
    S_B = 8000/9 — the Decimal Gaussian elimination reproduces the algebra
    (full precision-28, no rounding inside the solver)."""
    solved = solve_reciprocal(
        {"A": Decimal("1000.00"), "B": Decimal("600.00")},
        {("A", "B"): Decimal("0.2"), ("B", "A"): Decimal("0.5")},
    )
    q = Decimal("1E-20")
    assert solved["A"].quantize(q) == (Decimal(13000) / Decimal(9)).quantize(q)
    assert solved["B"].quantize(q) == (Decimal(8000) / Decimal(9)).quantize(q)


def test_solve_reciprocal_contract_violations_raise():
    """Unknown nodes and negative shares are upstream gating bugs — they
    raise ValueError, not V-rule exceptions (the V-K gate runs first)."""
    with pytest.raises(ValueError, match="outside the SCC"):
        solve_reciprocal({"A": ONE}, {("A", "Z"): Decimal("0.1")})
    with pytest.raises(ValueError, match="negative consumption"):
        solve_reciprocal({"A": ONE, "B": ONE}, {("A", "B"): Decimal("-0.1")})


def test_solve_reciprocal_singular_system_exhausts_fallback_and_raises():
    """A closed 100%/100% cycle is singular (Gaussian pivot 0) and the
    iterative fallback diverges — ReciprocalSolverError after 1,000
    iterations at tolerance 1e-10 (SPEC §5.3)."""
    with pytest.raises(ReciprocalSolverError, match="did not converge"):
        solve_reciprocal(
            {"A": Decimal("100.00"), "B": Decimal("100.00")},
            {("A", "B"): ONE, ("B", "A"): ONE},
        )


# ------------------------- hand-computed 3-entity cascade fixture (SPEC §5.2) --


CASCADE_ENTITIES = [
    mk_entity("1000"),                                       # tier-1 provider
    mk_entity("5000", jurisdiction="NL"),                    # hub: both roles
    mk_entity("6000", jurisdiction="DE"),                    # opco
]


def cascade_fixture() -> tuple[list[dict], dict]:
    """1000 --POOL-P1--> {5000 hub, 6000}; 5000 --POOL-HUB--> {6000}.

    Hand computation (all USD): P1 base 1000.00, key 1:3 -> 250.00 to the hub
    + 750.00 to 6000; benchmarked 10% -> hub receives gross 275.00. The hub's
    pool: own 500.00 + received 275.00 = 775.00 to 6000 (single beneficiary);
    under "single" only the OWN 500.00 bears the hub's LVAIGS 5% -> markup
    25.00, gross 800.00.
    """
    pools = [
        mk_stage3_pool("POOL-HUB", "500.00", provider="5000",
                       key_id="KEY-HUB", service_line="Finance",
                       lines=[mk_line("CL-HUB-1", "5000", "POOL-HUB",
                                      "500.00", function="Finance")]),
        mk_stage3_pool("POOL-P1", "1000.00", provider="1000", key_id="KEY-P1",
                       lines=[mk_line("CL-P1-1", "1000", "POOL-P1",
                                      "1000.00")]),
    ]
    ref = {
        "entities": list(CASCADE_ENTITIES),
        "participation": [mk_participation("POOL-P1", "5000"),
                          mk_participation("POOL-P1", "6000"),
                          mk_participation("POOL-HUB", "6000")],
        "key_defs": [mk_key_def("KEY-P1"), mk_key_def("KEY-HUB")],
        "key_values": [mk_key_value("POOL-P1", "KEY-P1", "5000", "1", "4"),
                       mk_key_value("POOL-P1", "KEY-P1", "6000", "3", "4"),
                       mk_key_value("POOL-HUB", "KEY-HUB", "6000", "1", "1")],
        "markup_policies": [
            mk_policy("POOL-P1", "NL", pct="0.10"),
            mk_policy("POOL-P1", "DE", pct="0.10"),
            mk_policy("POOL-HUB", "DE", regime="LVAIGS (5%)", pct="0.05"),
        ],
    }
    return pools, ref


def test_cascade_runs_pools_in_topological_order():
    """SPEC §5.2 — the directed (provider, pool) graph orders POOL-P1 before
    the hub pool it charges into, regardless of input ordering."""
    pools, ref = cascade_fixture()
    res = run_cascade(pools, ref)
    assert res["outputs"]["order"] == [["POOL-P1"], ["POOL-HUB"]]
    assert [p["pool_id"] for p in res["outputs"]["pools"]] \
        == ["POOL-P1", "POOL-HUB"]


def test_cascade_received_charge_becomes_hub_cost_line_with_lineage_v_c3():
    """SPEC §5.2 — the tier-1 charge received by the hub becomes a cost line
    in the hub's books: cost_nature "Intercompany charge received", gross
    (already-marked-up) amount, full lineage to the originating charge
    (V-C3 holds by construction), schema-shaped against the generated
    1_CostLine metadata."""
    pools, ref = cascade_fixture()
    res = run_cascade(pools, ref)
    assert res["exceptions"] == []          # incl. no V-C3, no V-C2 (single)
    assert res["outputs"]["blocked_pool_ids"] == []

    (line,) = res["outputs"]["received_lines"]
    assert line["cost_line_id"] == "CL-RCV-CHG-2026-05-POOL-P1-5000"
    assert line["cost_nature"] == "Intercompany charge received"
    assert line["amount_local"] == "275.00"              # 250.00 + 10% markup
    assert line["provider_entity_id"] == "5000"          # the hub bears it
    assert line["pool_id"] == "POOL-HUB"
    assert line["function"] == "Finance"                 # the hub pool's line
    assert line["source_document_ref"] == "CHG-2026-05-POOL-P1-5000"
    # the synthesized row is exactly schema-shaped (new enum value included)
    assert "Intercompany charge received" in gen.ENUM_VALUES["cost_nature"]
    assert validation.validate_rows("1_CostLine", [line]) == []

    (lineage,) = res["outputs"]["received_lineage"]
    assert lineage == {
        "cost_line_id": "CL-RCV-CHG-2026-05-POOL-P1-5000",
        "pool_id": "POOL-HUB",
        "upstream_charge_ref": "CHG-2026-05-POOL-P1-5000",
        "upstream_pool_id": "POOL-P1",
        "provider_entity_id": "1000",
        "recipient_entity_id": "5000",
        "period": PERIOD,
        "amount": Decimal("275.00"),
        "markup_exempt": True,
    }


def test_cascade_hand_computed_charges_single_margin_policy_to_the_cent():
    """The hand-computed cascade, Decimal-exact to the cent (SPEC §5.2,
    default "single" policy): the received component joins the hub pool at
    its marked-up amount and is NEVER re-margined — only the hub's own
    500.00 bears the hub's 5%."""
    pools, ref = cascade_fixture()
    res = run_cascade(pools, ref)
    assert res["exceptions"] == []

    by_leg = {(c["pool_id"], c["recipient_entity_id"]): c
              for c in res["outputs"]["charges"]}
    assert len(by_leg) == 3
    p1_hub = by_leg[("POOL-P1", "5000")]
    assert p1_hub["cost_recovered"] == Decimal("250.00")
    assert p1_hub["markup_amount"] == Decimal("25.00")
    assert p1_hub["gross_charge"] == Decimal("275.00")
    p1_opco = by_leg[("POOL-P1", "6000")]
    assert p1_opco["cost_recovered"] == Decimal("750.00")
    assert p1_opco["markup_amount"] == Decimal("75.00")
    assert p1_opco["gross_charge"] == Decimal("825.00")

    hub = by_leg[("POOL-HUB", "6000")]
    assert hub["cost_recovered"] == Decimal("775.00")     # 500 own + 275 rcvd
    assert hub["markup_exempt_cost"] == Decimal("275.00")
    assert hub["markup_pct"] == Decimal("0.05")
    assert hub["markup_amount"] == Decimal("25.00")       # 5% of OWN 500 only
    assert hub["gross_charge"] == Decimal("800.00")
    # the hub charge carries lineage through the received line
    assert hub["line_ids"] == ["CL-HUB-1", "CL-RCV-CHG-2026-05-POOL-P1-5000"]

    hub_pool = res["outputs"]["pools"][1]
    assert hub_pool["total_pooled_cost"] == Decimal("775.00")
    assert hub_pool["chargeable_base"] == Decimal("775.00")
    assert hub_pool["markup_exempt_component"] == Decimal("275.00")
    (alloc,) = hub_pool["allocations"]
    assert alloc["allocated_cost"] == Decimal("775.00")
    assert alloc["markup_exempt_cost"] == Decimal("275.00")

    # whole-system tie-out: 6000 pays everything in = own costs + every markup
    received_by_opco = sum((c["gross_charge"] for c in by_leg.values()
                            if c["recipient_entity_id"] == "6000"), ZERO)
    assert received_by_opco == Decimal("1625.00")  # 1500 cost + 100 + 25 markup


def test_v_c2_per_tier_re_margins_everything_and_warns_every_run():
    """V-C2 WARN — "perTier" must warn on EVERY run (double-margining is
    deliberate): the hub re-margins the full 775.00 (received component
    included) at 5% -> 38.75."""
    for _ in range(2):  # every run, not just the first
        pools, ref = cascade_fixture()
        res = run_cascade(pools, ref,
                          config=dict(CFG, cascadeMarkupPolicy="perTier"))
        fired = rules.fired(res["exceptions"], "V-C2")
        assert len(fired) == 1 and fired[0]["severity"] == "WARN"
        assert res["outputs"]["blocked_pool_ids"] == []   # WARN continues
        hub = next(c for c in res["outputs"]["charges"]
                   if c["pool_id"] == "POOL-HUB")
        assert hub["markup_exempt_cost"] == ZERO          # nothing exempt
        assert hub["markup_amount"] == Decimal("38.75")   # 775.00 x 5%
        assert hub["gross_charge"] == Decimal("813.75")
        # the received line itself still joins at the upstream gross
        (line,) = res["outputs"]["received_lines"]
        assert line["amount_local"] == "275.00"


def test_cascade_deterministic_under_input_reordering():
    """Determinism (SPEC §5.1 convention): identical outputs regardless of
    the ordering of pools and reference rows."""
    pools, ref = cascade_fixture()
    a = run_cascade(pools, ref)
    pools2, ref2 = cascade_fixture()
    b = run_cascade(
        list(reversed(pools2)),
        {key: (list(reversed(rows)) if isinstance(rows, list) else rows)
         for key, rows in ref2.items()},
    )
    assert a == b


def test_cascade_upstream_block_withholds_downstream_pools():
    """A BLOCK on the tier-1 pool propagates: the hub pool would otherwise
    run on a silently short base (no V-rule of its own — the root cause is
    already on the report; the hub is withheld and logged)."""
    pools, ref = cascade_fixture()
    ref["key_values"] = [kv for kv in ref["key_values"]
                         if kv["pool_id"] != "POOL-P1"]    # V-K1 on POOL-P1
    res = run_cascade(pools, ref)
    assert [e["rule_id"] for e in res["exceptions"]] == ["V-K1"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-HUB", "POOL-P1"]
    assert res["outputs"]["pools"] == []
    assert res["outputs"]["charges"] == []
    assert any("upstream pool POOL-P1 blocked" in entry
               for entry in res["log"])


def test_cascade_indeterminate_destination_blocks_v_r1():
    """A receiving provider with TWO in-scope pools cannot route the received
    charge to exactly one destination — V-R1 BLOCK on both candidate pools;
    the upstream pool still charges normally (never a defaulted routing)."""
    pools, ref = cascade_fixture()
    extra = mk_stage3_pool("POOL-HU2", "100.00", provider="5000",
                           key_id="KEY-HUB", service_line="Finance")
    ref["participation"].append(mk_participation("POOL-HU2", "6000"))
    ref["key_values"].append(mk_key_value("POOL-HU2", "KEY-HUB", "6000",
                                          "1", "1"))
    ref["markup_policies"].append(
        mk_policy("POOL-HU2", "DE", regime="LVAIGS (5%)", pct="0.05"))
    res = run_cascade(pools + [extra], ref)
    fired = rules.fired(res["exceptions"], "V-R1")
    assert len(fired) == 2 and all(e["severity"] == "BLOCK" for e in fired)
    assert all("exactly one destination" in e["message"] for e in fired)
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-HU2", "POOL-HUB"]
    assert [c["pool_id"] for c in res["outputs"]["charges"]] \
        == ["POOL-P1", "POOL-P1"]
    assert res["outputs"]["received_lines"] == []


def test_cascade_cross_currency_edge_blocks_v_r1():
    """A received charge in a currency other than the hub's booking currency
    cannot join the hub's books — the stage-4 cascade path has no FX
    snapshot; v1 requires currency homogeneity along edges (V-R1 BLOCK,
    DECISIONS.md M5)."""
    pools, ref = cascade_fixture()
    ref["entities"] = [mk_entity("1000"),
                       mk_entity("5000", jurisdiction="NL", currency="EUR"),
                       mk_entity("6000", jurisdiction="DE")]
    res = run_cascade(pools, ref)
    fired = rules.fired(res["exceptions"], "V-R1")
    assert len(fired) == 1 and fired[0]["severity"] == "BLOCK"
    assert "currency homogeneity" in fired[0]["message"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-HUB"]
    # the tier-1 pool itself is unaffected
    assert [c["pool_id"] for c in res["outputs"]["charges"]] \
        == ["POOL-P1", "POOL-P1"]


# ----------------------------------------------- V-C3 — received-line lineage --


def vc3_fixture() -> tuple[list[dict], dict]:
    """One pool whose INPUT lines include a GL-booked received charge."""
    lines = [mk_line("CL-G-1", "9000", "POOL-G", "600.00"),
             mk_line("CL-G-RCV", "9000", "POOL-G", "400.00",
                     cost_nature="Intercompany charge received")]
    pools = [mk_stage3_pool("POOL-G", "1000.00", provider="9000",
                            key_id="KEY-G", lines=lines)]
    ref = {
        "entities": [mk_entity("9000"), mk_entity("9100", jurisdiction="DE")],
        "participation": [mk_participation("POOL-G", "9100")],
        "key_defs": [mk_key_def("KEY-G")],
        "key_values": [mk_key_value("POOL-G", "KEY-G", "9100", "1", "1")],
        "markup_policies": [mk_policy("POOL-G", "DE", pct="0.10")],
    }
    return pools, ref


def test_v_c3_received_line_without_lineage_blocks():
    """V-C3 BLOCK — a cost line with cost_nature "Intercompany charge
    received" and no upstream charge lineage withholds the pool."""
    pools, ref = vc3_fixture()
    res = run_cascade(pools, ref)
    fired = rules.fired(res["exceptions"], "V-C3")
    assert len(fired) == 1 and fired[0]["severity"] == "BLOCK"
    assert fired[0]["objects"] == ["CL-G-RCV"]
    assert "no upstream charge lineage" in fired[0]["message"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-G"]
    assert res["outputs"]["charges"] == []


def test_v_c3_incomplete_supplied_lineage_record_still_blocks():
    """An incomplete ref-data lineage record (missing markup_exempt) IS
    missing lineage — registering it silently would be a silent default
    (DECISIONS.md M5)."""
    pools, ref = vc3_fixture()
    ref["received_charge_lineage"] = {
        "CL-G-RCV": {"upstream_charge_ref": "CHG-2025-12-POOL-OLD-9000"}}
    res = run_cascade(pools, ref)
    assert len(rules.fired(res["exceptions"], "V-C3")) == 1
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-G"]


def test_v_c3_complete_supplied_lineage_passes_and_drives_exemption():
    """A COMPLETE supplied lineage record satisfies V-C3; under "single" a
    markup_exempt received line joins the markable base at zero — markup on
    the own 600.00 only — while markup_exempt=False re-margins it."""
    pools, ref = vc3_fixture()
    ref["received_charge_lineage"] = {
        "CL-G-RCV": {"upstream_charge_ref": "CHG-2025-12-POOL-OLD-9000",
                     "markup_exempt": True}}
    res = run_cascade(pools, ref)
    assert res["exceptions"] == []
    (charge,) = res["outputs"]["charges"]
    assert charge["cost_recovered"] == Decimal("1000.00")
    assert charge["markup_exempt_cost"] == Decimal("400.00")
    assert charge["markup_amount"] == Decimal("60.00")    # 600.00 x 10%
    assert charge["gross_charge"] == Decimal("1060.00")

    pools, ref = vc3_fixture()
    ref["received_charge_lineage"] = {
        "CL-G-RCV": {"upstream_charge_ref": "CHG-2025-12-POOL-OLD-9000",
                     "markup_exempt": False}}
    res = run_cascade(pools, ref)
    assert res["exceptions"] == []
    (charge,) = res["outputs"]["charges"]
    assert charge["markup_amount"] == Decimal("100.00")   # full base marked


# ----------------- hand-solved 2-entity reciprocal pair (SPEC §5.3, M5 gate) --


def reciprocal_fixture() -> tuple[list[dict], dict]:
    """POOL-RA (7100, C=1000.00) and POOL-RB (7200, C=600.00) provide to each
    other and to the external 7300 (DE).

    Hand algebra: a_AB = 0.2 (B consumes 20% of A), a_BA = 0.5.
        S_A = 1000 + 0.5·S_B,  S_B = 600 + 0.2·S_A
        ⇒ S_B = 8000/9 = 888.8̄,  S_A = 13000/9 = 1444.4̄
    External charges (key shares: A→7300 80%, B→7300 50%):
        A→7300 = 0.8·S_A = 10400/9 = 1155.5̄  → 1155.56 (largest remainder)
        B→7300 = 0.5·S_B =  4000/9 =  444.4̄  →  444.44
        Σ = 1600.00 = C_A + C_B exactly (conservation).
    Markup once on each department's OWN cost component:
        A: 0.8·1000 = 800.00 × 6% = 48.00 → gross 1203.56
        B: 0.5·600  = 300.00 × 8% = 24.00 → gross  468.44
    """
    pools = [
        mk_stage3_pool("POOL-RA", "1000.00", provider="7100", key_id="KEY-RA"),
        mk_stage3_pool("POOL-RB", "600.00", provider="7200", key_id="KEY-RB",
                       service_line="Finance"),
    ]
    ref = {
        "entities": [mk_entity("7100"),
                     mk_entity("7200", jurisdiction="GB"),
                     mk_entity("7300", jurisdiction="DE")],
        "participation": [mk_participation("POOL-RA", "7200"),
                          mk_participation("POOL-RA", "7300"),
                          mk_participation("POOL-RB", "7100"),
                          mk_participation("POOL-RB", "7300")],
        "key_defs": [mk_key_def("KEY-RA"), mk_key_def("KEY-RB")],
        "key_values": [
            mk_key_value("POOL-RA", "KEY-RA", "7200", "20", "100"),
            mk_key_value("POOL-RA", "KEY-RA", "7300", "80", "100"),
            mk_key_value("POOL-RB", "KEY-RB", "7100", "50", "100"),
            mk_key_value("POOL-RB", "KEY-RB", "7300", "50", "100"),
        ],
        "markup_policies": [mk_policy("POOL-RA", "DE", pct="0.06"),
                            mk_policy("POOL-RB", "DE", pct="0.08")],
    }
    return pools, ref


def test_reciprocal_pair_matches_hand_solved_system_to_the_cent():
    """THE M5 GATE (ADAPTATION D5): the reciprocal fixture matches the
    hand-solved linear system — solved S against the algebra, every external
    charge Decimal-exact to the cent, markup once on the own-cost
    component."""
    pools, ref = reciprocal_fixture()
    res = run_cascade(pools, ref)
    assert res["exceptions"] == []
    assert res["outputs"]["blocked_pool_ids"] == []
    assert res["outputs"]["order"] == [["POOL-RA", "POOL-RB"]]  # one SCC

    by_pool = {p["pool_id"]: p for p in res["outputs"]["pools"]}
    q = Decimal("1E-20")
    assert by_pool["POOL-RA"]["solved_cost"].quantize(q) \
        == (Decimal(13000) / Decimal(9)).quantize(q)
    assert by_pool["POOL-RB"]["solved_cost"].quantize(q) \
        == (Decimal(8000) / Decimal(9)).quantize(q)
    assert by_pool["POOL-RA"]["reciprocal_scc"] == ["POOL-RA", "POOL-RB"]
    assert by_pool["POOL-RA"]["internal_consumption"] \
        == {"POOL-RB": Decimal("0.2")}
    assert by_pool["POOL-RB"]["internal_consumption"] \
        == {"POOL-RA": Decimal("0.5")}

    # external charges, hand-solved to the cent (only non-SCC recipients)
    charges = {c["pool_id"]: c for c in res["outputs"]["charges"]}
    assert len(res["outputs"]["charges"]) == 2
    ra = charges["POOL-RA"]
    assert ra["recipient_entity_id"] == "7300"
    assert ra["cost_recovered"] == Decimal("1155.56")     # 10400/9, rounded up
    assert ra["markup_exempt_cost"] == Decimal("355.56")  # received component
    assert ra["markup_amount"] == Decimal("48.00")        # 6% of OWN 800.00
    assert ra["gross_charge"] == Decimal("1203.56")
    rb = charges["POOL-RB"]
    assert rb["recipient_entity_id"] == "7300"
    assert rb["cost_recovered"] == Decimal("444.44")      # 4000/9, rounded dn
    assert rb["markup_exempt_cost"] == Decimal("144.44")
    assert rb["markup_amount"] == Decimal("24.00")        # 8% of OWN 300.00
    assert rb["gross_charge"] == Decimal("468.44")

    # no internal SCC charges are ledgered; no received lines synthesized
    assert res["outputs"]["received_lines"] == []


def test_reciprocal_conservation_total_in_equals_total_charged_out():
    """SPEC §9.3 property — reciprocal solver conservation: total cost in ==
    total charged out across the SCC, EXACTLY (largest-remainder over the
    SCC-wide weights guarantees the sum by construction)."""
    pools, ref = reciprocal_fixture()
    res = run_cascade(pools, ref)
    total_in = sum((p["chargeable_base"] for p in pools), ZERO)
    total_out = sum((c["cost_recovered"] for c in res["outputs"]["charges"]),
                    ZERO)
    assert total_in == total_out == Decimal("1600.00")
    assert sum((a["allocated_cost"] for a in res["outputs"]["allocations"]),
               ZERO) == Decimal("1600.00")


def test_reciprocal_three_member_scc_conserves_with_repeating_ratios():
    """Conservation holds on a messier 3-member SCC whose shares are
    repeating decimals (7/21, 5/16, 1/3 ...): Σ external cost == Σ C to the
    cent, and outputs are deterministic under input reordering."""
    def fixture() -> tuple[list[dict], dict]:
        pools = [
            mk_stage3_pool("POOL-S1", "333.33", provider="E1", key_id="K-S1"),
            mk_stage3_pool("POOL-S2", "250.01", provider="E2", key_id="K-S2"),
            mk_stage3_pool("POOL-S3", "416.66", provider="E3", key_id="K-S3"),
        ]
        ref = {
            "entities": [mk_entity("E1"), mk_entity("E2"), mk_entity("E3"),
                         mk_entity("EX1", jurisdiction="FR"),
                         mk_entity("EX2", jurisdiction="IT")],
            "participation": [
                mk_participation("POOL-S1", "E2"),
                mk_participation("POOL-S1", "E3"),
                mk_participation("POOL-S1", "EX1"),
                mk_participation("POOL-S2", "E1"),
                mk_participation("POOL-S2", "EX1"),
                mk_participation("POOL-S2", "EX2"),
                mk_participation("POOL-S3", "E1"),
                mk_participation("POOL-S3", "E2"),
                mk_participation("POOL-S3", "EX2"),
            ],
            "key_defs": [mk_key_def("K-S1"), mk_key_def("K-S2"),
                         mk_key_def("K-S3")],
            "key_values": [
                mk_key_value("POOL-S1", "K-S1", "E2", "7", "21"),
                mk_key_value("POOL-S1", "K-S1", "E3", "3", "21"),
                mk_key_value("POOL-S1", "K-S1", "EX1", "11", "21"),
                mk_key_value("POOL-S2", "K-S2", "E1", "5", "16"),
                mk_key_value("POOL-S2", "K-S2", "EX1", "9", "16"),
                mk_key_value("POOL-S2", "K-S2", "EX2", "2", "16"),
                mk_key_value("POOL-S3", "K-S3", "E1", "1", "3"),
                mk_key_value("POOL-S3", "K-S3", "E2", "1", "3"),
                mk_key_value("POOL-S3", "K-S3", "EX2", "1", "3"),
            ],
            "markup_policies": [mk_policy("POOL-S1", "FR", pct="0.05"),
                                mk_policy("POOL-S2", "FR", pct="0.05"),
                                mk_policy("POOL-S2", "IT", pct="0.05"),
                                mk_policy("POOL-S3", "IT", pct="0.05")],
        }
        return pools, ref

    pools, ref = fixture()
    res = run_cascade(pools, ref)
    assert res["exceptions"] == []
    assert res["outputs"]["order"] == [["POOL-S1", "POOL-S2", "POOL-S3"]]
    total_out = sum((c["cost_recovered"] for c in res["outputs"]["charges"]),
                    ZERO)
    assert total_out == Decimal("1000.00")               # 333.33+250.01+416.66
    # every external leg is cent-grain and non-negative; markups also conserve
    for charge in res["outputs"]["charges"]:
        assert charge["cost_recovered"] == charge["cost_recovered"] \
            .quantize(Decimal("0.01"))
        assert charge["cost_recovered"] >= ZERO
        assert charge["gross_charge"] \
            == charge["cost_recovered"] + charge["markup_amount"]

    pools2, ref2 = fixture()
    again = run_cascade(
        list(reversed(pools2)),
        {key: (list(reversed(rows)) if isinstance(rows, list) else rows)
         for key, rows in ref2.items()},
    )
    assert again == res


def test_v_c1_cycle_with_solver_disabled_blocks():
    """V-C1 BLOCK — a detected cycle with the reciprocal solver disabled
    halts every member pool (config reciprocalSolverEnabled = false)."""
    pools, ref = reciprocal_fixture()
    res = run_cascade(pools, ref,
                      config=dict(CFG, reciprocalSolverEnabled=False))
    fired = rules.fired(res["exceptions"], "V-C1")
    assert len(fired) == 2 and all(e["severity"] == "BLOCK" for e in fired)
    assert all("solver is disabled" in e["message"] for e in fired)
    assert sorted(e["pool_id"] for e in fired) == ["POOL-RA", "POOL-RB"]
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-RA", "POOL-RB"]
    assert res["outputs"]["charges"] == []
    assert res["outputs"]["allocations"] == []


def test_v_c1_unconverged_singular_cycle_blocks():
    """V-C1 BLOCK — a closed 100%/100% cycle (no external recipients) is
    singular; Gaussian falls back to iterative substitution, which cannot
    converge within 1,000 iterations at tolerance 1e-10 (SPEC §5.3)."""
    pools = [
        mk_stage3_pool("POOL-X", "100.00", provider="8100", key_id="KEY-X8"),
        mk_stage3_pool("POOL-Y", "100.00", provider="8200", key_id="KEY-Y8"),
    ]
    ref = {
        "entities": [mk_entity("8100"), mk_entity("8200")],
        "participation": [mk_participation("POOL-X", "8200"),
                          mk_participation("POOL-Y", "8100")],
        "key_defs": [mk_key_def("KEY-X8"), mk_key_def("KEY-Y8")],
        "key_values": [mk_key_value("POOL-X", "KEY-X8", "8200", "1", "1"),
                       mk_key_value("POOL-Y", "KEY-Y8", "8100", "1", "1")],
        "markup_policies": [],
    }
    res = run_cascade(pools, ref)
    fired = rules.fired(res["exceptions"], "V-C1")
    assert len(fired) == 2 and all(e["severity"] == "BLOCK" for e in fired)
    assert all("did not converge" in e["message"] for e in fired)
    assert res["outputs"]["blocked_pool_ids"] == ["POOL-X", "POOL-Y"]
    assert res["outputs"]["charges"] == []


# ------------------------------------------------ integration & demo guards --


def test_flat_graph_degrades_to_plain_stage4_stage5_pass():
    """On a flat (edge-free) graph cascade_allocate produces EXACTLY the
    Stage-4 + Stage-5 outputs — the M6 orchestrator can route every run
    through the cascade path without behavioral drift."""
    pools = [mk_stage3_pool("POOL-F", "100.01", provider="1000",
                            key_id="KEY-F")]
    ref = {
        "entities": [mk_entity("1000"), mk_entity("2000", jurisdiction="DE"),
                     mk_entity("2100", jurisdiction="GB")],
        "participation": [mk_participation("POOL-F", "2000"),
                          mk_participation("POOL-F", "2100")],
        "key_defs": [mk_key_def("KEY-F")],
        "key_values": [mk_key_value("POOL-F", "KEY-F", "2000", "2", "3"),
                       mk_key_value("POOL-F", "KEY-F", "2100", "1", "3")],
        "markup_policies": [mk_policy("POOL-F", "DE", pct="0.06"),
                            mk_policy("POOL-F", "GB", pct="0.08")],
    }
    res = run_cascade(pools, ref)
    assert res["exceptions"] == []
    assert res["outputs"]["received_lines"] == []
    assert res["outputs"]["order"] == [["POOL-F"]]

    s4 = stage4_allocate({"pools": pools}, ref, CFG)
    s5 = stage5_markup({"pools": s4["outputs"]["pools"]}, ref, CFG)
    assert s4["exceptions"] == [] and s5["exceptions"] == []
    assert res["outputs"]["allocations"] == s4["outputs"]["allocations"]
    assert res["outputs"]["charges"] == s5["outputs"]["charges"]
    assert res["outputs"]["pools"] == s5["outputs"]["pools"]


def test_demo_dataset_stays_flat_no_cascade_edges():
    """ADAPTATION D3 — the demo seeds have NO cascade: no beneficiary of any
    pool is itself a provider, so the demo runs never exercise §5.2-5.3
    (cascade + reciprocal are proven by these fixtures, not faked into demo
    data)."""
    pools = json.loads(
        (SEED_DIR / "pools.v1.json").read_text(encoding="utf-8"))["rows"]
    participation = json.loads(
        (SEED_DIR / "participation.v1.json").read_text(encoding="utf-8"))["rows"]
    providers = {p["provider_entity_id"] for p in pools}
    beneficiaries = {row["entity_id"] for row in participation
                     if row["role"] == "Beneficiary"}
    assert providers & beneficiaries == set()
