"""GOLDEN-RUN FIXTURE BUILDER — INDEPENDENT HAND-COMPUTATION (SPEC §9.2).

THIS SCRIPT NEVER IMPORTS THE ENGINE. It is the committed derivation of the
golden fixture's inputs AND its expected outputs, implemented directly from
the SPEC's algorithm definitions (§5.1 largest remainder, §5.2 cascade
"single" margin, §5.3 reciprocal simultaneous equations, §5.4 true-up, §5.6
rounding boundaries) with ``decimal.Decimal`` end to end — so the golden test
compares the engine against an independent computation, not against itself.
Key figures are ADDITIONALLY hard-coded as literals inside
tests/allocation/test_m6_golden_run.py (transcribed from this script's
output), so the acceptance test is not self-referential.

The fixture is SPEC §9.2 verbatim:

- 6 entities: US parent LE-US (provider, tier 1); EU hub LE-NL (tier 2,
  provider AND recipient); OpCos LE-DE / LE-FR / LE-JP; LE-UK, which both
  provides Finance to LE-NL and receives IT from it (the RECIPROCAL PAIR —
  POOL-IT-INFRA ⇄ POOL-FIN-SSC form the 2-cycle).
- 3 pools: POOL-IT-INFRA (LE-NL; LVAIGS 5% for the EU/OECD legs, SCM 0% for
  the US-leg recipient LE-US); POOL-MGMT (LE-US; 30% stewardship carve-out;
  multi-factor key; beneficiaries = the three OpCos); POOL-FIN-SSC (LE-UK;
  transactions key). The Finance SSC charge to LE-NL cascades through the
  hub INSIDE the reciprocal solve (internal SCC flows are implicit, SPEC
  §5.3 / DECISIONS.md M5 #51); the EXPLICIT received-cost-line cascade
  (SPEC §5.2) is exercised by POOL-IT-INFRA's SCM charge to LE-US joining
  POOL-MGMT as a markup-exempt received line. (Topology note, DECISIONS.md
  M6: any MGMT charge to LE-NL or LE-UK would close a second cycle through
  LE-US — IT's beneficiary — and collapse the SPEC's reciprocal PAIR into
  a 3-member SCC, so MGMT charges the OpCos only.)
- 12 Budget months + the Actual year + the true-up: actuals diverge +8% on
  POOL-MGMT's own cost (blended outcome under the 10% warn threshold) and
  +15% on POOL-IT-INFRA's own cost (over it) — V-X3 fires exactly once;
  V-C2 never (default "single").
- Cascade-path entities (LE-US, LE-NL, LE-UK) book in USD (group currency;
  v1 requires currency homogeneity along cascade edges); DE/FR charge out
  in EUR, JP in JPY (the zero-decimal leg), at flat monthly snapshot rates;
  the true-up converts at the year-end closing rate.

Regenerate (from backend/):

    ../.venv/bin/python tests/allocation/golden/build_fixture.py

writes ``fixture.json`` (the run dataset) and ``expected.json`` (every
expected charge to the cent, recon rows, solved reciprocal system, true-up
rows and per-pool KPI ratios) next to this file. Both are committed — do not
hand-edit; re-run the builder.
"""

from __future__ import annotations

import calendar
import json
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_EVEN
from pathlib import Path

HERE = Path(__file__).resolve().parent

CENT = Decimal("0.01")
ZERO = Decimal("0")
ONE = Decimal("1")
YEAR = "2026"
MONTHS = [f"{YEAR}-{m:02d}" for m in range(1, 13)]

#: SPEC §5.1 tie-break separator for the SCC-wide composite keys — must match
#: the engine's fixed total order (any fixed order satisfies the SPEC).
SEP = "\x1f"

# --- structure ---------------------------------------------------------------

