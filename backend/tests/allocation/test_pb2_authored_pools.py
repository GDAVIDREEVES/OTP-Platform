"""PB2 gate — AUTHORED POOL store + engine integration (Phase 6).

An authored pool is a governed EXPERIMENT: a user-built cost-to-charge pool
(cost-capture rule + key + exclusions + markup) run through the REAL Stages 1-7
in ISOLATION and flagged ``authored``. It NEVER touches the governed seeded
allocation. Covers, in order:

- the cost-capture preview: captured cost == a HAND-SUMMED cost-line subset for
  a CC rule, a PC rule and a GL/cost-element rule, to the cent (Decimal exact);
  split_pct scales it exactly; an over-range split BLOCKS (never defaulted);
- the dry-run through Stages 1-7: a sound pool reconciles to ZERO residual
  (V-X1) and prices charges; a beneficiary jurisdiction with NO markup policy
  surfaces V-M1 BLOCK (a missing markup is never defaulted); an empty capture
  rule surfaces V-P1 BLOCK;
- the lifecycle: draft -> tested (dry-run gate) -> in_review -> active, the
  tested-hash gate (an edit invalidates it), and maker != checker enforced on
  the allocpool: review hook;
- an authored allocation RUN: balanced, flagged authored, namespaced run id;
- GOLDEN non-regression: the governed demo allocation run (actual, all periods)
  is byte-identical / cent-exact (FY 14,344,773.26) — authored pools and an
  authored run never perturb it.

NO float arithmetic on amounts anywhere in this file (ENGINE-CLAUDE.md).

Run from backend/:
    ../.venv/bin/python -m pytest tests/allocation/test_pb2_authored_pools.py
"""

from __future__ import annotations

from decimal import Decimal

import pytest

import services.allocation_runner as runner
import state.allocation_store as store
import state.authored_pools as authored_pools
import state.engine as engine
import state.review as review

ZERO = Decimal("0")
PERIODS = ["2026-04", "2026-05", "2026-10", "2026-11"]


# A sound authored pool: capture provider-1000 IT-OPS cost centers, beneficiary
# 3000 (DE), equal key, one DE markup policy. Touches 2026-05 / 2026-11.
def _sound_def() -> dict:
    return {
        "name": "Authored IT Ops",
        "provider_entity_id": "1000",
        "service_line": "IT",
        "characterization": "Routine-benchmarked",
        "cost_base_definition": "Total services cost",
        "cost_capture_rule": {
            "cost_centers": ["CC-1000-IT-OPS-ERP", "CC-1000-IT-OPS-SUPPORT"],
        },
        "beneficiaries": ["3000"],
        "key": {"key_factor": "Equal"},
        "exclusions": [],
        "markup_policies": [{
            "jurisdiction": "DE", "regime": "Benchmarked",
            "markup_pct": "0.05", "benchmark_study_ref": "BM-AP-DE",
        }],
    }


@pytest.fixture()
def db(tmp_path):
    """An isolated state DB per test (authored pools live in SQLite)."""
    engine.configure(tmp_path / "state.db")
    engine.init_db()
    yield
    engine.close()


# --------------------------------------------------------------- preview tie --


def _hand_sum(predicate, source: str = "actual") -> tuple[Decimal, int]:
    """Hand-sum the cost-line subset matching a predicate over the DEMO seeds —
    the independent oracle the preview must reproduce to the cent."""
    lines = runner.load_demo_dataset()["cost_lines"][source]
    total = ZERO
    count = 0
    for line in lines:
        if predicate(line):
            total += Decimal(line["amount_local"])
            count += 1
    return total, count


def test_preview_cc_rule_ties_to_hand_summed_subset():
    rule = {"cost_centers": ["CC-1000-IT-OPS-ERP", "CC-1000-IT-OPS-SUPPORT"]}
    want, n = _hand_sum(lambda l: l["cost_center"] in rule["cost_centers"])
    prev = runner.preview_capture_rule(rule)
    assert Decimal(prev["captured_amount"]) == want
    assert prev["line_count"] == n
    assert Decimal(prev["by_entity"]["1000"]) == want  # all from provider 1000


