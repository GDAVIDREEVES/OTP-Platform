"""PB1 gate — richer cost-center seed layer (Phase 6 spec §PB1).

The pure pools decompose into finer, function-realistic cost centers and the
impure corporate cost into named sub-centers (Finance/HR/Legal/Facilities/
Board); every cost line now carries cost_center + profit_center + a realistic GL
cost_element. The richer layer is a finer *decomposition of the same totals* —
the reconciliation contracts are unchanged, to the cent.

Asserts (spec §PB1):
1. every existing allocation tie-out still green — Stages 1-6 over the seeds for
   all four periods produce ZERO exceptions / zero blocked pools, and the FY
   Σ cost_recovered / Σ gross_charge per pair tie to the warehouse SERVICE pairs
   to the cent (the M4/M6 reconciliation assertions, re-run here);
2. the richer-CC cost lines per (provider, pool, period) sum to the prior totals
   to the cent — the chargeable pool base ties to the warehouse pair cost base,
   and per provider the FY Σ cost lines == warehouse cb + stewardship register;
3. every cost line carries cost_center + profit_center + cost_element;
4. cc_mapping allocation_split_pct sums to 1.0 per cost center (V-P2).

NO float arithmetic on amounts anywhere in this file (ENGINE-CLAUDE.md).

Run from backend/:  ../.venv/bin/python -m pytest tests/allocation/test_pb1_richer_ccs.py
"""

from __future__ import annotations

import json
from collections import defaultdict
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
from config import SUPPLY_CHAIN

BACKEND = Path(__file__).resolve().parents[2]
SEED_DIR = BACKEND / "seeds" / "allocation"
CENT = Decimal("0.01")
ZERO = Decimal("0")

# The four actual SERVICE billing periods, per provider (matches the seeds).
PROVIDER_PERIODS = {
    "1000": ("2026-05", "2026-11"),
    "3100": ("2026-04", "2026-10"),
}
SERVICE_POOLS = {"1000": "POOL-IT-US", "3100": "POOL-RSS-CH"}
STEWARDSHIP = {"1000": Decimal("4250000.00"), "3100": Decimal("2700000.00")}


def _seed_doc(fname: str) -> dict:
    return json.loads((SEED_DIR / fname).read_text(encoding="utf-8"))


def _is_corp(cost_center: str) -> bool:
    """A corporate sub-center (CC-{prov}-CORP-FIN/HR/LEGAL/FAC/BOARD)."""
    return "-CORP" in cost_center


# ----------------------------------------------------------------- warehouse --


def _warehouse_pairs():
    """Per-period and FY cost base / gross from the warehouse SERVICE pairs."""
    con = duckdb.connect()
    rows = con.execute(
        f"""
        SELECT SELLING_COMPANY, BUYING_COMPANY, GJAHR, POPER,
               SUM(STANDARD_COST * TOTAL_VOLUME) AS cb,
               SUM(TOTAL_LEGAL_PRICE)            AS gross
        FROM read_parquet('{SUPPLY_CHAIN}')
        WHERE MATERIAL_TYPE = 'SERVICE'
        GROUP BY 1, 2, 3, 4
        """
    ).fetchall()
    con.close()
    cb_period: dict[tuple[str, str], Decimal] = defaultdict(lambda: ZERO)
    cb_fy: dict[tuple[str, str], Decimal] = defaultdict(lambda: ZERO)
    gross_fy: dict[tuple[str, str], Decimal] = defaultdict(lambda: ZERO)
    for prov, rec, gjahr, poper, cb, gross in rows:
        assert isinstance(cb, Decimal) and isinstance(gross, Decimal)  # no floats
        period = f"{gjahr}-{int(poper):02d}"
        cb_period[(prov, period)] += cb
        cb_fy[(prov, rec)] += cb
        gross_fy[(prov, rec)] += gross
    return dict(cb_period), dict(cb_fy), dict(gross_fy)


# ----------------------------------------------------- (3) every line dimensioned --


def test_every_cost_line_has_cost_center_profit_center_cost_element():
    """PB1 (3): every cost line carries cost_center + profit_center +
    cost_element (the dimensions a pool can be built on)."""
    doc = _seed_doc("cost_lines.v1.json")
    lines = doc["actual"] + doc["budget"]
    assert lines  # non-empty
    for r in lines:
        for dim in ("cost_center", "profit_center", "cost_element"):
            assert str(r.get(dim) or "").strip(), (r["cost_line_id"], dim)


def test_richer_cost_centers_are_present():
    """The finer, function-realistic cost centers replaced the coarse ones."""
    doc = _seed_doc("cost_lines.v1.json")
    ccs = {r["cost_center"] for r in doc["actual"]}
    expected = {
        "CC-1000-IT-OPS-ERP", "CC-1000-IT-OPS-SUPPORT", "CC-1000-IT-HOST-CLOUD",
        "CC-1000-IT-HOST-COLO", "CC-1000-IT-NET-MPLS", "CC-1000-IT-NET-INET",
        "CC-3100-RSS-AP", "CC-3100-RSS-AR", "CC-3100-RSS-PAYROLL",
        "CC-3100-RSS-SYS-ERP", "CC-3100-RSS-SYS-BI",
        "CC-1000-CORP-FIN", "CC-1000-CORP-HR", "CC-1000-CORP-LEGAL",
        "CC-1000-CORP-FAC", "CC-1000-CORP-BOARD",
        "CC-3100-CORP-FIN", "CC-3100-CORP-HR", "CC-3100-CORP-LEGAL",
        "CC-3100-CORP-FAC", "CC-3100-CORP-BOARD",
    }
    assert ccs == expected


# ------------------------------------------------- (4) cc_mapping V-P2 splits --