ENTITIES = [
    # entity_id, name, jurisdiction, currency, role, tier, parent
    ("LE-US", "Golden Group Inc.", "US", "USD", "Both", 1, None),
    ("LE-NL", "Golden Holding B.V.", "NL", "USD", "Both", 2, "LE-US"),
    ("LE-UK", "Golden Finance Ltd.", "GB", "USD", "Both", 2, "LE-US"),
    ("LE-DE", "Golden Deutschland GmbH", "DE", "EUR", "Recipient", None, "LE-US"),
    ("LE-FR", "Golden France SARL", "FR", "EUR", "Recipient", None, "LE-US"),
    ("LE-JP", "Golden Japan K.K.", "JP", "JPY", "Recipient", None, "LE-US"),
]
CURRENCY = {e[0]: e[3] for e in ENTITIES}
JURISDICTION = {e[0]: e[2] for e in ENTITIES}

POOL_MGMT, POOL_IT, POOL_FIN = "POOL-MGMT", "POOL-IT-INFRA", "POOL-FIN-SSC"
PROVIDER = {POOL_MGMT: "LE-US", POOL_IT: "LE-NL", POOL_FIN: "LE-UK"}

STW_PCT = Decimal("0.30")  # POOL-MGMT stewardship carve-out

#: Allocation key factor values (constant across the year; totals exact).
#: MGMT charges the OpCos only — see the topology note in the docstring.
KEYS = {
    POOL_MGMT: ("KEY-MF", {"LE-DE": 5, "LE-FR": 4, "LE-JP": 5}),
    POOL_IT: ("KEY-SEATS", {"LE-US": 11, "LE-DE": 9, "LE-FR": 6,
                            "LE-JP": 7, "LE-UK": 3}),
    POOL_FIN: ("KEY-TXN", {"LE-NL": 5, "LE-DE": 3, "LE-FR": 2, "LE-JP": 2}),
}

#: LVAIGS 5% everywhere except the IT US leg (SCM 0% — SPEC §9.2).
LVAIGS = Decimal("0.05")
PCT = {(POOL_IT, "LE-US"): ZERO}  # everything else LVAIGS


def pct_for(pool: str, recipient: str) -> Decimal:
    return PCT.get((pool, recipient), LVAIGS)


#: Budget cost lines per pool: (cost_center, cost_element, cost_nature,
#: base, per-month step) — month m amount = base + step*m, whole dollars.
BUDGET_LINES = {
    POOL_MGMT: [("CC-US-MGMT-A", "6400-Management & administration",
                 "Payroll", 100000, 1000),
                ("CC-US-MGMT-B", "6450-Travel & representation",
                 "Travel", 60000, 500)],
    POOL_IT: [("CC-NL-IT-OPS", "6500-Salaries", "Payroll", 200000, 1000),
              ("CC-NL-IT-NET", "6710-Network & telecom",
               "Third-party fee", 150000, 500)],
    POOL_FIN: [("CC-UK-FIN-A", "6500-Salaries", "Payroll", 90000, 400),
               ("CC-UK-FIN-B", "6620-Software & licences",
                "Software", 30000, 100)],
}
#: Actual = budget × factor (SPEC §9.2 divergences; FIN stays on budget).
ACTUAL_FACTOR = {POOL_MGMT: Decimal("1.08"), POOL_IT: Decimal("1.15"),
                 POOL_FIN: ONE}

#: Flat FX snapshots: in-year monthly average; year-end closing for true-up.
FX_MONTHLY = {"EUR": Decimal("0.92"), "JPY": Decimal("150")}
FX_YEAR_END = {"EUR": Decimal("0.95"), "JPY": Decimal("155")}

POSTING_DATE = {p: f"{p}-{calendar.monthrange(int(p[:4]), int(p[5:7]))[1]:02d}"
                for p in MONTHS}


def minor_unit(currency: str) -> Decimal:
    return ONE if currency == "JPY" else CENT


def line_amount(pool: str, base: int, step: int, m: int, source: str) -> Decimal:
    amount = Decimal(base + step * m)
    if source == "actual":
        amount = amount * ACTUAL_FACTOR[pool]  # exact: integer × 1.08/1.15
    assert amount == amount.to_integral_value()
    return amount.quantize(CENT)


# --- SPEC §5.1 largest remainder (independent implementation) -----------------