def test_preview_pc_rule_ties_to_hand_summed_subset():
    rule = {"profit_centers": ["PC-1000-IT"]}
    want, n = _hand_sum(lambda l: l.get("profit_center") == "PC-1000-IT")
    prev = runner.preview_capture_rule(rule)
    assert Decimal(prev["captured_amount"]) == want
    assert prev["line_count"] == n
    assert n > 0


def test_preview_gl_rule_ties_to_hand_summed_subset():
    # A specific GL cost_element (the ERP application-operations payroll line).
    el = "6510-Application operations payroll"
    rule = {"cost_elements": [el]}
    want, n = _hand_sum(lambda l: l.get("cost_element") == el)
    prev = runner.preview_capture_rule(rule)
    assert Decimal(prev["captured_amount"]) == want
    assert prev["line_count"] == n
    assert n > 0


def test_preview_split_pct_scales_exactly():
    rule = {"cost_centers": ["CC-1000-IT-OPS-ERP"], "split_pct": "0.5"}
    full, _ = _hand_sum(lambda l: l["cost_center"] == "CC-1000-IT-OPS-ERP")
    prev = runner.preview_capture_rule(rule)
    assert Decimal(prev["captured_amount"]) == full * Decimal("0.5")


def test_preview_out_of_range_split_blocks_never_defaults():
    for bad in ("0", "-0.5", "1.5", "x"):
        with pytest.raises(ValueError):
            runner.preview_capture_rule(
                {"cost_centers": ["CC-1000-IT-OPS-ERP"], "split_pct": bad})


def test_preview_empty_rule_matches_nothing():
    prev = runner.preview_capture_rule({})
    assert Decimal(prev["captured_amount"]) == ZERO
    assert prev["line_count"] == 0


# ---------------------------------------------------------------- dry-run ----


def test_dry_run_sound_pool_balances_zero_residual():
    """A structurally-sound authored pool reconciles to ZERO residual (V-X1)
    across every period its capture rule touches, and prices charges."""
    dry = runner.dry_run_authored_pool(_sound_def(), pool_id="AP-SOUND")
    assert dry["periods"] == ["2026-05", "2026-11"]
    assert dry["balanced"] is True
    assert dry["exceptions"] == []
    assert dry["charges"]
    for row in dry["recon"]:
        assert row["recon_status"] == "Balanced"
        assert Decimal(row["unallocated_residual"]) == ZERO
    # pooled == exclusions + recovered (the engine invariant, exclusions = 0)
    for row in dry["recon"]:
        assert (Decimal(row["total_cost_recovered"]) + Decimal(row["total_exclusions"])
                == Decimal(row["total_pooled_cost"]))


def test_dry_run_captured_cost_equals_charged_out_cost_component():
    """The cost component charged out across the touched periods == the captured
    cost (the pool neither leaks nor invents cost)."""
    defn = _sound_def()
    dry = runner.dry_run_authored_pool(defn, pool_id="AP-TIE")
    # whole-run cost recovered == whole-run captured (no leak, no invention)
    captured_total = sum(
        (Decimal(l["amount_local"]) for l in runner.load_demo_dataset()["cost_lines"]["actual"]
         if l["cost_center"] in defn["cost_capture_rule"]["cost_centers"]), ZERO)
    recovered = sum((Decimal(r["total_cost_recovered"]) for r in dry["recon"]), ZERO)
    assert recovered == captured_total


def test_dry_run_missing_markup_policy_surfaces_v_m1_block():
    """A beneficiary jurisdiction (DE for 3000) with NO markup policy is a
    V-M1 BLOCK — a missing markup is never silently defaulted."""
    defn = _sound_def()
    defn["markup_policies"] = []
    dry = runner.dry_run_authored_pool(defn, pool_id="AP-NOMP")
    rule_ids = {e["rule_id"] for e in dry["exceptions"]}
    assert "V-M1" in rule_ids
    assert all(e["severity"] == "BLOCK"
               for e in dry["exceptions"] if e["rule_id"] == "V-M1")
    assert dry["balanced"] is False


