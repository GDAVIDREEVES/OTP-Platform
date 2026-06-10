"""Stage 6 — Charge-out (SPEC §4; M4 scope).

Pure function ``(inputs, ref_data, config) -> {"outputs", "exceptions", "log"}``.

inputs::

    {"charges": [...]}    # Stage-5 priced charge dicts (Decimal amounts)

ref_data::

    {"entities": [8_Entity rows],
     "fx_rates": [...],   # FX snapshot — optional; rows:
                          #   {from_currency, to_currency, fx_rate_type
                          #    (schema enum), rate: str, rate_date: ISO}
     "tax_rules": [...]}  # jurisdiction-pair lookup — optional; rows:
                          #   {provider_jurisdiction, recipient_jurisdiction,
                          #    vat_gst_treatment (schema enum),
                          #    vat_rate?: str, wht_rate?: str}

config::

    {"period": "YYYY-MM" | "YYYY",                       # required (SPEC §6)
     "fxRateType": "spot" | "monthly_average" | "fixed_budget",  # required
     "runType": "budget" | "actual" | "trueup",          # default "actual"
     "chargeCurrency": "recipient" | "provider",         # default "recipient"
     "postingDate": ISO date}                            # default period_end

Behavior (SPEC §4 Stage 6), charges in ascending (pool, recipient, kind)
order:

1. Build ``10_ChargeLedger`` rows (schema sheet 10, exact decimal strings;
   ``run_id`` and ``documentation_ref`` are stamped by the M6 orchestrator —
   stages do not know run identity, ENGINE-CLAUDE.md "Engine purity").
2. Convert to the charge currency with the configured ``fx_rate_type``: the
   rate table is an input snapshot, rate + date logged per charge. Demo legs
   charge in the provider's booking currency (``chargeCurrency =
   "provider"``) so the identity rate 1.0 is logged — an identity is not a
   default (DECISIONS.md M4). A cross-currency leg without exactly one
   snapshot row is a BLOCK (V-R1 — the rate reference does not resolve).
   Cost and markup convert separately, each HALF_EVEN to the TARGET
   currency's minor unit (SPEC §5.6 boundary 3 — the only rounding here);
   ``gross_charge_amount`` is their exact sum, preserving the schema
   identity cost + markup = gross.
3. Attach ``vat_gst_treatment`` / ``wht_rate`` / amounts from the simple
   jurisdiction-pair rules table (v1 lookup, no tax engine). A pair with no
   rule omits the attributes (they are Recommended/Conditional); an
   ambiguous pair (V-R1) or an incomplete/malformed rule row (V-R2) blocks.
4. Emit a posting file per provider entity (SPEC §8.2: provider, recipient,
   period, gross amount, currency, account hints, invoice-required flag) —
   returned as a structure; the orchestrator persists artifacts
   (ADAPTATION D1).

outputs::

    charges:       schema-shaped 10_ChargeLedger rows (validated against the
                   generated schema before emission)
    posting_files: [{provider_entity_id, period, budget_or_actual,
                   charges: [...]}] — one per provider
    lineage:       [{charge_id, pool_id, charge_kind, key_value_id,
                   line_ids}] — charge -> cost-line drill
    blocked_pool_ids: pools whose charges were withheld (SPEC §7)
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN
from typing import Any, Mapping

from allocation.algorithms.currency import minor_unit
from allocation.algorithms.effective_dating import period_bounds, resolve_as_of
from allocation.generated import types as gen
from allocation import validation
from allocation.validation import rules

ZERO = Decimal("0")
IDENTITY_RATE = Decimal("1.0")

# SPEC §6 config values -> schema "fx_rate_type" enumeration.
FX_RATE_TYPE = {
    "spot": "Spot",
    "monthly_average": "Monthly average",
    "fixed_budget": "Fixed/budget",
}
# SPEC §6 runType -> schema "budget_or_actual". A true-up run RECOMPUTES the
# year on actuals (SPEC §5.4); the True-up delta rows are Stage 7's (M6).
BUDGET_OR_ACTUAL = {"budget": "Budget", "actual": "Actual", "trueup": "Actual"}

# Deterministic charge ids: one ledger row per (pool, recipient, period,
# stream) — streams carry different markup treatment and are never merged
# (DECISIONS.md M4).
KIND_SUFFIX = {"allocated": "", "direct": "-DIRECT", "pass_through": "-PASSTHRU"}

# Static v1 posting-file account hints (SPEC §8.2 "account hints").
REVENUE_ACCOUNT_HINT = "4910-Intercompany service fees"
EXPENSE_ACCOUNT_HINT = "6910-Intercompany service charges"


def _decimal_or_none(value: Any) -> Decimal | None:
    """Exact decimal STRING -> Decimal; anything else (incl. floats) is None
    — the caller fires V-R2 (ENGINE-CLAUDE.md: no floats on amounts)."""
    if not isinstance(value, str):
        return None
    try:
        return Decimal(value)
    except InvalidOperation:
        return None


def stage6_chargeout(
    inputs: Mapping[str, Any],
    ref_data: Mapping[str, Any],
    config: Mapping[str, Any],
) -> dict[str, Any]:
    period = config.get("period")
    if not period:
        raise ValueError("config['period'] is required (SPEC §6)")
    fx_cfg = config.get("fxRateType")
    if fx_cfg not in FX_RATE_TYPE:
        raise ValueError(
            "config['fxRateType'] must be one of "
            f"{sorted(FX_RATE_TYPE)} (SPEC §6), got {fx_cfg!r}")
    run_type = config.get("runType", "actual")
    if run_type not in BUDGET_OR_ACTUAL:
        raise ValueError(
            f"config['runType'] must be one of {sorted(BUDGET_OR_ACTUAL)} "
            f"(SPEC §6), got {run_type!r}")
    currency_mode = config.get("chargeCurrency", "recipient")
    if currency_mode not in ("recipient", "provider"):
        raise ValueError(
            "config['chargeCurrency'] must be 'recipient' (SPEC §4 Stage 6 "
            f"default) or 'provider' (DECISIONS.md M4), got {currency_mode!r}")
    _, period_end = period_bounds(period)
    posting_date = str(config.get("postingDate") or period_end)
    fx_rate_type = FX_RATE_TYPE[fx_cfg]
    budget_or_actual = BUDGET_OR_ACTUAL[run_type]

    entities = {e["entity_id"]: e
                for e in resolve_as_of(ref_data.get("entities", ()), period)}

    # FX snapshot rows for the configured rate type (rate + date logged per
    # charge; the snapshot itself is hashed with the run inputs — M6).
    fx_idx: dict[tuple[str, str], list[dict]] = {}
    for row in sorted(ref_data.get("fx_rates", ()),
                      key=lambda r: (str(r.get("from_currency")),
                                     str(r.get("to_currency")),
                                     str(r.get("rate_date")),
                                     str(r.get("rate")))):
        if row.get("fx_rate_type") == fx_rate_type:
            fx_idx.setdefault(
                (row["from_currency"], row["to_currency"]), []).append(dict(row))

    # Jurisdiction-pair VAT/WHT rules (v1 lookup table, SPEC §4 Stage 6).
    tax_idx: dict[tuple[str, str], list[dict]] = {}
    for row in sorted(ref_data.get("tax_rules", ()),
                      key=lambda r: (str(r.get("provider_jurisdiction")),
                                     str(r.get("recipient_jurisdiction")))):
        tax_idx.setdefault(
            (row["provider_jurisdiction"], row["recipient_jurisdiction"]),
            []).append(dict(row))

    charges = sorted(inputs["charges"],
                     key=lambda c: (c["pool_id"], c["recipient_entity_id"],
                                    c["charge_kind"]))

    exceptions: list[dict] = []
    log: list[str] = []
    rows_by_pool: dict[str, list[dict]] = {}
    lineage_by_pool: dict[str, list[dict]] = {}
    blocked_pools: set[str] = set()

    def block(pool_id: str, exc: dict) -> None:
        exceptions.append(exc)
        blocked_pools.add(pool_id)

    for charge in charges:
        pool_id = charge["pool_id"]
        provider = charge["provider_entity_id"]
        recipient = charge["recipient_entity_id"]

        missing = [eid for eid in (provider, recipient) if eid not in entities]
        if missing:
            block(pool_id, rules.exception(
                "V-R1",
                f"pool {pool_id}: entity {missing} does not resolve to an "
                f"8_Entity row in scope as-of {period}",
                objects=missing, pool_id=pool_id,
            ))
            continue
        prov_ent, rec_ent = entities[provider], entities[recipient]

        # ---- FX conversion (SPEC §5.6 boundary 3) ---------------------------
        src = charge.get("cost_currency") or prov_ent["functional_currency"]
        target = (prov_ent if currency_mode == "provider"
                  else rec_ent)["functional_currency"]
        if src == target:
            # Identity leg: 1.0 is logged, not defaulted (DECISIONS.md M4).
            rate, rate_date = IDENTITY_RATE, period_end
        else:
            fx_rows = fx_idx.get((src, target), [])
            if len(fx_rows) != 1:
                block(pool_id, rules.exception(
                    "V-R1",
                    f"pool {pool_id}: {len(fx_rows)} {fx_rate_type!r} FX "
                    f"snapshot rows for {src}->{target} — the charge's rate "
                    "reference must resolve to exactly one row",
                    objects=[f"{src}->{target}"], pool_id=pool_id,
                ))
                continue
            rate = _decimal_or_none(fx_rows[0].get("rate"))
            rate_date = fx_rows[0].get("rate_date")
            if rate is None or rate <= ZERO or not isinstance(rate_date, str):
                block(pool_id, rules.exception(
                    "V-R2",
                    f"pool {pool_id}: FX snapshot row for {src}->{target} is "
                    "malformed — rate must be a positive exact decimal "
                    "string and rate_date an ISO date",
                    objects=[f"{src}->{target}"], pool_id=pool_id,
                ))
                continue
        unit = minor_unit(target)
        # Cost and markup convert separately (HALF_EVEN to the target minor
        # unit); gross is their exact sum so cost + markup == gross holds in
        # the charge currency (DECISIONS.md M4).
        cost_conv = (charge["cost_recovered"] * rate).quantize(
            unit, rounding=ROUND_HALF_EVEN)
        markup_conv = (charge["markup_amount"] * rate).quantize(
            unit, rounding=ROUND_HALF_EVEN)
        gross = cost_conv + markup_conv

        row: dict[str, Any] = {
            "charge_id": (f"CHG-{period}-{pool_id}-{recipient}"
                          f"{KIND_SUFFIX[charge['charge_kind']]}"),
            "pool_id": pool_id,
            "provider_entity_id": provider,
            "recipient_entity_id": recipient,
            "period": charge["period"],
            "fiscal_year": str(charge["period"])[:4],
            "budget_or_actual": budget_or_actual,
            "cost_recovered_amount": str(cost_conv),
            "markup_pct_applied": str(charge["markup_pct"]),
            "markup_amount": str(markup_conv),
            "gross_charge_amount": str(gross),
            "charge_currency": target,
            "fx_rate": str(rate),
            "fx_rate_type": fx_rate_type,
            "fx_rate_date": rate_date,
            "posting_date": posting_date,
        }
        if charge.get("allocation_key_id") is not None:
            row["allocation_key_id"] = charge["allocation_key_id"]
            row["allocation_ratio_applied"] = str(charge["allocation_ratio"])

        # ---- VAT / WHT attributes (v1 jurisdiction-pair lookup) -------------
        pair = (prov_ent["jurisdiction"], rec_ent["jurisdiction"])
        tax_rows = tax_idx.get(pair, [])
        if len(tax_rows) > 1:
            block(pool_id, rules.exception(
                "V-R1",
                f"pool {pool_id}: {len(tax_rows)} tax rule rows for the "
                f"jurisdiction pair {pair} — not exactly one determinate rule",
                objects=[f"{pair[0]}->{pair[1]}"], pool_id=pool_id,
            ))
            continue
        if tax_rows:
            rule_row = tax_rows[0]
            treatment = rule_row.get("vat_gst_treatment")
            tax_error: str | None = None
            if treatment is not None:
                if treatment not in gen.ENUM_VALUES["vat_gst_treatment"]:
                    tax_error = (f"vat_gst_treatment {treatment!r} not in the "
                                 "schema enumeration")
                elif treatment == "Standard-rated":
                    vat_rate = _decimal_or_none(rule_row.get("vat_rate"))
                    if vat_rate is None:
                        tax_error = ("Standard-rated pair rule without a "
                                     "determinate vat_rate")
                    else:
                        row["vat_gst_treatment"] = treatment
                        row["vat_amount"] = str((gross * vat_rate).quantize(
                            unit, rounding=ROUND_HALF_EVEN))
                else:
                    row["vat_gst_treatment"] = treatment
                    row["vat_amount"] = str(ZERO.quantize(unit))
            if tax_error is None and rule_row.get("wht_rate") is not None:
                wht_rate = _decimal_or_none(rule_row.get("wht_rate"))
                if wht_rate is None:
                    tax_error = "wht_rate is not an exact decimal string"
                else:
                    row["wht_rate"] = rule_row["wht_rate"]
                    row["wht_amount"] = str((gross * wht_rate).quantize(
                        unit, rounding=ROUND_HALF_EVEN))
            if tax_error is not None:
                block(pool_id, rules.exception(
                    "V-R2",
                    f"pool {pool_id}: tax rule row for pair {pair} is "
                    f"malformed — {tax_error}",
                    objects=[f"{pair[0]}->{pair[1]}"], pool_id=pool_id,
                ))
                continue

        rows_by_pool.setdefault(pool_id, []).append(row)
        lineage_by_pool.setdefault(pool_id, []).append({
            "charge_id": row["charge_id"],
            "pool_id": pool_id,
            "charge_kind": charge["charge_kind"],
            "key_value_id": charge.get("key_value_id"),
            "line_ids": list(charge.get("line_ids") or ()),
        })

    # BLOCK halts the run for the affected pool (SPEC §7): withhold every
    # charge of a blocked pool, including rows built before the block fired.
    kept_rows: list[dict] = []
    lineage: list[dict] = []
    for pool_id in sorted(rows_by_pool):
        if pool_id in blocked_pools:
            log.append(f"stage6: pool {pool_id} charges withheld (BLOCK)")
            continue
        kept_rows.extend(rows_by_pool[pool_id])
        lineage.extend(lineage_by_pool[pool_id])

    # Engine self-checks: deterministic unique ids; emitted rows are exactly
    # schema-shaped (a failure here is an engine bug, not a data exception).
    assert len({r["charge_id"] for r in kept_rows}) == len(kept_rows)
    schema_errors = validation.validate_rows("10_ChargeLedger", kept_rows)
    assert not schema_errors, schema_errors

    # Posting file per provider entity (SPEC §8.2) — returned structure; the
    # orchestrator writes run artifacts (ADAPTATION D1, engine purity).
    by_provider: dict[str, list[dict]] = {}
    for row in kept_rows:
        prov_jur = entities[row["provider_entity_id"]]["jurisdiction"]
        rec_jur = entities[row["recipient_entity_id"]]["jurisdiction"]
        by_provider.setdefault(row["provider_entity_id"], []).append({
            "charge_id": row["charge_id"],
            "provider_entity_id": row["provider_entity_id"],
            "recipient_entity_id": row["recipient_entity_id"],
            "period": row["period"],
            "gross_amount": row["gross_charge_amount"],
            "currency": row["charge_currency"],
            "account_hints": {"provider_revenue": REVENUE_ACCOUNT_HINT,
                              "recipient_expense": EXPENSE_ACCOUNT_HINT},
            # Cross-border IC service charges need an invoice (VAT/customs);
            # domestic legs do not (DECISIONS.md M4).
            "invoice_required": prov_jur != rec_jur,
        })
    posting_files = [
        {"provider_entity_id": provider, "period": period,
         "budget_or_actual": budget_or_actual, "charges": file_rows}
        for provider, file_rows in sorted(by_provider.items())
    ]

    log.append(
        f"stage6[{period}]: {len(kept_rows)} charge ledger rows emitted "
        f"({budget_or_actual}, fx {fx_rate_type}), "
        f"{len(posting_files)} posting files, "
        f"{len(blocked_pools)} pools blocked",
    )
    return {
        "outputs": {
            "charges": kept_rows,
            "posting_files": posting_files,
            "lineage": lineage,
            "blocked_pool_ids": sorted(blocked_pools),
        },
        "exceptions": exceptions,
        "log": log,
    }