def apportion(base: Decimal, ratios: dict[str, Decimal]) -> dict[str, Decimal]:
    """SPEC §5.1 pseudocode, implemented from the SPEC text: floor at the
    cent, then one cent at a time in descending fractional-remainder order,
    tie-break ascending recipient id."""
    recipients = sorted(ratios)
    raw = {r: base * ratios[r] for r in recipients}
    floor = {r: raw[r].quantize(CENT, rounding=ROUND_DOWN) for r in recipients}
    residual = base - sum(floor.values(), ZERO)
    n_units = int((residual / CENT).to_integral_value())
    assert residual == n_units * CENT
    order = sorted(recipients, key=lambda r: -(raw[r] - floor[r]))
    out = dict(floor)
    for k in range(n_units):
        out[order[k % len(order)]] += CENT
    assert sum(out.values(), ZERO) == base
    return out


# --- one period, one source: the full pipeline by hand ------------------------


def run_period(period: str, source: str) -> dict:
    """Stages 1-6 for one month, derived directly from the SPEC contracts.

    Returns stage-5 charges (provider USD), stage-6 ledger rows (charge
    currency), pool figures and the solved reciprocal system."""
    m = int(period[5:7])
    month_end = POSTING_DATE[period]

    own: dict[str, Decimal] = {}
    for pool, lines in BUDGET_LINES.items():
        own[pool] = sum((line_amount(pool, base, step, m, source)
                         for (_, _, _, base, step) in lines), ZERO)

    # Stage 3 — POOL-MGMT 30% stewardship carve-out, line-pro-rata on the
    # ORIGINAL amounts (exact sum of per-line allocations).
    mgmt_excl = sum(
        (line_amount(POOL_MGMT, base, step, m, source) * STW_PCT
         for (_, _, _, base, step) in BUDGET_LINES[POOL_MGMT]), ZERO)
    chargeable = {POOL_MGMT: own[POOL_MGMT] - mgmt_excl,
                  POOL_IT: own[POOL_IT], POOL_FIN: own[POOL_FIN]}

    ratios = {pool: {r: Decimal(f) / Decimal(sum(factors.values()))
                     for r, f in factors.items()}
              for pool, (_, factors) in KEYS.items()}

    charges5: list[dict] = []

    def leg(pool: str, recipient: str, cost: Decimal, markable: Decimal,
            ratio: Decimal) -> dict:
        pct = pct_for(pool, recipient)
        # SPEC §5.6 boundary 2 — markup per charge, HALF_EVEN to the cent of
        # the provider's booking currency (USD on every cascade-path pool).
        markup = (markable * pct).quantize(CENT, rounding=ROUND_HALF_EVEN)
        return {
            "pool_id": pool,
            "provider_entity_id": PROVIDER[pool],
            "recipient_entity_id": recipient,
            "period": period,
            "ratio": ratio,
            "cost": cost,
            "markup_pct": pct,
            "markup": markup,
            "gross": cost + markup,
        }

    # ---- reciprocal SCC {POOL-FIN-SSC, POOL-IT-INFRA} (SPEC §5.3) ------------
    # Topological order: the SCC has no upstream edges; POOL-MGMT receives
    # IT's LE-US charge downstream. S = C + AᵀS solved by Gaussian
    # elimination on Decimal exactly as the SPEC describes for a 2×2 system
    # (nodes ascending: FIN, IT; pivot row 0).
    c_it = chargeable[POOL_IT]
    c_fin = chargeable[POOL_FIN]
    a_fi = ratios[POOL_IT]["LE-UK"]   # share of IT consumed by FIN's provider
    a_if = ratios[POOL_FIN]["LE-NL"]  # share of FIN consumed by IT's provider
    m01 = ZERO - a_fi
    m10 = ZERO - a_if
    factor = m10 / ONE
    m11 = ONE - factor * m01
    b1 = c_it - factor * c_fin
    s_it = b1 / m11
    s_fin = (c_fin - m01 * s_it) / ONE
    # self-check against the system (the SPEC's 1e-10 tolerance)
    assert abs(s_it - (c_it + a_if * s_fin)) <= Decimal("1E-10")
    assert abs(s_fin - (c_fin + a_fi * s_it)) <= Decimal("1E-10")

    # External legs: ONE SCC-wide largest-remainder apportionment of Σ C over
    # the weights S_j × share_j(r) (member order ascending, recipients
    # ascending — the engine's fixed total order).
    members = sorted([POOL_FIN, POOL_IT])
    solved = {POOL_FIN: s_fin, POOL_IT: s_it}
    member_entities = {PROVIDER[p] for p in members}
    weights: dict[str, Decimal] = {}
    for j in members:
        for r in sorted(ratios[j]):
            if r in member_entities:
                continue
            weights[f"{j}{SEP}{r}"] = solved[j] * ratios[j][r]
    total_own = c_fin + c_it
    total_weight = sum(weights.values(), ZERO)
    allocated = apportion(total_own,
                          {k: w / total_weight for k, w in weights.items()})
    pure_own = {POOL_IT: c_it, POOL_FIN: c_fin}
    for j in members:
        for r in sorted(ratios[j]):
            if r in member_entities:
                continue
            cost = allocated[f"{j}{SEP}{r}"]
            # "single": markup once, on the OWN cost share — the internal SCC
            # component passes through unmarked. Ops mirror the engine: the
            # exempt amount is cost − own×ratio, the markable base
            # cost − exempt.
            exempt = cost - pure_own[j] * ratios[j][r]
            charges5.append(leg(j, r, cost, cost - exempt, ratios[j][r]))

    # ---- cascade injection (SPEC §5.2): IT's SCM charge to LE-US becomes a
    # received cost line in POOL-MGMT (LE-US provides it) at the GROSS
    # amount, markup-exempt under the default "single" policy.
    g_us = next(c["gross"] for c in charges5
                if c["pool_id"] == POOL_IT
                and c["recipient_entity_id"] == "LE-US")
    mgmt_base = chargeable[POOL_MGMT] + g_us

    # ---- POOL-MGMT (downstream, acyclic): Stage 4 + Stage 5 ------------------
    mgmt_alloc = apportion(mgmt_base, ratios[POOL_MGMT])
    for r in sorted(mgmt_alloc):
        # markup_exempt_cost = received component × allocation ratio (full
        # precision — engine Stage-4 acyclic path); markable = cost − exempt.
        exempt = g_us * ratios[POOL_MGMT][r]
        charges5.append(leg(POOL_MGMT, r, mgmt_alloc[r],
                            mgmt_alloc[r] - exempt, ratios[POOL_MGMT][r]))

    # ---- Stage 6: convert to the recipient currency (SPEC §5.6 boundary 3) --
    rows: dict[str, dict] = {}
    for c in charges5:
        recipient = c["recipient_entity_id"]
        target = CURRENCY[recipient]
        if target == "USD":
            rate, rate_date = Decimal("1.0"), month_end
        else:
            rate, rate_date = FX_MONTHLY[target], month_end
        unit = minor_unit(target)
        cost_conv = (c["cost"] * rate).quantize(unit, rounding=ROUND_HALF_EVEN)
        markup_conv = (c["markup"] * rate).quantize(unit,
                                                    rounding=ROUND_HALF_EVEN)
        charge_id = f"CHG-{period}-{c['pool_id']}-{recipient}"
        rows[charge_id] = {
            "charge_id": charge_id,
            "pool_id": c["pool_id"],
            "provider_entity_id": c["provider_entity_id"],
            "recipient_entity_id": recipient,
            "period": period,
            "fiscal_year": YEAR,
            "budget_or_actual": "Budget" if source == "budget" else "Actual",
            "allocation_key_id": KEYS[c["pool_id"]][0],
            "allocation_ratio_applied": str(c["ratio"]),
            "cost_recovered_amount": str(cost_conv),
            "markup_pct_applied": str(c["markup_pct"]),
            "markup_amount": str(markup_conv),
            "gross_charge_amount": str(cost_conv + markup_conv),
            "charge_currency": target,
            "fx_rate": str(rate),
            "fx_rate_type": "Monthly average",
            "fx_rate_date": rate_date,
            "posting_date": month_end,
        }

    # ---- recon rows (sheet 11 semantics; provider booking currency) ---------
    # POOL-MGMT's pooled cost and base both grow by the injected received
    # charge (post-gate, SPEC §5.2 / M5 #46).
    pool_figures = {
        POOL_MGMT: {"pooled": own[POOL_MGMT] + g_us, "exclusions": mgmt_excl,
                    "base": mgmt_base},
        POOL_IT: {"pooled": c_it, "exclusions": ZERO, "base": c_it},
        POOL_FIN: {"pooled": c_fin, "exclusions": ZERO, "base": c_fin},
    }
    recon = {}
    for pool, fig in pool_figures.items():
        legs = [c for c in charges5 if c["pool_id"] == pool]
        recon[pool] = {
            "total_pooled_cost": str(fig["pooled"]),
            "total_exclusions": str(fig["exclusions"]),
            "total_cost_recovered": str(fig["base"]),  # SCC: full recovery
            "total_markup": str(sum((c["markup"] for c in legs), ZERO)),
            "total_charged_out": str(sum((c["gross"] for c in legs), ZERO)),
            "unallocated_residual": str(fig["pooled"] - fig["exclusions"]
                                        - fig["base"]),
            "recon_status": "Balanced",
        }
    return {
        "charges5": charges5,
        "ledger": rows,
        "recon": recon,
        "solved": {POOL_IT: s_it, POOL_FIN: s_fin},
        "consumption": {"a_it_fin": a_fi, "a_fin_it": a_if},
        "injected": {POOL_MGMT: g_us},
    }