def test_dry_run_empty_capture_rule_surfaces_block():
    defn = _sound_def()
    defn["cost_capture_rule"] = {"cost_centers": ["CC-DOES-NOT-EXIST"]}
    dry = runner.dry_run_authored_pool(defn, pool_id="AP-EMPTY")
    assert dry["periods"] == []
    assert any(e["severity"] == "BLOCK" for e in dry["exceptions"])
    assert dry["balanced"] is False


def test_dry_run_revenue_key_apportions_across_beneficiaries():
    """A Revenue key over two beneficiaries apportions by warehouse revenue and
    still ties to zero residual."""
    defn = _sound_def()
    # capture provider-3100 RSS cost centers; beneficiaries are its distributors.
    defn.update(
        provider_entity_id="3100", service_line="Finance",
        cost_capture_rule={"cost_centers": ["CC-3100-RSS-AP", "CC-3100-RSS-AR"]},
        beneficiaries=["3200", "3300", "3800"],
        key={"key_factor": "Revenue"},
        markup_policies=[
            {"jurisdiction": "FR", "regime": "Benchmarked", "markup_pct": "0.05",
             "benchmark_study_ref": "BM-FR"},
            {"jurisdiction": "GB", "regime": "Benchmarked", "markup_pct": "0.05",
             "benchmark_study_ref": "BM-GB"},
            {"jurisdiction": "NL", "regime": "Benchmarked", "markup_pct": "0.05",
             "benchmark_study_ref": "BM-NL"},
        ],
    )
    dry = runner.dry_run_authored_pool(defn, pool_id="AP-REV")
    assert dry["balanced"] is True
    assert dry["exceptions"] == []
    recipients = {c["recipient_entity_id"] for c in dry["charges"]}
    assert recipients == {"3200", "3300", "3800"}


# ---------------------------------------------------------------- lifecycle --


def test_lifecycle_draft_to_active_via_maker_checker(db):
    p = authored_pools.create_authored_pool(definition=_sound_def(), actor="maker1")
    assert p["status"] == "draft" and p["version"] == 1

    # cannot submit before a passing dry-run
    with pytest.raises(ValueError):
        authored_pools.submit_for_activation(p["id"], maker="maker1")

    res = authored_pools.test_run(p["id"], actor="maker1")
    assert res["tested"] is True
    assert authored_pools.get_authored_pool(p["id"])["status"] == "tested"

    authored_pools.submit_for_activation(p["id"], maker="maker1")
    assert authored_pools.get_authored_pool(p["id"])["status"] == "in_review"

    item = next(i for i in review.list_queue("pending")
                if i["record_ref"] == f"allocpool:{p['id']}")
    # maker cannot approve their own work (segregation of duties)
    with pytest.raises(ValueError):
        review.decide(item["id"], checker="maker1", decision="approve")

    review.decide(item["id"], checker="checker2", decision="approve")
    active = authored_pools.get_authored_pool(p["id"])
    assert active["status"] == "active"
    assert active["activated_by"] == "checker2"


def test_rejection_returns_pool_to_draft(db):
    p = authored_pools.create_authored_pool(definition=_sound_def(), actor="maker1")
    authored_pools.test_run(p["id"], actor="maker1")
    authored_pools.submit_for_activation(p["id"], maker="maker1")
    item = next(i for i in review.list_queue("pending")
                if i["record_ref"] == f"allocpool:{p['id']}")
    review.decide(item["id"], checker="checker2", decision="reject",
                  comments="needs a tighter capture rule")
    assert authored_pools.get_authored_pool(p["id"])["status"] == "draft"


def test_edit_invalidates_test_gate(db):
    p = authored_pools.create_authored_pool(definition=_sound_def(), actor="maker1")
    authored_pools.test_run(p["id"], actor="maker1")
    assert authored_pools.get_authored_pool(p["id"])["status"] == "tested"
    # a definition change returns it to draft + clears the tested hash
    new_def = {**_sound_def(), "beneficiaries": ["3000"]}
    new_def["cost_capture_rule"] = {"cost_centers": ["CC-1000-IT-OPS-ERP"]}
    edited = authored_pools.update_authored_pool(
        p["id"], actor="maker1", definition=new_def)
    assert edited["status"] == "draft"
    assert edited["tested_def_hash"] is None
    with pytest.raises(ValueError):
        authored_pools.submit_for_activation(p["id"], maker="maker1")


