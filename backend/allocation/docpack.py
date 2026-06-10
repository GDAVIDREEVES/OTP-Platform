"""Documentation pack + exception report — SPEC §8.3 / §8.4 (M6).

Pure module (no I/O): the orchestrator persists the rendered artifacts under
the run (ADAPTATION D1). Documentation is a BYPRODUCT of the run, never a
separate step (SPEC §1) — every figure below comes from the run's own stage
outputs, so the pack reconciles with the ledger by construction. Treat this
generator as production code: it is tested like the stages
(tests/allocation/test_m6_stage7_trueup_docpack.py).

``build_doc_pack`` renders one Markdown document per pool per period with the
SPEC §8.3 sections:

1. pool description & characterization;
2. cost composition by nature;
3. exclusions applied with rationale;
4. beneficiary population & benefit rationale;
5. key used, source, values, ratios;
6. cost base, regime, markup & basis;
7. resulting charges;
8. recon tie-out.

``build_exception_report`` is the SPEC §8.4 structure: every fired V-rule
with severity, affected objects and a suggested remediation per rule.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Iterable, Mapping, Sequence

ZERO = Decimal("0")

#: SPEC §8.4 "suggested remediation" per catalogue rule (SPEC §7).
REMEDIATION: dict[str, str] = {
    "V-R1": "Repair the broken reference: add the missing master-data row or "
            "correct the foreign key on the source record.",
    "V-R2": "Fix the malformed row: align enum values, types and decimal "
            "strings with the generated schema (never floats on amounts).",
    "V-R3": "Investigate the negative amount; if it is a genuine reversal, "
            "register its source_document_ref in reversal_document_refs.",
    "V-P1": "Map the cost center to exactly one pool in 2_CCMapping (as-of "
            "the run period) or correct the pre-assigned pool_id.",
    "V-P2": "Adjust the allocation_split_pct rows for the cost center so the "
            "splits are positive and sum to exactly 100%.",
    "V-P3": "Review pool homogeneity: split the pool by function or tighten "
            "the cost-center mapping.",
    "V-P4": "Set traceable_recipient_id on the pass-through line — a "
            "disbursement recharges at cost to an identified recipient.",
    "V-P5": "Model multi-provider needs as separate pools per provider "
            "(SPEC §3.3); remove foreign-provider lines from the pool.",
    "V-B1": "Reduce the exclusions: combined carve-outs cannot exceed 100% "
            "of the pool.",
    "V-B2": "Add the stewardship carve-out (5_Exclusions) for the Management "
            "pool, or document why none applies (OECD TPG 7.9-7.10).",
    "V-B3": "Document the exclusion: non-empty basis_rationale and exactly "
            "one of exclusion_pct / exclusion_amount.",
    "V-K1": "Provide a 7_KeyValue row for every resolved beneficiary in the "
            "period (an explicit zero is a measured zero; absence is not).",
    "V-K2": "Refresh the key snapshot: as_of_date must fall inside the "
            "freshness window for the key's static/dynamic mode.",
    "V-K3": "Re-extract the key values: the supplied total_factor_value must "
            "equal the engine-recomputed sum over the resolved population.",
    "V-K4": "Document the key change vs. prior year (consistency scrutiny) "
            "or revert to the established key.",
    "V-M1": "Maintain exactly one 4_MarkupPolicy row for the (pool, "
            "recipient jurisdiction) as-of the period — never default a markup.",
    "V-M2": "Align the policy with its regime: SCM/Pass-through at 0%, "
            "LVAIGS at the fixed 5%, Benchmarked with a benchmark_study_ref.",
    "V-M3": "Complete the SCM support: eligibility basis != n/a and a "
            "business judgment conclusion (Treas. Reg. §1.482-9(b)).",
    "V-M4": "Attach documentation_ref to the pool evidencing why LVAIGS and "
            "a >5% benchmarked markup diverge across jurisdictions.",
    "V-C1": "Enable the reciprocal solver / repair the cycle's key data so "
            "the consumption matrix is complete and solvable.",
    "V-C2": "Confirm the perTier margin policy is deliberate — received "
            "charges are re-margined at every downstream tier.",
    "V-C3": "Register the received-charge line's upstream charge lineage "
            "(upstream_charge_ref + markup_exempt).",
    "V-X1": "Close the participation/pooling gap: every pooled dollar must "
            "be excluded or charged — the residual must be exactly zero.",
    "V-X2": "Investigate the ledger tie-out: charged-out cost must equal the "
            "chargeable base exactly (group grain inside a reciprocal cycle).",
    "V-X3": "Review the budget-vs-actual divergence driving the true-up; "
            "consider re-forecasting the pool's budget.",
    "V-X4": "Do not post: re-running the same inputs produced different "
            "outputs (or the booked year is not reproducible). Investigate "
            "before any correction.",
}


def build_exception_report(
    exceptions: Iterable[Mapping[str, Any]],
    *,
    run_id: str | None = None,
    period: str | None = None,
) -> dict[str, Any]:
    """SPEC §8.4 — every V-rule fired, severity, affected objects, suggested
    remediation, plus BLOCK/WARN counts for the console."""
    rows = [
        {
            "rule_id": e["rule_id"],
            "severity": e["severity"],
            "message": e["message"],
            "objects": list(e.get("objects") or ()),
            "pool_id": e.get("pool_id"),
            "remediation": REMEDIATION.get(e["rule_id"], ""),
        }
        for e in exceptions
    ]
    return {
        "run_id": run_id,
        "period": period,
        "counts": {
            "BLOCK": sum(1 for r in rows if r["severity"] == "BLOCK"),
            "WARN": sum(1 for r in rows if r["severity"] == "WARN"),
        },
        "exceptions": rows,
    }


def _md_table(headers: Sequence[str], rows: Sequence[Sequence[Any]]) -> list[str]:
    out = ["| " + " | ".join(headers) + " |",
           "| " + " | ".join("---" for _ in headers) + " |"]
    for row in rows:
        out.append("| " + " | ".join("" if v is None else str(v) for v in row) + " |")
    return out


def _money(value: Any) -> str:
    return "" if value is None else str(value)


def build_doc_pack(
    *,
    period: str,
    run_type: str,
    pools: Sequence[Mapping[str, Any]],
    pool_catalog: Sequence[Mapping[str, Any]],
    exclusion_ledger: Sequence[Mapping[str, Any]],
    participation: Sequence[Mapping[str, Any]],
    key_defs: Sequence[Mapping[str, Any]],
    entities: Sequence[Mapping[str, Any]],
    recon_rows: Sequence[Mapping[str, Any]],
    ledger_rows: Sequence[Mapping[str, Any]] = (),
    run_id: str | None = None,
) -> dict[str, str]:
    """One Markdown document per pool per period (SPEC §8.3), keyed
    ``{pool_id}.md``.

    ``pools`` are the Stage-5 priced pool dicts (Decimal, provider booking
    currency); ``recon_rows`` the Stage-7 dicts; ``ledger_rows`` the emitted
    10_ChargeLedger rows (charge currency) for the resulting-charges section.
    Deterministic: pools, lines, charges all render in ascending-id order.
    """
    catalog_by_id = {p["pool_id"]: p for p in pool_catalog}
    key_def_by_id = {k["key_id"]: k for k in key_defs}
    entity_by_id = {e["entity_id"]: e for e in entities}
    recon_by_pool = {r["pool_id"]: r for r in recon_rows}
    excl_by_pool: dict[str, list[Mapping[str, Any]]] = {}
    for entry in exclusion_ledger:
        excl_by_pool.setdefault(entry["pool_id"], []).append(entry)
    part_by_pool: dict[str, list[Mapping[str, Any]]] = {}
    for row in participation:
        if row.get("role") == "Beneficiary":
            part_by_pool.setdefault(row["pool_id"], []).append(row)
    ledger_by_pool: dict[str, list[Mapping[str, Any]]] = {}
    for row in ledger_rows:
        ledger_by_pool.setdefault(row["pool_id"], []).append(row)

    docs: dict[str, str] = {}
    for pool in sorted(pools, key=lambda p: p["pool_id"]):
        pid = pool["pool_id"]
        cat = catalog_by_id.get(pid, {})
        provider = pool["provider_entity_id"]
        provider_name = entity_by_id.get(provider, {}).get(
            "legal_entity_name", provider)
        md: list[str] = []
        md.append(f"# Service charge documentation — {cat.get('pool_name', pid)}")
        md.append("")
        md.append(f"- **Pool:** {pid}")
        md.append(f"- **Period:** {period} ({run_type} run)")
        if run_id:
            md.append(f"- **Run:** {run_id}")
        md.append(f"- **Provider:** {provider} — {provider_name}")
        md.append("")

        # 1. Pool description & characterization -----------------------------
        md.append("## 1. Pool description & characterization")
        md.append("")
        md.append(f"- **Service line:** {pool.get('service_line')}")
        md.append(f"- **Characterization:** {pool.get('characterization')}")
        if cat.get("service_description"):
            md.append(f"- **Service description:** {cat['service_description']}")
        if cat.get("cost_base_definition"):
            md.append(f"- **Cost base definition:** {cat['cost_base_definition']}")
        if pool.get("documentation_ref"):
            md.append(f"- **Documentation reference:** {pool['documentation_ref']}")
        if pool.get("reciprocal_scc"):
            md.append(f"- **Reciprocal group:** {pool['reciprocal_scc']} — "
                      "internal cross-charges are solved simultaneously "
                      "(SPEC §5.3); external charges below reflect the "
                      "solved system.")
        md.append("")

        # 2. Cost composition by nature ---------------------------------------
        md.append("## 2. Cost composition by nature")
        md.append("")
        by_nature: dict[str, Decimal] = {}
        for line in pool.get("lines") or ():
            nature = line.get("cost_nature", "Other")
            by_nature[nature] = by_nature.get(nature, ZERO) + Decimal(
                line["amount_local"])
        if by_nature:
            md.extend(_md_table(
                ["Cost nature", "Amount"],
                [[n, _money(v)] for n, v in sorted(by_nature.items())]))
        else:
            md.append("_No cost lines pooled this period._")
        md.append("")
        md.append(f"**Total pooled cost:** {_money(pool.get('total_pooled_cost'))}")
        md.append("")

        # 3. Exclusions applied with rationale --------------------------------
        md.append("## 3. Exclusions applied (benefit-test gate)")
        md.append("")
        entries = excl_by_pool.get(pid, [])
        if entries:
            md.extend(_md_table(
                ["Exclusion", "Type", "Basis (pct/amount)", "Amount", "Rationale"],
                [[e["exclusion_id"], e["exclusion_type"],
                  (f"{e['pct']} of pool" if e.get("pct") is not None
                   else "fixed amount"),
                  _money(e["amount"]), e["basis_rationale"]]
                 for e in sorted(entries, key=lambda x: x["exclusion_id"])]))
        else:
            md.append("_No exclusions in scope for this pool and period._")
        md.append("")
        md.append(f"**Total exclusions:** {_money(pool.get('total_exclusions'))}  ")
        md.append(f"**Chargeable base:** {_money(pool.get('chargeable_base'))}")
        md.append("")

        # 4. Beneficiary population & benefit rationale ------------------------
        md.append("## 4. Beneficiary population & benefit rationale")
        md.append("")
        beneficiaries = sorted(part_by_pool.get(pid, []),
                               key=lambda r: r["entity_id"])
        if beneficiaries:
            md.extend(_md_table(
                ["Beneficiary", "Entity", "Jurisdiction", "Benefit rationale"],
                [[b["entity_id"],
                  entity_by_id.get(b["entity_id"], {}).get("legal_entity_name", ""),
                  entity_by_id.get(b["entity_id"], {}).get("jurisdiction", ""),
                  b.get("benefit_rationale", "")]
                 for b in beneficiaries]))
        else:
            md.append("_No beneficiary participation rows in scope._")
        md.append("")

        # 5. Key used, source, values, ratios ----------------------------------
        md.append("## 5. Allocation key")
        md.append("")
        key_id = pool.get("key_id")
        key_def = key_def_by_id.get(key_id or "", {})
        if key_id:
            md.append(f"- **Key:** {key_id} — {key_def.get('key_name', '')}")
            md.append(f"- **Factor:** {key_def.get('key_factor')}"
                      + (f" ({key_def['factor_components']})"
                         if key_def.get("factor_components") else ""))
            md.append(f"- **Source system:** {key_def.get('source_system')}")
            md.append(f"- **Mode:** {key_def.get('static_or_dynamic')}")
            md.append(f"- **Total factor value (engine-recomputed):** "
                      f"{pool.get('total_factor_value')}")
            md.append("")
            md.extend(_md_table(
                ["Recipient", "Factor value", "Allocation ratio", "Allocated cost"],
                [[a["recipient_entity_id"], str(a["factor_value"]),
                  str(a["allocation_ratio"]), _money(a["allocated_cost"])]
                 for a in sorted(pool.get("allocations") or (),
                                 key=lambda x: x["recipient_entity_id"])]))
        else:
            md.append("_No key resolved: nothing was apportioned (zero "
                      "chargeable base)._")
        md.append("")

        # 6. Cost base, regime, markup & basis ----------------------------------
        md.append("## 6. Cost base, regime & markup")
        md.append("")
        legs = sorted(pool.get("charges") or (),
                      key=lambda c: (c["recipient_entity_id"], c["charge_kind"]))
        if legs:
            md.extend(_md_table(
                ["Recipient", "Jurisdiction", "Stream", "Policy", "Regime",
                 "Markup %", "Cost", "Markup", "Gross"],
                [[c["recipient_entity_id"], c.get("recipient_jurisdiction"),
                  c["charge_kind"], c.get("markup_policy_id"), c.get("regime"),
                  str(c["markup_pct"]), _money(c["cost_recovered"]),
                  _money(c["markup_amount"]), _money(c["gross_charge"])]
                 for c in legs]))
            md.append("")
            md.append("Amounts above are in the provider's booking currency "
                      "(pre-FX, SPEC §5.6 boundary 2).")
        else:
            md.append("_No charges priced this period._")
        md.append("")

        # 7. Resulting charges ---------------------------------------------------
        md.append("## 7. Resulting charges (ledger)")
        md.append("")
        rows = sorted(ledger_by_pool.get(pid, []),
                      key=lambda r: r["charge_id"])
        if rows:
            md.extend(_md_table(
                ["Charge", "Recipient", "Period", "Budget/Actual", "Cost",
                 "Markup", "Gross", "Currency", "FX rate"],
                [[r["charge_id"], r["recipient_entity_id"], r["period"],
                  r["budget_or_actual"], r["cost_recovered_amount"],
                  r["markup_amount"], r["gross_charge_amount"],
                  r["charge_currency"], r.get("fx_rate")]
                 for r in rows]))
        else:
            md.append("_No ledger rows emitted for this pool._")
        md.append("")

        # 8. Recon tie-out --------------------------------------------------------
        md.append("## 8. Reconciliation tie-out")
        md.append("")
        recon = recon_by_pool.get(pid)
        if recon:
            md.extend(_md_table(
                ["Total pooled", "Exclusions", "Cost recovered", "Markup",
                 "Charged out", "Residual", "True-up delta", "Status"],
                [[_money(recon["total_pooled_cost"]),
                  _money(recon["total_exclusions"]),
                  _money(recon["total_cost_recovered"]),
                  _money(recon["total_markup"]),
                  _money(recon["total_charged_out"]),
                  _money(recon["unallocated_residual"]),
                  _money(recon.get("true_up_delta")),
                  recon["recon_status"]]]))
            md.append("")
            md.append("`total_pooled_cost − total_exclusions − "
                      "total_cost_recovered = unallocated_residual` — "
                      "Balanced iff the residual is exactly zero (V-X1).")
        else:
            md.append("_No recon row for this pool._")
        md.append("")
        docs[f"{pid}.md"] = "\n".join(md)
    return docs
