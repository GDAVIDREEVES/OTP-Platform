"""Allocation-engine demo dataset generator (ADAPTATION D2 — reconciled by construction).

Derives the committed seed set FROM the warehouse at authoring time, CbCR-style,
so the engine's outputs tie to the demo's real numbers to the cent:

- ``data/parquet/supply_chain_flows`` SERVICE rows, grouped by
  (SELLING_COMPANY, BUYING_COMPANY, POPER): cost base = Σ STANDARD_COST×TOTAL_VOLUME,
  gross = Σ TOTAL_LEGAL_PRICE. Providers 1000 (US) + 3100 (CH RHQ); recipients
  per the actual pairs (1000→3000; 3100→3200/3300/3800); periods = the four
  actual SERVICE billing periods of FY2026.
- ``seeds/finance/stewardship.v1.json`` flagged lines = fixed Stage-3 exclusions
  (1000: $4,250,000; 3100: $2,700,000), split evenly across the provider's two
  billing periods, rationale carried over.

Exact contracts (asserted here AND in tests/allocation/test_m1_roundtrip.py):
- Σ cost_lines per provider == warehouse FY pair cost base + stewardship
  exclusions, to the cent;
- per (provider, period): chargeable pool base == Σ pair cost base;
- benchmarked markup rates == pair-effective FY rates (gross/cb − 1, full
  Decimal precision);
- budget variants diverge on the chargeable base by 8% (POOL-IT-US) and 15%
  (POOL-RSS-CH) for the true-up demo (SPEC §9.2 style); management pools and
  exclusions are unchanged so budget runs still reconcile to zero residual.

Pools (SPEC §3.3 keeps one provider per pool — V-P5 — so the management pool is
modelled per provider): POOL-IT-US (1000, benchmarked) · POOL-RSS-CH (3100,
benchmarked) · POOL-MGMT-US / POOL-MGMT-CH (stewardship-heavy management cost,
fed 80/20 by each provider's corporate cost center via cc_mapping splits,
LVAIGS 5% where charged). See docs/allocation/DECISIONS.md.

All money is Decimal (precision 28); amounts are emitted as exact decimal
STRINGS. Cent-grain splits use the largest-remainder method (ascending-index
tie-break) so every level sums exactly.

Run from backend/:  ../.venv/bin/python seeds/allocation/generate_seeds.py
"""

from __future__ import annotations

import calendar
import json
import sys
from decimal import ROUND_DOWN, ROUND_HALF_EVEN, Decimal, getcontext
from pathlib import Path
from typing import Any

_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import duckdb  # noqa: E402

from allocation import validation  # noqa: E402
from config import SUPPLY_CHAIN  # noqa: E402

getcontext().prec = 28  # ENGINE-CLAUDE.md: Decimal precision 28, HALF_EVEN

OUT_DIR = Path(__file__).resolve().parent
STEWARDSHIP_PATH = _BACKEND / "seeds" / "finance" / "stewardship.v1.json"

CENT = Decimal("0.01")
ONE = Decimal("1")
HALF = Decimal("0.5")

# ---------------------------------------------------------------- design ----

PROVIDERS = ("1000", "3100")

# Legal-entity dressing over the warehouse company codes (roles/jurisdictions
# are asserted against entity_roles-style facts carried by the SERVICE rows).
# Providers book in USD (group reporting currency — the warehouse cost base the
# seeds tie to is USD); recipient functional currencies are realistic.
ENTITY_INFO: dict[str, dict[str, Any]] = {
    "1000": {"name": "US IP Principal Inc.", "currency": "USD", "tier": 1, "parent": None},
    "3100": {"name": "CH Regional Headquarters AG", "currency": "USD", "tier": 1, "parent": "1000"},
    "3000": {"name": "DE Full-Risk Manufacturer GmbH", "currency": "EUR", "tier": 2, "parent": "1000"},
    "3200": {"name": "FR Limited-Risk Distributor SARL", "currency": "EUR", "tier": 2, "parent": "3100"},
    "3300": {"name": "GB Limited-Risk Distributor Ltd", "currency": "GBP", "tier": 2, "parent": "3100"},
    "3800": {"name": "NL Limited-Risk Distributor BV", "currency": "EUR", "tier": 2, "parent": "3100"},
}