# --- true-up (SPEC §5.4) -------------------------------------------------------


def build_trueup(actual: dict[str, dict], budget: dict[str, dict]) -> dict:
    """Deltas per (pool, provider, recipient) in provider USD, converted once
    at the year-end closing rate; per-pool KPI ratios for V-X3."""
    def fy(charges_by_period: dict[str, dict]) -> dict[tuple[str, str], dict]:
        sums: dict[tuple[str, str], dict] = {}
        for res in charges_by_period.values():
            for c in res["charges5"]:
                key = (c["pool_id"], c["recipient_entity_id"])
                agg = sums.setdefault(key, {"cost": ZERO, "markup": ZERO,
                                            "gross": ZERO})
                agg["cost"] += c["cost"]
                agg["markup"] += c["markup"]
                agg["gross"] += c["gross"]
        return sums

    fy_actual, fy_budget = fy(actual), fy(budget)
    rows: dict[str, dict] = {}
    by_pool: dict[str, dict] = {}
    for key in sorted(set(fy_actual) | set(fy_budget)):
        pool, recipient = key
        a = fy_actual.get(key, {"cost": ZERO, "markup": ZERO, "gross": ZERO})
        b = fy_budget.get(key, {"cost": ZERO, "markup": ZERO, "gross": ZERO})
        delta_cost = a["cost"] - b["cost"]
        delta_markup = a["markup"] - b["markup"]
        delta_gross = a["gross"] - b["gross"]
        kpi = by_pool.setdefault(pool, {"delta_gross": ZERO,
                                        "actual_gross": ZERO})
        kpi["delta_gross"] += delta_gross
        kpi["actual_gross"] += a["gross"]
        if delta_cost == ZERO and delta_markup == ZERO and delta_gross == ZERO:
            continue
        target = CURRENCY[recipient]
        rate = Decimal("1.0") if target == "USD" else FX_YEAR_END[target]
        unit = minor_unit(target)
        conv_cost = (delta_cost * rate).quantize(unit,
                                                 rounding=ROUND_HALF_EVEN)
        conv_markup = (delta_markup * rate).quantize(unit,
                                                     rounding=ROUND_HALF_EVEN)
        charge_id = f"CHG-{YEAR}-{pool}-{recipient}-TRUEUP"
        rows[charge_id] = {
            "charge_id": charge_id,
            "pool_id": pool,
            "provider_entity_id": PROVIDER[pool],
            "recipient_entity_id": recipient,
            "period": YEAR,
            "fiscal_year": YEAR,
            "budget_or_actual": "True-up",
            "cost_recovered_amount": str(conv_cost),
            "markup_pct_applied": str(pct_for(pool, recipient)),
            "markup_amount": str(conv_markup),
            "gross_charge_amount": str(conv_cost + conv_markup),
            "charge_currency": target,
            "fx_rate": str(rate),
            "fx_rate_type": "Spot",
            "fx_rate_date": f"{YEAR}-12-31",
            "posting_date": f"{YEAR}-12-31",
            # the latest booked Budget charge for the triple (engine id; the
            # persisted parent is run-namespaced — asserted by suffix)
            "true_up_parent_charge_id": f"CHG-{YEAR}-12-{pool}-{recipient}",
            "delta_gross_provider_ccy": str(delta_gross),
        }
    for pool, kpi in by_pool.items():
        kpi["ratio"] = str(abs(kpi["delta_gross"]) / kpi["actual_gross"])
        kpi["delta_gross"] = str(kpi["delta_gross"])
        kpi["actual_gross"] = str(kpi["actual_gross"])
    return {"rows": rows, "by_pool": by_pool}