def test_editing_active_pool_versions_and_returns_to_draft(db):
    p = authored_pools.create_authored_pool(definition=_sound_def(), actor="maker1")
    authored_pools.test_run(p["id"], actor="maker1")
    authored_pools.submit_for_activation(p["id"], maker="maker1")
    item = next(i for i in review.list_queue("pending")
                if i["record_ref"] == f"allocpool:{p['id']}")
    review.decide(item["id"], checker="checker2", decision="approve")
    assert authored_pools.get_authored_pool(p["id"])["status"] == "active"
    edited = authored_pools.update_authored_pool(
        p["id"], actor="maker1",
        definition={**_sound_def(), "name": "Authored IT Ops v2"})
    assert edited["status"] == "draft"
    assert edited["version"] == 2


def test_create_rejects_structurally_invalid_definition(db):
    bad = _sound_def()
    del bad["provider_entity_id"]
    bad["cost_capture_rule"] = {}  # no predicate
    with pytest.raises(ValueError):
        authored_pools.create_authored_pool(definition=bad, actor="maker1")


def test_every_mutation_is_audited(db):
    import state.audit as audit
    p = authored_pools.create_authored_pool(definition=_sound_def(), actor="maker1")
    authored_pools.test_run(p["id"], actor="maker1")
    events = audit.list_events(record_ref=f"allocpool:{p['id']}")
    kinds = [e["event_type"] for e in events]
    assert "created" in kinds and "tested" in kinds


# ----------------------------------------------------------- authored run ----


def test_authored_run_balanced_and_flagged(db):
    p = authored_pools.create_authored_pool(definition=_sound_def(), actor="maker1")
    authored_pools.test_run(p["id"], actor="maker1")
    authored_pools.submit_for_activation(p["id"], maker="maker1")
    item = next(i for i in review.list_queue("pending")
                if i["record_ref"] == f"allocpool:{p['id']}")
    review.decide(item["id"], checker="checker2", decision="approve")

    run = runner.run_authored_allocation(period="2026-05", actor="ops")
    assert run["summary"]["status"] == "succeeded"
    assert run["summary"]["authored"] is True
    assert run["summary"]["recon_balanced"] is True
    assert run["summary"]["authored_pool_ids"] == [p["id"]]
    recon = store.list_recon(run_id=run["run_id"])
    assert recon and all(r["recon_status"] == "Balanced" for r in recon)


# ------------------------------------------------------------------ GOLDEN ---


def test_golden_governed_run_unchanged_by_authored_pools(db):
    """The governed demo allocation (actual, all four periods) is cent-exact:
    FY cost-recovered == warehouse SERVICE pair cost base (13,586,402.70) and
    FY gross == 14,344,773.26 — even with an ACTIVE authored pool in the same
    DB and an authored run already persisted. Authored pools never perturb the
    governed tie-out."""
    # Activate an authored pool and run it (lands rows on the SAME ledgers).
    p = authored_pools.create_authored_pool(definition=_sound_def(), actor="maker1")
    authored_pools.test_run(p["id"], actor="maker1")
    authored_pools.submit_for_activation(p["id"], maker="maker1")
    item = next(i for i in review.list_queue("pending")
                if i["record_ref"] == f"allocpool:{p['id']}")
    review.decide(item["id"], checker="checker2", decision="approve")
    runner.run_authored_allocation(period="2026-05", actor="ops")

    # Now run the GOVERNED allocation — it must tie out exactly.
    fy_cost = ZERO
    fy_gross = ZERO
    for period in PERIODS:
        res = runner.run_allocation(period=period, run_type="actual", actor="gov")
        assert res["summary"]["status"] == "succeeded"
        assert res["summary"]["recon_balanced"] is True
        assert res["exception_report"]["exceptions"] == []
        for row in store.list_charges(run_id=res["run_id"]):
            fy_cost += Decimal(row["cost_recovered_amount"])
            fy_gross += Decimal(row["gross_charge_amount"])
    assert fy_cost == Decimal("13586402.70")
    assert fy_gross == Decimal("14344773.26")