# Service pools: one per provider (V-P5 single provider per pool), plus a
# management pool per provider holding the stewardship-heavy corporate cost.
#
# PB1 — richer cost-center layer: each pure pool decomposes into finer,
# function-realistic cost centers (PB1 spec) — every cost center carries a
# realistic GL cost_element and an enum-valid cost_nature, with weights summing
# to 1.0 so largest_remainder preserves the per-pool/per-period totals exactly.
SERVICE_POOLS: dict[str, dict[str, Any]] = {
    "POOL-IT-US": {
        "provider": "1000",
        "name": "Global IT Infrastructure & Applications",
        "service_line": "IT",
        "description": "Hosting, network, ERP/application operations and end-user support delivered group-wide from the US parent.",
        "key_id": "KEY-IT-CONS",
        "profit_center": "PC-1000-IT",  # entity+function profit center for the pool's cost centers
        # (cost_center, cost_element, cost_nature, weight) — weights sum to 1.
        "pure_ccs": (
            ("CC-1000-IT-OPS-ERP", "6510-Application operations payroll", "Payroll", Decimal("0.22")),
            ("CC-1000-IT-OPS-SUPPORT", "6520-End-user support payroll", "Payroll", Decimal("0.18")),
            ("CC-1000-IT-HOST-CLOUD", "6620-Cloud & hosting", "Software", Decimal("0.20")),
            ("CC-1000-IT-HOST-COLO", "6625-Data-centre colocation", "Facilities", Decimal("0.12")),
            ("CC-1000-IT-NET-MPLS", "6710-Network & MPLS circuits", "Third-party fee", Decimal("0.16")),
            ("CC-1000-IT-NET-INET", "6720-Internet & SD-WAN", "Third-party fee", Decimal("0.12")),
        ),
        "budget_factor": Decimal("0.92"),  # actuals overrun budget by ~8% (< warn threshold)
    },
    "POOL-RSS-CH": {
        "provider": "3100",
        "name": "Regional Shared Services (EMEA)",
        "service_line": "Finance",
        "description": "Accounts payable/receivable, statutory bookkeeping and finance systems run for the EMEA distributors from the Swiss RHQ.",
        "key_id": "KEY-RSS-CONS",
        "profit_center": "PC-3100-RSS",
        "pure_ccs": (
            ("CC-3100-RSS-AP", "6500-Accounts-payable payroll", "Payroll", Decimal("0.26")),
            ("CC-3100-RSS-AR", "6505-Accounts-receivable payroll", "Payroll", Decimal("0.24")),
            ("CC-3100-RSS-PAYROLL", "6515-Payroll-services payroll", "Payroll", Decimal("0.18")),
            ("CC-3100-RSS-SYS-ERP", "6630-ERP licences", "Software", Decimal("0.20")),
            ("CC-3100-RSS-SYS-BI", "6640-BI & reporting licences", "Software", Decimal("0.12")),
        ),
        "budget_factor": Decimal("0.85"),  # actuals overrun budget by ~15% (> warn threshold → V-X3)
    },
}

MGMT_POOLS = {"1000": "POOL-MGMT-US", "3100": "POOL-MGMT-CH"}
MGMT_POOL_NAMES = {
    "POOL-MGMT-US": "Group Management & Corporate (US)",
    "POOL-MGMT-CH": "Group Management & Corporate (CH)",
}
# The corporate cost is impure: 80% group management/stewardship (to the
# management pool), 20% chargeable management of the service-delivery org (to
# the provider's service pool). 80/20 keeps every derived amount cent-exact.
CORP_SPLIT_MGMT = Decimal("0.8")
CORP_SPLIT_SVC = Decimal("0.2")

# PB1 — decompose the impure corporate center into named sub-centers
# (Finance / HR / Legal / Facilities / Board) per provider. Each sub-center is
# still split 80/20 mgmt/service via cc_mapping (so every sub-center keeps the
# same impurity as the old single CORP center). Weights sum to 1.0 of the
# corporate amount; they are NICKEL-grain split (see corp_subcenter_amounts) so
# each sub-center amount x has cent-exact x*0.2 and x*0.8 — Stage 1's split then
# introduces no rounding drift and the per-period pool totals stay byte-identical.
# (cost_center_suffix, label, cost_element, cost_nature, weight).
CORP_SUBCENTERS = (
    ("CORP-FIN", "Group Finance", "6410-Group finance & treasury", "Payroll", Decimal("0.30")),
    ("CORP-HR", "Group HR", "6420-Group human resources", "Payroll", Decimal("0.20")),
    ("CORP-LEGAL", "Group Legal", "6430-Group legal & compliance", "Third-party fee", Decimal("0.20")),
    ("CORP-FAC", "Corporate Facilities", "6440-Corporate facilities & occupancy", "Facilities", Decimal("0.20")),
    ("CORP-BOARD", "Board & Governance", "6450-Board, governance & corporate affairs", "Other", Decimal("0.10")),
)


def corp_cc(provider: str, suffix: str) -> str:
    """Fully-qualified corporate sub-center id, e.g. CC-1000-CORP-FIN."""
    return f"CC-{provider}-{suffix}"


def corp_pc(provider: str) -> str:
    """Corporate profit center for the provider (entity + Corporate function)."""
    return f"PC-{provider}-CORP"