# --- fixture dataset (engine input shapes; exact decimal strings) --------------


def build_dataset() -> dict:
    entities = [{
        "entity_id": eid, "legal_entity_name": name, "company_code": eid,
        "jurisdiction": jur, "functional_currency": ccy, "entity_role": role,
        **({"tier": tier} if tier is not None else {}),
        **({"parent_entity_id": parent} if parent else {}),
        "effective_from": "2026-01-01", "status": "Active",
    } for (eid, name, jur, ccy, role, tier, parent) in ENTITIES]

    pools = [
        {"pool_id": POOL_MGMT, "pool_name": "Group management services",
         "service_line": "Management",
         "service_description": "Group strategy, controlling and management "
                                "support for the operating subsidiaries.",
         "provider_entity_id": "LE-US", "characterization": "LVAIGS",
         "core_or_support": "Support", "unique_intangible_flag": False,
         "significant_risk_flag": False,
         "cost_base_definition": "Total services cost",
         "default_key_id": "KEY-MF", "direct_charge_flag": False,
         "documentation_ref": "DOC/TP/MGMT-2026",
         "effective_from": "2026-01-01", "status": "Active"},
        {"pool_id": POOL_IT, "pool_name": "Global IT infrastructure",
         "service_line": "IT",
         "service_description": "Network, hosting and end-user support run "
                                "from the EU hub.",
         "provider_entity_id": "LE-NL", "characterization": "LVAIGS",
         "core_or_support": "Support", "unique_intangible_flag": False,
         "significant_risk_flag": False,
         "cost_base_definition": "Total services cost",
         "default_key_id": "KEY-SEATS", "direct_charge_flag": False,
         "documentation_ref": "DOC/TP/IT-2026",
         "effective_from": "2026-01-01", "status": "Active"},
        {"pool_id": POOL_FIN, "pool_name": "Finance shared service centre",
         "service_line": "Finance",
         "service_description": "AP/AR, bookkeeping and reporting shared "
                                "services provided to the group.",
         "provider_entity_id": "LE-UK", "characterization": "LVAIGS",
         "core_or_support": "Support", "unique_intangible_flag": False,
         "significant_risk_flag": False,
         "cost_base_definition": "Total services cost",
         "default_key_id": "KEY-TXN", "direct_charge_flag": False,
         "documentation_ref": "DOC/TP/FIN-2026",
         "effective_from": "2026-01-01", "status": "Active"},
    ]

    function_of = {POOL_MGMT: "Management", POOL_IT: "IT", POOL_FIN: "Finance"}
    cc_mapping = []
    for pool, lines in BUDGET_LINES.items():
        for (cc, _, _, _, _) in lines:
            cc_mapping.append({
                "mapping_id": f"MAP-{cc}",
                "company_code": PROVIDER[pool], "cost_center": cc,
                "service_line_id": pool, "function": function_of[pool],
                "effective_from": "2026-01-01", "version": 1,
                "owner": "TP Ops Lead",
                "rationale": f"{cc} serves the {pool} service line only.",
            })

    markup_policies = []
    for pool, (_, factors) in KEYS.items():
        for recipient in sorted(factors):
            jur = JURISDICTION[recipient]
            pct = pct_for(pool, recipient)
            row = {
                "markup_policy_id": f"MP-{pool}-{jur}",
                "pool_id": pool, "jurisdiction": jur,
                "regime": "SCM (0%)" if pct == ZERO else "LVAIGS (5%)",
                "markup_pct": str(pct),
                "effective_from": "2026-01-01",
            }
            if pct == ZERO:
                row["scm_eligibility_basis"] = "Specified covered service (IRS list)"
                row["business_judgment_conclusion"] = (
                    "Back-office IT support: not core, no key competitive "
                    "advantage, no fundamental risk (Treas. Reg. §1.482-9(b)).")
            markup_policies.append(row)

    exclusions = [{
        "exclusion_id": "EX-MGMT-STW", "pool_id": POOL_MGMT,
        "exclusion_type": "Stewardship", "exclusion_pct": str(STW_PCT),
        "basis_rationale": "Shareholder and stewardship activities (group "
                           "consolidation, investor relations) — OECD TPG "
                           "7.9-7.10; 30% time-study carve-out.",
        "effective_from": "2026-01-01", "owner": "TP Manager",
    }]

    key_defs = [
        {"key_id": "KEY-MF", "key_name": "Multi-factor management key",
         "key_factor": "Multi-factor",
         "factor_components": "Revenue 40 / Headcount 40 / Assets 20",
         "source_system": "EPM consolidation",
         "static_or_dynamic": "Dynamic", "recompute_frequency": "Monthly",
         "description": "Composite of the benefit proxies for diffuse "
                        "management support.",
         "owner": "TP Ops Lead"},
        {"key_id": "KEY-SEATS", "key_name": "IT seats per entity",
         "key_factor": "Seats", "source_system": "ITSM / ServiceNow",
         "static_or_dynamic": "Dynamic", "recompute_frequency": "Monthly",
         "description": "Seats track support effort.", "owner": "TP Ops Lead"},
        {"key_id": "KEY-TXN", "key_name": "Finance transactions processed",
         "key_factor": "Transactions", "source_system": "ERP AP/AR",
         "static_or_dynamic": "Dynamic", "recompute_frequency": "Monthly",
         "description": "Transaction volumes track shared-service effort.",
         "owner": "TP Ops Lead"},
    ]

    rationale = {
        POOL_MGMT: "Receives group management and controlling support.",
        POOL_IT: "Consumes hub-hosted infrastructure and end-user support.",
        POOL_FIN: "Transactions processed by the shared service centre.",
    }
    participation = []
    for pool, (_, factors) in KEYS.items():
        participation.append({
            "participation_id": f"PP-{pool}-{PROVIDER[pool]}",
            "pool_id": pool, "entity_id": PROVIDER[pool], "role": "Provider",
            "effective_from": "2026-01-01",
        })
        for recipient in sorted(factors):
            participation.append({
                "participation_id": f"PP-{pool}-{recipient}",
                "pool_id": pool, "entity_id": recipient, "role": "Beneficiary",
                "benefit_rationale": rationale[pool],
                "effective_from": "2026-01-01",
            })

    key_values = {"actual": [], "budget": []}
    for source in ("actual", "budget"):
        prefix = "KV" if source == "actual" else "KV-B"
        for pool, (key_id, factors) in KEYS.items():
            total = sum(factors.values())
            for period in MONTHS:
                for recipient in sorted(factors):
                    key_values[source].append({
                        "key_value_id": f"{prefix}-{pool}-{recipient}-{period}",
                        "key_id": key_id, "pool_id": pool,
                        "recipient_entity_id": recipient, "period": period,
                        "factor_value": str(factors[recipient]),
                        "total_factor_value": str(total),
                        "allocation_ratio": "0",  # never trusted (V-K3)
                        "as_of_date": POSTING_DATE[period],
                        "source_ref": f"{key_id}-EXT-{period}",
                    })

    cost_lines = {"actual": [], "budget": []}
    for source in ("actual", "budget"):
        prefix = "CL" if source == "actual" else "CL-B"
        for pool, lines in BUDGET_LINES.items():
            for (cc, element, nature, base, step) in lines:
                for period in MONTHS:
                    m = int(period[5:7])
                    line_id = f"{prefix}-{cc}-{period}"
                    cost_lines[source].append({
                        "cost_line_id": line_id,
                        "provider_entity_id": PROVIDER[pool],
                        "company_code": PROVIDER[pool], "cost_center": cc,
                        "cost_element": element, "cost_nature": nature,
                        "function": function_of[pool],
                        "amount_local": str(line_amount(pool, base, step, m,
                                                        source)),
                        "currency_local": "USD",
                        "posting_date": POSTING_DATE[period],
                        "fiscal_period": period, "fiscal_year": YEAR,
                        "flow_type": "Service", "charge_method": "Indirect",
                        "pass_through_flag": False,
                        "source_document_ref": f"DOC-{line_id}",
                    })

    fx_rates = []
    for period in MONTHS:
        for ccy, rate in sorted(FX_MONTHLY.items()):
            fx_rates.append({
                "from_currency": "USD", "to_currency": ccy,
                "fx_rate_type": "Monthly average", "rate": str(rate),
                "rate_date": POSTING_DATE[period],
            })
    trueup_fx_rates = [{
        "from_currency": "USD", "to_currency": ccy,
        "fx_rate_type": "year_end_closing", "rate": str(rate),
        "rate_date": f"{YEAR}-12-31",
    } for ccy, rate in sorted(FX_YEAR_END.items())]

    return {
        "entities": entities, "cc_mapping": cc_mapping, "pools": pools,
        "markup_policies": markup_policies, "exclusions": exclusions,
        "key_defs": key_defs, "participation": participation,
        "cost_lines": cost_lines, "key_values": key_values,
        "fx_rates": fx_rates, "trueup_fx_rates": trueup_fx_rates,
        "tax_rules": [],
    }