def test_cc_mapping_splits_sum_to_100_per_cost_center():
    """PB1 (4): allocation_split_pct sums to exactly 1.0 per cost center (V-P2),
    each split positive."""
    rows = _seed_doc("cc_mapping.v1.json")["rows"]
    by_cc: dict[tuple[str, str], list[Decimal]] = defaultdict(list)
    for m in rows:
        by_cc[(m["company_code"], m["cost_center"])].append(
            Decimal(m["allocation_split_pct"]))
    assert by_cc  # non-empty
    for cc, pcts in by_cc.items():
        assert all(p > ZERO for p in pcts), cc
        assert sum(pcts, ZERO) == Decimal("1"), (cc, [str(p) for p in pcts])
    # the corporate sub-centers split 20/80; the pure cost centers are single-row 100%
    corp = [cc for cc in by_cc if _is_corp(cc[1])]
    assert corp  # at least the 5 sub-centers per provider
    for cc in corp:
        assert sorted(by_cc[cc]) == [Decimal("0.2"), Decimal("0.8")], cc


# ---------------------------------- (2) richer CCs sum to the prior totals --


def test_richer_cost_lines_sum_to_prior_totals_to_the_cent():
    """PB1 (2): the finer cost lines per (provider, pool, period) sum to the
    same chargeable pool base as before — pure lines + 20% of the corporate
    sub-centers == the warehouse pair cost base for the period, to the cent;
    and per provider the FY Σ cost lines == warehouse cb + stewardship."""
    cb_period, cb_fy, _gross_fy = _warehouse_pairs()
    doc = _seed_doc("cost_lines.v1.json")

    # per-provider FY total == warehouse cb + stewardship register (the prior
    # provider total, e.g. 1000: 6,793,200.00 + 4,250,000.00)
    for provider in PROVIDER_PERIODS:
        seeded = sum(
            (Decimal(r["amount_local"]) for r in doc["actual"]
             if r["provider_entity_id"] == provider),
            ZERO,
        )
        wh_cb = sum((v for (p, _r), v in cb_fy.items() if p == provider), ZERO)
        assert seeded == wh_cb + STEWARDSHIP[provider], provider

    # per (provider, period): pure pool lines + 20% of the corporate sub-centers
    # == the warehouse pair cost base (the chargeable pool base, unchanged)
    for provider, periods in PROVIDER_PERIODS.items():
        for period in periods:
            pure = sum(
                (Decimal(r["amount_local"]) for r in doc["actual"]
                 if r["provider_entity_id"] == provider
                 and r["fiscal_period"] == period
                 and not _is_corp(r["cost_center"])),
                ZERO,
            )
            corp_svc = sum(
                (Decimal(r["amount_local"]) * Decimal("0.2") for r in doc["actual"]
                 if r["provider_entity_id"] == provider
                 and r["fiscal_period"] == period
                 and _is_corp(r["cost_center"])),
                ZERO,
            )
            # corp service slice is cent-exact per line (nickel-grain split)
            assert corp_svc == corp_svc.quantize(CENT)
            assert pure + corp_svc == cb_period[(provider, period)], (provider, period)


# ------------------------ (1) every existing tie-out still green (M4/M6 re-run) --


@pytest.fixture(scope="module")
def demo_runs():
    """Stages 1-6 over the richer actual seeds for all four periods — ZERO
    exceptions, zero blocked pools (the M4 demo pipeline, ADAPTATION D5)."""
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
                {"classified_lines": s1["outputs"]["classified_lines"]}, ref, config)
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
            runs.append({"provider": provider, "period": period, "s3": s3, "s6": s6})
    return runs


def test_pb1_fy_pair_cost_and_gross_tie_to_warehouse_to_the_cent(demo_runs):
    """PB1 (1): with the richer cost centers the FY Σ cost_recovered / Σ
    gross_charge per (provider, recipient) still tie to the warehouse SERVICE
    pairs to the cent (the M4 demo reconciliation gate, unchanged)."""
    _cb_period, cb_fy, gross_fy = _warehouse_pairs()
    fy_cost: dict[tuple[str, str], Decimal] = defaultdict(lambda: ZERO)
    fy_gross: dict[tuple[str, str], Decimal] = defaultdict(lambda: ZERO)
    for run in demo_runs:
        provider = run["provider"]
        rows = run["s6"]["outputs"]["charges"]
        # the management pools are 100% excluded -> only the service pool charges
        assert all(r["pool_id"] == SERVICE_POOLS[provider] for r in rows)
        for r in rows:
            cost = Decimal(r["cost_recovered_amount"])
            gross = Decimal(r["gross_charge_amount"])
            assert cost + Decimal(r["markup_amount"]) == gross  # schema identity
            key = (provider, r["recipient_entity_id"])
            fy_cost[key] += cost
            fy_gross[key] += gross
    assert dict(fy_cost) == cb_fy
    assert dict(fy_gross) == gross_fy
    assert set(fy_cost) == {("1000", "3000"), ("3100", "3200"),
                            ("3100", "3300"), ("3100", "3800")}


def test_pb1_exclusions_still_tie_to_the_stewardship_register(demo_runs):
    """PB1 (1): Stage-3 exclusions across the FY still == 6,950,000.00 split
    4,250,000.00 (1000) / 2,700,000.00 (3100) — the corporate decomposition did
    not disturb the management pool / stewardship carve-out, to the cent."""
    by_provider: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for run in demo_runs:
        for pool in run["s3"]["outputs"]["pools"]:
            by_provider[run["provider"]] += Decimal(pool["total_exclusions"])
    assert dict(by_provider) == {"1000": Decimal("4250000.00"),
                                 "3100": Decimal("2700000.00")}