KEY_DEFS = (
    {
        "key_id": "KEY-IT-CONS",
        "key_name": "IT consumption units per entity",
        "key_factor": "Transactions",
        "source_system": "Warehouse supply_chain (SERVICE billing extract)",
        "static_or_dynamic": "Dynamic",
        "recompute_frequency": "Monthly",
        "description": "Metered IT consumption units per beneficiary; tracks the support and hosting effort each entity actually draws.",
        "owner": "TP Ops Lead",
    },
    {
        "key_id": "KEY-RSS-CONS",
        "key_name": "Shared-services transaction volume per entity",
        "key_factor": "Transactions",
        "source_system": "Warehouse supply_chain (SERVICE billing extract)",
        "static_or_dynamic": "Dynamic",
        "recompute_frequency": "Monthly",
        "description": "Processed AP/AR transaction volume per beneficiary; proxies the benefit each distributor derives from the shared-service center.",
        "owner": "TP Ops Lead",
    },
    {
        "key_id": "KEY-MGMT-HC",
        "key_name": "Headcount per entity",
        "key_factor": "Headcount",
        "source_system": "HR master",
        "static_or_dynamic": "Static",
        "description": "Annual headcount; default key for the management pools (fully stewardship-excluded in this dataset, so it never apportions).",
        "owner": "TP Ops Lead",
    },
)

FY = "2026"
EFFECTIVE_FROM = "2026-01-01"
EFFECTIVE_TO = "2026-12-31"


# ---------------------------------------------------------------- helpers ----


def fmt2(d: Decimal) -> str:
    """Exact cent string ("1234.50"). Asserts the value IS cent-grain."""
    q = d.quantize(CENT, rounding=ROUND_HALF_EVEN)
    assert q == d, f"not cent-exact: {d}"
    return str(q)


def largest_remainder(total: Decimal, weights: list[Decimal]) -> list[Decimal]:
    """Split ``total`` (cent-grain) by ``weights`` (sum 1) summing EXACTLY.

    SPEC §5.1: floor to the minor unit, then hand the residual out one cent at
    a time in descending remainder order, tie-break ascending index.
    """
    assert sum(weights) == ONE, f"weights must sum to 1: {weights}"
    assert total == total.quantize(CENT), f"total must be cent-grain: {total}"
    raw = [total * w for w in weights]
    floors = [r.quantize(CENT, rounding=ROUND_DOWN) for r in raw]
    residual = total - sum(floors)
    n_cents = int((residual / CENT).to_integral_value())
    assert n_cents >= 0
    order = sorted(range(len(raw)), key=lambda i: (-(raw[i] - floors[i]), i))
    for k in range(n_cents):
        floors[order[k % len(order)]] += CENT
    assert sum(floors) == total
    return floors


NICKEL = Decimal("0.05")


def largest_remainder_grain(total: Decimal, weights: list[Decimal], grain: Decimal) -> list[Decimal]:
    """Split ``total`` (a multiple of ``grain``) by ``weights`` (sum 1), each
    part a multiple of ``grain``, summing EXACTLY to ``total``.

    Generalises ``largest_remainder`` to an arbitrary minor unit. Used for the
    corporate sub-center decomposition at NICKEL grain so each sub-center
    amount x keeps both x*0.2 and x*0.8 cent-exact (no Stage-1 rounding drift).
    """
    assert sum(weights) == ONE, f"weights must sum to 1: {weights}"
    assert total == (total / grain).to_integral_value() * grain, (
        f"total must be {grain}-grain: {total}")
    raw = [total * w for w in weights]
    floors = [(r / grain).to_integral_value(rounding=ROUND_DOWN) * grain for r in raw]
    residual = total - sum(floors)
    n_units = int((residual / grain).to_integral_value())
    assert n_units >= 0
    order = sorted(range(len(raw)), key=lambda i: (-(raw[i] - floors[i]), i))
    for k in range(n_units):
        floors[order[k % len(order)]] += grain
    assert sum(floors) == total
    return floors


def month_end(period: str) -> str:
    y, m = int(period[:4]), int(period[5:7])
    return f"{y:04d}-{m:02d}-{calendar.monthrange(y, m)[1]:02d}"


def month_start(period: str) -> str:
    return f"{period}-01"


# ------------------------------------------------------------- warehouse ----


def load_warehouse() -> dict[str, Any]:
    """SERVICE pair facts: cb/gross per (provider, recipient, period) + FY."""
    con = duckdb.connect()
    rows = con.execute(
        f"""
        SELECT SELLING_COMPANY AS provider, BUYING_COMPANY AS recipient,
               GJAHR, POPER,
               SUM(STANDARD_COST * TOTAL_VOLUME) AS cb,
               SUM(TOTAL_LEGAL_PRICE)            AS gross,
               MAX(SELLER_LAND1) AS seller_land, MAX(BUYER_LAND1) AS buyer_land
        FROM read_parquet('{SUPPLY_CHAIN}')
        WHERE MATERIAL_TYPE = 'SERVICE'
        GROUP BY 1, 2, 3, 4
        ORDER BY 1, 2, 4
        """
    ).fetchall()
    con.close()
    cb: dict[tuple[str, str, str], Decimal] = {}
    gross: dict[tuple[str, str, str], Decimal] = {}
    jurisdiction: dict[str, str] = {}
    periods: dict[str, list[str]] = {}
    recipients: dict[str, list[str]] = {}
    for provider, recipient, gjahr, poper, cb_v, gross_v, seller_land, buyer_land in rows:
        assert str(gjahr) == FY, f"unexpected fiscal year {gjahr}"
        assert isinstance(cb_v, Decimal) and isinstance(gross_v, Decimal)  # no floats
        period = f"{gjahr}-{int(poper):02d}"
        cb[(provider, recipient, period)] = cb_v
        gross[(provider, recipient, period)] = gross_v
        jurisdiction.setdefault(provider, seller_land)
        jurisdiction.setdefault(recipient, buyer_land)
        if period not in periods.setdefault(provider, []):
            periods[provider].append(period)
        if recipient not in recipients.setdefault(provider, []):
            recipients[provider].append(recipient)
    for p in periods.values():
        p.sort()
    for r in recipients.values():
        r.sort()
    assert sorted(periods) == sorted(PROVIDERS), f"unexpected providers: {sorted(periods)}"
    return {
        "cb": cb,
        "gross": gross,
        "jurisdiction": jurisdiction,
        "periods": periods,
        "recipients": recipients,
    }