def main() -> None:
    dataset = build_dataset()
    actual = {p: run_period(p, "actual") for p in MONTHS}
    budget = {p: run_period(p, "budget") for p in MONTHS}
    trueup = build_trueup(actual, budget)

    expected = {
        "config": {"chargeCurrency": "recipient",
                   "fxRateType": "monthly_average",
                   "trueUpFxRateType": "year_end_closing"},
        "budget": {p: budget[p]["ledger"] for p in MONTHS},
        "actual": {p: actual[p]["ledger"] for p in MONTHS},
        "recon_budget": {p: budget[p]["recon"] for p in MONTHS},
        "recon_actual": {p: actual[p]["recon"] for p in MONTHS},
        "solved": {p: {pool: str(v) for pool, v in actual[p]["solved"].items()}
                   for p in MONTHS},
        "solved_budget": {p: {pool: str(v)
                              for pool, v in budget[p]["solved"].items()}
                          for p in MONTHS},
        "injected": {p: {pool: str(v)
                         for pool, v in actual[p]["injected"].items()}
                     for p in MONTHS},
        "trueup": trueup,
    }

    (HERE / "fixture.json").write_text(
        json.dumps(dataset, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    (HERE / "expected.json").write_text(
        json.dumps(expected, indent=1, sort_keys=True) + "\n", encoding="utf-8")

    # Key figures for transcription into the golden test's literals.
    jan = actual["2026-01"]
    print("=== 2026-01 ACTUAL key figures (for test literals) ===")
    print("solved S:", {k: str(v) for k, v in jan["solved"].items()})
    print("injected:", {k: str(v) for k, v in jan["injected"].items()})
    for cid in sorted(jan["ledger"]):
        r = jan["ledger"][cid]
        print(cid, r["cost_recovered_amount"], r["markup_amount"],
              r["gross_charge_amount"], r["charge_currency"])
    print("=== true-up by_pool ===")
    for pool, kpi in sorted(trueup["by_pool"].items()):
        print(pool, kpi)
    print("=== true-up rows ===")
    for cid in sorted(trueup["rows"]):
        r = trueup["rows"][cid]
        print(cid, r["cost_recovered_amount"], r["markup_amount"],
              r["gross_charge_amount"], r["charge_currency"])
    print(f"wrote {HERE / 'fixture.json'} and {HERE / 'expected.json'}")


if __name__ == "__main__":
    main()