def load_stewardship() -> dict[str, list[dict[str, Any]]]:
    """Flagged (stewardship == true) register lines per provider, in id order."""
    doc = json.loads(STEWARDSHIP_PATH.read_text(encoding="utf-8"))
    flagged: dict[str, list[dict[str, Any]]] = {p: [] for p in PROVIDERS}
    for line in doc["lines"]:
        if line["stewardship"]:
            flagged[line["rbukrs"]].append(line)
    return flagged


# -------------------------------------------------------------- documents ----


def _order_fields(sheet: str, row: dict[str, Any]) -> dict[str, Any]:
    """Emit row keys in schema field order (and only schema keys)."""
    from allocation.generated import types as gen

    order = gen.ENTITIES[sheet]["field_order"]
    unknown = set(row) - set(order)
    assert not unknown, f"{sheet}: unknown fields {unknown}"
    return {k: row[k] for k in order if k in row}


def build_documents() -> dict[str, dict[str, Any]]:
    wh = load_warehouse()
    flagged = load_stewardship()
    cb, gross = wh["cb"], wh["gross"]
    periods, recipients, jur = wh["periods"], wh["recipients"], wh["jurisdiction"]

    # Per-provider/period chargeable cost base (Σ pair cb) and FY aggregates.
    cb_period: dict[tuple[str, str], Decimal] = {}
    for (prov, rec, per), v in cb.items():
        cb_period[(prov, per)] = cb_period.get((prov, per), Decimal(0)) + v
    cb_fy_pair: dict[tuple[str, str], Decimal] = {}
    gross_fy_pair: dict[tuple[str, str], Decimal] = {}
    for (prov, rec, per), v in cb.items():
        cb_fy_pair[(prov, rec)] = cb_fy_pair.get((prov, rec), Decimal(0)) + v
        gross_fy_pair[(prov, rec)] = gross_fy_pair.get((prov, rec), Decimal(0)) + gross[(prov, rec, per)]

    # Stewardship exclusions: each flagged line split evenly (largest-remainder)
    # across the provider's two billing periods.
    excl_split: dict[str, dict[str, list[tuple[dict[str, Any], Decimal]]]] = {}
    mgmt_period_total: dict[tuple[str, str], Decimal] = {}
    for prov in PROVIDERS:
        per_list = periods[prov]
        excl_split[prov] = {per: [] for per in per_list}
        for line in flagged[prov]:
            amount = Decimal(str(line["amount"]))
            parts = largest_remainder(amount, [HALF, HALF])
            for per, part in zip(per_list, parts):
                excl_split[prov][per].append((line, part))
                mgmt_period_total[(prov, per)] = mgmt_period_total.get((prov, per), Decimal(0)) + part

    # ---- 8_Entity -----------------------------------------------------------
    entities = []
    for eid in sorted(ENTITY_INFO):
        info = ENTITY_INFO[eid]
        row: dict[str, Any] = {
            "entity_id": eid,
            "legal_entity_name": info["name"],
            "company_code": eid,
            "jurisdiction": jur[eid],
            "functional_currency": info["currency"],
            "entity_role": "Provider" if eid in PROVIDERS else "Recipient",
            "tier": info["tier"],
            "effective_from": EFFECTIVE_FROM,
            "status": "Active",
        }
        if info["parent"]:
            row["parent_entity_id"] = info["parent"]
        entities.append(_order_fields("8_Entity", row))

    # ---- 3_Pool --------------------------------------------------------------
    pools = []
    for pool_id, p in SERVICE_POOLS.items():
        pools.append(_order_fields("3_Pool", {
            "pool_id": pool_id,
            "pool_name": p["name"],
            "service_line": p["service_line"],
            "service_description": p["description"],
            "provider_entity_id": p["provider"],
            "characterization": "Routine-benchmarked",
            "core_or_support": "Support",
            "unique_intangible_flag": False,
            "significant_risk_flag": False,
            "cost_base_definition": "Total services cost",
            "default_key_id": p["key_id"],
            "direct_charge_flag": False,
            "documentation_ref": f"DOC/TP/{pool_id}-{FY}",
            "effective_from": EFFECTIVE_FROM,
            "status": "Active",
        }))
    for prov in PROVIDERS:
        pool_id = MGMT_POOLS[prov]
        pools.append(_order_fields("3_Pool", {
            "pool_id": pool_id,
            "pool_name": MGMT_POOL_NAMES[pool_id],
            "service_line": "Management",
            "service_description": "Group management, corporate governance and oversight performed by the parent/RHQ; predominantly shareholder activity (OECD TPG 7.9-7.10), fully stewardship-excluded in this dataset.",
            "provider_entity_id": prov,
            "characterization": "LVAIGS",
            "core_or_support": "Support",
            "unique_intangible_flag": False,
            "significant_risk_flag": False,
            "cost_base_definition": "Total services cost",
            "default_key_id": "KEY-MGMT-HC",
            "direct_charge_flag": False,
            "documentation_ref": f"DOC/TP/{pool_id}-{FY}",
            "effective_from": EFFECTIVE_FROM,
            "status": "Active",
        }))
    pools.sort(key=lambda r: r["pool_id"])

    # ---- 2_CCMapping ----------------------------------------------------------
    cc_mapping = []

    def mapping_row(company: str, cc: str, pool_id: str, function: str,
                    split: Decimal, rationale: str) -> dict[str, Any]:
        return _order_fields("2_CCMapping", {
            "mapping_id": f"MAP-{cc}-{pool_id}",
            "company_code": company,
            "cost_center": cc,
            "service_line_id": pool_id,
            "function": function,
            "allocation_split_pct": str(split),
            "effective_from": EFFECTIVE_FROM,
            "effective_to": EFFECTIVE_TO,
            "version": 1,
            "owner": "TP Ops Lead",
            "rationale": rationale,
        })

    for pool_id, p in SERVICE_POOLS.items():
        for cc, _elem, _nature, _w in p["pure_ccs"]:
            cc_mapping.append(mapping_row(
                p["provider"], cc, pool_id, p["service_line"], ONE,
                f"Dedicated {p['service_line']} cost center; serves the {p['name']} pool only.",
            ))
    for prov in PROVIDERS:
        svc_pool = next(pid for pid, p in SERVICE_POOLS.items() if p["provider"] == prov)
        for suffix, label, _elem, _nature, _w in CORP_SUBCENTERS:
            cc = corp_cc(prov, suffix)
            cc_mapping.append(mapping_row(
                prov, cc, svc_pool, SERVICE_POOLS[svc_pool]["service_line"], CORP_SPLIT_SVC,
                f"Impure corporate sub-center ({label}): time study attributes 20% to "
                "chargeable management of the service-delivery organisation.",
            ))
            cc_mapping.append(mapping_row(
                prov, cc, MGMT_POOLS[prov], "Management", CORP_SPLIT_MGMT,
                f"Impure corporate sub-center ({label}): 80% group management/stewardship "
                "(shareholder activity, OECD TPG 7.9-7.10).",
            ))
    cc_mapping.sort(key=lambda r: r["mapping_id"])

    # ---- 4_MarkupPolicy -------------------------------------------------------
    # Benchmarked rates = pair-effective FY rates from the warehouse:
    # gross/cb - 1, full Decimal precision (ADAPTATION D2).
    markup_policies = []
    for pool_id, p in SERVICE_POOLS.items():
        prov = p["provider"]
        for rec in recipients[prov]:
            j = jur[rec]
            rate = gross_fy_pair[(prov, rec)] / cb_fy_pair[(prov, rec)] - ONE
            markup_policies.append(_order_fields("4_MarkupPolicy", {
                "markup_policy_id": f"MP-{pool_id}-{j}",
                "pool_id": pool_id,
                "jurisdiction": j,
                "regime": "Benchmarked",
                "markup_pct": str(rate),
                "scm_eligibility_basis": "n/a",
                "benchmark_study_ref": f"BM-{pool_id}-{FY}-{j}",
                "effective_from": EFFECTIVE_FROM,
                "effective_to": EFFECTIVE_TO,
            }))
    for prov in PROVIDERS:
        pool_id = MGMT_POOLS[prov]
        for rec in recipients[prov]:
            j = jur[rec]
            markup_policies.append(_order_fields("4_MarkupPolicy", {
                "markup_policy_id": f"MP-{pool_id}-{j}",
                "pool_id": pool_id,
                "jurisdiction": j,
                "regime": "LVAIGS (5%)",
                "markup_pct": "0.05",
                "scm_eligibility_basis": "n/a",
                "effective_from": EFFECTIVE_FROM,
                "effective_to": EFFECTIVE_TO,
            }))
    markup_policies.sort(key=lambda r: r["markup_policy_id"])

    # ---- 5_Exclusions ----------------------------------------------------------
    exclusions = []
    for prov in PROVIDERS:
        for per in periods[prov]:
            for line, part in excl_split[prov][per]:
                exclusions.append(_order_fields("5_Exclusions", {
                    "exclusion_id": f"EX-{line['id']}-{per}",
                    "pool_id": MGMT_POOLS[prov],
                    "exclusion_type": "Stewardship",
                    "exclusion_amount": fmt2(part),
                    "basis_rationale": f"[OTP-15 {line['id']} — {line['category']}] {line['rationale']}",
                    "effective_from": month_start(per),
                    "effective_to": month_end(per),
                    "owner": "TP Manager",
                }))
    exclusions.sort(key=lambda r: r["exclusion_id"])

    # ---- 6_KeyDef ---------------------------------------------------------------
    key_defs = [_order_fields("6_KeyDef", dict(k)) for k in KEY_DEFS]

    # ---- 9_Participation --------------------------------------------------------
    # Beneficiary populations per pool = the provider's actual SERVICE pair
    # recipients (Stage 4 resolves its denominator from these rows — V-K1);
    # one Provider row per pool completes the associative entity. The fully
    # excluded management pools carry the same populations ("LVAIGS where
    # charged", DECISIONS.md M1 #2): their zero chargeable base means Stage 4
    # never apportions them.
    participation = []
    benefit_rationale = {
        "POOL-IT-US": "Consumes hosted ERP/applications, network and end-user support delivered group-wide from the US parent.",
        "POOL-RSS-CH": "AP/AR processing, statutory bookkeeping and finance systems run for the distributor by the Swiss RHQ shared-service center.",
        "POOL-MGMT-US": "In scope for chargeable group management where performed (LVAIGS); the seeded stewardship carve-out currently excludes the full pool.",
        "POOL-MGMT-CH": "In scope for chargeable regional management where performed (LVAIGS); the seeded stewardship carve-out currently excludes the full pool.",
    }
    for pool_row in pools:
        pool_id = pool_row["pool_id"]
        prov = pool_row["provider_entity_id"]
        participation.append(_order_fields("9_Participation", {
            "participation_id": f"PP-{pool_id}-{prov}",
            "pool_id": pool_id,
            "entity_id": prov,
            "role": "Provider",
            "effective_from": EFFECTIVE_FROM,
        }))
        for rec in recipients[prov]:
            participation.append(_order_fields("9_Participation", {
                "participation_id": f"PP-{pool_id}-{rec}",
                "pool_id": pool_id,
                "entity_id": rec,
                "role": "Beneficiary",
                "benefit_rationale": benefit_rationale[pool_id],
                "effective_from": EFFECTIVE_FROM,
            }))
    participation.sort(key=lambda r: r["participation_id"])

    # ---- 7_KeyValue -------------------------------------------------------------
    # Consumption units proportional to pair cost base per period (cb / 1000).
    def key_value_rows(prefix: str) -> list[dict[str, Any]]:
        rows = []
        for pool_id, p in SERVICE_POOLS.items():
            prov = p["provider"]
            for per in periods[prov]:
                factors = {rec: cb[(prov, rec, per)] / Decimal(1000) for rec in recipients[prov]}
                total = sum(factors.values())
                for rec in recipients[prov]:
                    rows.append(_order_fields("7_KeyValue", {
                        "key_value_id": f"{prefix}-{pool_id}-{rec}-{per}",
                        "key_id": p["key_id"],
                        "pool_id": pool_id,
                        "recipient_entity_id": rec,
                        "period": per,
                        "factor_value": str(factors[rec]),
                        "total_factor_value": str(total),
                        "allocation_ratio": str(factors[rec] / total),
                        "as_of_date": month_end(per),
                        "source_ref": f"supply_chain:SERVICE:{prov}->{rec}:{per}",
                    }))
        rows.sort(key=lambda r: r["key_value_id"])
        return rows

    key_values_actual = key_value_rows("KV")
    # Budget keys forecast the same consumption mix; the cost divergence alone
    # drives the true-up (DECISIONS.md).
    key_values_budget = key_value_rows("KV-B")

    # ---- 1_CostLine ---------------------------------------------------------------
    def cost_line(prov: str, per: str, cc: str, profit_center: str, elem: str,
                  nature: str, function: str, amount: Decimal,
                  pool_id: str | None, prefix: str) -> dict[str, Any]:
        row: dict[str, Any] = {
            "cost_line_id": f"{prefix}-{prov}-{per}-{cc.split('-', 2)[2]}",
            "provider_entity_id": prov,
            "company_code": prov,
            "cost_center": cc,
            "profit_center": profit_center,
            "cost_element": elem,
            "cost_nature": nature,
            "function": function,
            "amount_local": fmt2(amount),
            "currency_local": "USD",
            "posting_date": month_end(per),
            "fiscal_period": per,
            "fiscal_year": FY,
            "flow_type": "Service",
            "charge_method": "Indirect",
            "pass_through_flag": False,
            "source_document_ref": f"DOC-{prefix}-{prov}-{per}-{cc.split('-', 2)[2]}",
        }
        if pool_id is not None:
            row["pool_id"] = pool_id
        return _order_fields("1_CostLine", row)

    def cost_line_rows(budget: bool) -> list[dict[str, Any]]:
        prefix = "CL-B" if budget else "CL"
        rows = []
        for pool_id, p in SERVICE_POOLS.items():
            prov = p["provider"]
            corp_amount = mgmt_period_total[(prov, periods[prov][0])] / CORP_SPLIT_MGMT
            for per in periods[prov]:
                mgmt_total = mgmt_period_total[(prov, per)]
                corp_amount = mgmt_total / CORP_SPLIT_MGMT
                assert corp_amount == corp_amount.quantize(CENT), corp_amount
                assert corp_amount * CORP_SPLIT_MGMT == mgmt_total
                corp_svc_slice = corp_amount * CORP_SPLIT_SVC
                # Chargeable pool base: actual == Σ pair cb (the warehouse fact);
                # budget == cb × budget_factor (8%/15% divergence, SPEC §9.2 style).
                base = cb_period[(prov, per)]
                if budget:
                    base = (base * p["budget_factor"]).quantize(CENT, rounding=ROUND_HALF_EVEN)
                pure_target = base - corp_svc_slice
                assert pure_target > 0
                weights = [w for _cc, _e, _n, w in p["pure_ccs"]]
                amounts = largest_remainder(pure_target, weights)
                for (cc, elem, nature, _w), amount in zip(p["pure_ccs"], amounts):
                    rows.append(cost_line(prov, per, cc, p["profit_center"], elem,
                                          nature, p["service_line"], amount, pool_id, prefix))
                # Impure corporate cost, decomposed into named sub-centers
                # (Finance/HR/Legal/Facilities/Board). Pool assignment happens at
                # Stage 2 via the cc_mapping 20/80 split, so pool_id stays unset
                # here. NICKEL-grain split keeps every sub-center amount x with
                # cent-exact x*0.2 and x*0.8 (no Stage-1 rounding drift). The
                # budget variant keeps the corporate cost unchanged: the
                # management pool must still net to zero against the fixed
                # stewardship exclusions.
                corp_weights = [w for _s, _l, _e, _n, w in CORP_SUBCENTERS]
                corp_amounts = largest_remainder_grain(corp_amount, corp_weights, NICKEL)
                for (suffix, _label, elem, nature, _w), amount in zip(CORP_SUBCENTERS, corp_amounts):
                    rows.append(cost_line(prov, per, corp_cc(prov, suffix), corp_pc(prov),
                                          elem, nature, "Management", amount, None, prefix))
        rows.sort(key=lambda r: r["cost_line_id"])
        return rows

    cost_lines_actual = cost_line_rows(budget=False)
    cost_lines_budget = cost_line_rows(budget=True)

    # ---- reconciliation pre-checks (fail loud at authoring time) -----------------
    for prov in PROVIDERS:
        lines_total = sum(Decimal(r["amount_local"]) for r in cost_lines_actual
                          if r["provider_entity_id"] == prov)
        cb_fy = sum(v for (pv, _rec), v in cb_fy_pair.items() if pv == prov)
        stw = sum(Decimal(str(ln["amount"])) for ln in flagged[prov])
        assert lines_total == cb_fy + stw, (prov, lines_total, cb_fy, stw)
        excl_total = sum(Decimal(r["exclusion_amount"]) for r in exclusions
                         if r["pool_id"] == MGMT_POOLS[prov])
        assert excl_total == stw, (prov, excl_total, stw)
        corp_ccs_prov = {corp_cc(prov, suffix) for suffix, *_ in CORP_SUBCENTERS}
        for per in periods[prov]:
            # The corporate cost is now spread across named sub-centers; sum
            # them, and rely on the nickel-grain split so each sub-center's
            # 20%/80% slice is cent-exact (Σ ties exactly, no drift).
            corp_lines = [Decimal(r["amount_local"]) for r in cost_lines_actual
                          if r["cost_center"] in corp_ccs_prov and r["fiscal_period"] == per]
            corp = sum(corp_lines, Decimal(0))
            corp_svc = sum((a * CORP_SPLIT_SVC for a in corp_lines), Decimal(0))
            corp_mgmt = sum((a * CORP_SPLIT_MGMT for a in corp_lines), Decimal(0))
            pure = sum(Decimal(r["amount_local"]) for r in cost_lines_actual
                       if r["provider_entity_id"] == prov and r["fiscal_period"] == per
                       and r["cost_center"] not in corp_ccs_prov)
            # each per-line slice is cent-exact, so the per-line and aggregate
            # 20/80 splits coincide — assert both the engine sees the right base.
            assert corp_svc == corp * CORP_SPLIT_SVC
            assert corp_mgmt == corp * CORP_SPLIT_MGMT
            assert pure + corp_svc == cb_period[(prov, per)]
            assert corp_mgmt == mgmt_period_total[(prov, per)]

    note_derived = (
        "Derived at authoring time from warehouse supply_chain SERVICE pairs by "
        "seeds/allocation/generate_seeds.py (ADAPTATION D2) — do not hand-edit; re-run the generator."
    )
    docs: dict[str, dict[str, Any]] = {
        "entities.v1.json": {
            "version": "1",
            "note": f"Legal-entity master for the allocation engine. {note_derived} Legal names illustrative; jurisdictions from the warehouse; providers book in USD (group currency).",
            "rows": entities,
        },
        "pools.v1.json": {
            "version": "1",
            "note": f"Service pool catalogue (3_Pool). {note_derived} One provider per pool (V-P5); management pools are fully stewardship-excluded.",
            "rows": pools,
        },
        "cc_mapping.v1.json": {
            "version": "1",
            "note": f"FABRICATED cost-center -> service-line mapping (2_CCMapping) beneath reconciled totals, at a finer cost-center grain (PB1): each pure pool decomposes into function-realistic cost centers and each corporate sub-center (Finance/HR/Legal/Facilities/Board) splits 20/80 between the provider's service pool and its management pool. {note_derived} Split percentages still sum to 100% per cost center (V-P2).",
            "rows": cc_mapping,
        },
        "markup_policies.v1.json": {
            "version": "1",
            "note": f"Markup policies (4_MarkupPolicy). {note_derived} Benchmarked rates are the pair-effective FY{FY} rates (gross/cost-base - 1, full Decimal precision); management pools carry LVAIGS 5%.",
            "rows": markup_policies,
        },
        "exclusions.v1.json": {
            "version": "1",
            "note": f"FABRICATED benefit-test exclusions (5_Exclusions) carried over from the OTP-15 stewardship register's flagged lines (1000: $4,250,000; 3100: $2,700,000), split evenly across each provider's two billing periods. {note_derived}",
            "rows": exclusions,
        },
        "key_defs.v1.json": {
            "version": "1",
            "note": f"Allocation key definitions (6_KeyDef). {note_derived}",
            "rows": key_defs,
        },
        "participation.v1.json": {
            "version": "1",
            "note": f"Pool participation (9_Participation): beneficiary populations per pool = the provider's actual SERVICE pair recipients (1000->3000; 3100->3200/3300/3800), plus one Provider row per pool. {note_derived} The fully stewardship-excluded management pools carry the same populations ('LVAIGS where charged') and never apportion while their chargeable base is zero.",
            "rows": participation,
        },
        "key_values.v1.json": {
            "version": "1",
            "note": f"FABRICATED allocation key values (7_KeyValue): consumption units proportional to the warehouse pair cost base per period (cb/1000), so Stage-4 allocation reproduces the pair split exactly. {note_derived} Budget keys forecast the actual mix.",
            "actual": key_values_actual,
            "budget": key_values_budget,
        },
        "cost_lines.v1.json": {
            "version": "1",
            "note": f"FABRICATED cost lines (1_CostLine) at a finer, function-realistic cost-center grain (PB1) beneath reconciled totals — every line carries a cost_center, a profit_center and a realistic GL cost_element. Per provider they sum EXACTLY to the warehouse FY{FY} SERVICE pair cost base + stewardship exclusions (1000: 6,793,200.00 + 4,250,000.00; 3100: 6,793,202.70 + 2,700,000.00). {note_derived} The corporate cost is decomposed into Finance/HR/Legal/Facilities/Board sub-centers (nickel-grain split so each 20/80 slice stays cent-exact). Budget variant diverges 8% on POOL-IT-US and 15% on POOL-RSS-CH for the true-up demo.",
            "actual": cost_lines_actual,
            "budget": cost_lines_budget,
        },
    }
    return docs


# sheet + row-section layout of every emitted file (used by validation + tests)
FILE_SHEETS: dict[str, tuple[str, tuple[str, ...]]] = {
    "entities.v1.json": ("8_Entity", ("rows",)),
    "cc_mapping.v1.json": ("2_CCMapping", ("rows",)),
    "pools.v1.json": ("3_Pool", ("rows",)),
    "markup_policies.v1.json": ("4_MarkupPolicy", ("rows",)),
    "exclusions.v1.json": ("5_Exclusions", ("rows",)),
    "key_defs.v1.json": ("6_KeyDef", ("rows",)),
    "participation.v1.json": ("9_Participation", ("rows",)),
    "key_values.v1.json": ("7_KeyValue", ("actual", "budget")),
    "cost_lines.v1.json": ("1_CostLine", ("actual", "budget")),
}


def validate_documents(docs: dict[str, dict[str, Any]]) -> list[str]:
    """Schema validation (types + V-R2 enums) and V-R1 FK resolution across files."""
    rows_by_sheet: dict[str, list[dict[str, Any]]] = {}
    for fname, (sheet, sections) in FILE_SHEETS.items():
        for section in sections:
            rows_by_sheet.setdefault(sheet, []).extend(docs[fname][section])
    refs = validation.build_ref_index(rows_by_sheet)
    errors: list[str] = []
    for fname, (sheet, sections) in FILE_SHEETS.items():
        for section in sections:
            errors.extend(
                f"{fname}[{section}]{e}"
                for e in validation.validate_rows(sheet, docs[fname][section], refs)
            )
    return errors


def dump(doc: dict[str, Any]) -> str:
    return json.dumps(doc, indent=2) + "\n"


def main() -> None:
    docs = build_documents()
    errors = validate_documents(docs)
    if errors:
        raise SystemExit("seed validation failed:\n" + "\n".join(errors[:20]))
    for fname, doc in docs.items():
        (OUT_DIR / fname).write_text(dump(doc), encoding="utf-8")
        print(f"emitted: {OUT_DIR / fname}")


if __name__ == "__main__":
    main()
