"""True-up — SPEC §5.4: recompute the year on actuals, subtract booked
in-year Budget charges, emit one True-up delta row per (pool, provider,
recipient, year).

Pure function ``true_up(inputs, ref_data, config) -> {"outputs",
"exceptions", "log"}`` — the orchestrator runs the per-period actual AND
budget recomputes (stages 1-5) and reads the booked Budget ledger rows; this
module owns the deltas, the verification, the FX and the V-X3/V-X4 rules.

inputs::

    {"actual_charges":     [...],  # Stage-5 charge dicts (Decimal, provider
                                   # booking currency) — actual recompute
                                   # across every period of the year
     "budget_charges":     [...],  # same, budget recompute
     "booked_budget_rows": [...]}  # persisted 10_ChargeLedger rows (exact
                                   # decimal strings) — the booked Budget
                                   # charges for the year (latest succeeded
                                   # budget run per period)

ref_data::

    {"entities":         [8_Entity rows],
     "trueup_fx_rates":  [...]}   # snapshot rows {from_currency, to_currency,
                                  # fx_rate_type: "year_end_closing" |
                                  # "annual_average", rate, rate_date}

config::

    {"year": "YYYY",                                       # required
     "trueUpFxRateType": "year_end_closing" | "annual_average",
     "trueUpWarnThreshold": number (default 0.10),
     "chargeCurrency": "recipient" | "provider",           # default recipient
     "postingDate": ISO date}                              # default year end

Mechanics (DECISIONS.md M6):

1. Deltas are computed in the PROVIDER's booking currency at the Stage-5
   pre-FX level — in-year monthly FX never drives the true-up; the configured
   true-up rate does (that is why ``trueUpFxRateType`` exists).
2. The booked side is anchored to the LEDGER: every booked Budget row must be
   exactly reproduced by the deterministic budget recompute (matched by its
   engine charge id; amounts re-derived with the row's own logged ``fx_rate``
   at SPEC §5.6 boundary 3). Any mismatch, duplicate booking, or booked row
   with no recompute leg is a reproducibility break → V-X4 BLOCK. A recompute
   leg that was never booked is excluded from the subtrahend (only BOOKED
   charges are subtracted) and logged.
3. ``delta = actual_full_year − Σ verified booked Budget charges`` per
   (pool, provider, recipient), per component (cost / markup / gross).
   All-zero triples emit no row (nothing to adjust).
4. The provider-currency delta converts ONCE at the ``trueUpFxRateType``
   snapshot rate to the charge currency (cost and markup separately,
   HALF_EVEN to the target minor unit — boundary 3; gross is their exact
   sum). Identity legs log rate 1.0. The schema ``fx_rate_type`` enumeration
   has no year-end/annual-average member, so the emitted row maps
   year_end_closing → "Spot" (the year-end date pins the closing semantics)
   and annual_average → "Monthly average".
5. ``true_up_parent_charge_id`` = the latest-period verified booked Budget
   charge for the triple (tie-break ascending charge_id); a triple with no
   booked parent emits its delta without one (the field is Conditional).
6. True-up rows may carry NEGATIVE amounts: they are the schema's sanctioned
   correction rows (append-only ledger — corrections are reversing rows),
   linked to their parent, and therefore the explicit-reversal exception of
   V-R3.
7. V-X3 WARN per (pool, provider): |Σ delta_gross| / actual-year gross >
   ``trueUpWarnThreshold``.

outputs::

    true_up_rows: schema-shaped 10_ChargeLedger rows (budget_or_actual =
                  "True-up"); run_id/documentation_ref stamped by the
                  orchestrator (M4 #41)
    deltas:       [{pool_id, provider_entity_id, recipient_entity_id,
                  delta_cost, delta_markup, delta_gross (Decimal, provider
                  ccy), parent_charge_id}]
    by_pool:      {pool_id: {provider_entity_id, delta_gross, actual_gross,
                  budget_gross (Decimal, provider ccy)}}
    blocked_pool_ids: pools named by BLOCK rules
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN
from typing import Any, Mapping

from allocation import validation
from allocation.algorithms.currency import minor_unit
from allocation.algorithms.effective_dating import period_bounds, resolve_as_of
from allocation.stages.stage6_chargeout import KIND_SUFFIX
from allocation.validation import rules

ZERO = Decimal("0")
IDENTITY_RATE = Decimal("1.0")

#: SPEC §6 trueUpFxRateType -> schema "fx_rate_type" enumeration (the
#: enumeration has no year-end/annual-average member — DECISIONS.md M6).
TRUE_UP_FX_TYPES = {
    "year_end_closing": "Spot",
    "annual_average": "Monthly average",
}


def engine_charge_id(charge: Mapping[str, Any]) -> str:
    """The deterministic Stage-6 charge id for a Stage-5 charge dict — the
    key that matches a booked ledger row back to its recompute leg (persisted
    ids are ``{run_id}:{engine_id}``; DECISIONS.md M6)."""
    return (f"CHG-{charge['period']}-{charge['pool_id']}-"
            f"{charge['recipient_entity_id']}"
            f"{KIND_SUFFIX[charge['charge_kind']]}")


def _decimal_or_none(value: Any) -> Decimal | None:
    if not isinstance(value, str):
        return None
    try:
        return Decimal(value)
    except InvalidOperation:
        return None


def _triple(charge: Mapping[str, Any]) -> tuple[str, str, str]:
    return (charge["pool_id"], charge["provider_entity_id"],
            charge["recipient_entity_id"])


def true_up(
    inputs: Mapping[str, Any],
    ref_data: Mapping[str, Any],
    config: Mapping[str, Any],
) -> dict[str, Any]:
    year = str(config.get("year") or "")
    if len(year) != 4 or not year.isdigit():
        raise ValueError(f"config['year'] must be 'YYYY' (SPEC §5.4), got {year!r}")
    fx_cfg = config.get("trueUpFxRateType", "year_end_closing")
    if fx_cfg not in TRUE_UP_FX_TYPES:
        raise ValueError(
            "config['trueUpFxRateType'] must be one of "
            f"{sorted(TRUE_UP_FX_TYPES)} (SPEC §6), got {fx_cfg!r}")
    currency_mode = config.get("chargeCurrency", "recipient")
    if currency_mode not in ("recipient", "provider"):
        raise ValueError(
            f"config['chargeCurrency'] must be 'recipient' or 'provider', "
            f"got {currency_mode!r}")
    # The threshold is a config scalar, not money: Decimal(str(...)) gives the
    # exact decimal literal the config names (never float math on amounts).
    threshold = Decimal(str(config.get("trueUpWarnThreshold", "0.10")))
    _, year_end = period_bounds(year)
    posting_date = str(config.get("postingDate") or year_end)
    row_fx_type = TRUE_UP_FX_TYPES[fx_cfg]

    entities = {e["entity_id"]: e
                for e in resolve_as_of(ref_data.get("entities", ()), year)}
    fx_idx: dict[tuple[str, str], list[dict]] = {}
    for row in sorted(ref_data.get("trueup_fx_rates", ()),
                      key=lambda r: (str(r.get("from_currency")),
                                     str(r.get("to_currency")),
                                     str(r.get("rate_date")),
                                     str(r.get("rate")))):
        if row.get("fx_rate_type") == fx_cfg:
            fx_idx.setdefault(
                (row["from_currency"], row["to_currency"]), []).append(dict(row))

    actual = sorted(inputs["actual_charges"], key=engine_charge_id)
    budget = sorted(inputs["budget_charges"], key=engine_charge_id)
    booked = sorted(inputs["booked_budget_rows"],
                    key=lambda r: str(r.get("charge_id")))

    exceptions: list[dict] = []
    log: list[str] = []
    blocked: set[str] = set()

    # ---- V-X4: every booked Budget row reproduced by the budget recompute ---
    budget_by_id: dict[str, dict] = {}
    for charge in budget:
        eid = engine_charge_id(charge)
        assert eid not in budget_by_id  # stage-6 ids are unique per period
        budget_by_id[eid] = charge

    verified: list[tuple[dict, dict]] = []  # (booked row, recompute leg)
    seen_engine_ids: dict[str, str] = {}
    for row in booked:
        cid = str(row.get("charge_id"))
        eid = cid.split(":", 1)[1] if ":" in cid else cid
        pool_id = row.get("pool_id")
        if eid in seen_engine_ids:
            exceptions.extend(rules.v_x4_reproducibility_failure(
                f"true-up {year}",
                f"booked Budget charge {cid} duplicates "
                f"{seen_engine_ids[eid]} — the booked year is ambiguous",
                objects=[cid, seen_engine_ids[eid]], pool_id=pool_id))
            blocked.add(str(pool_id))
            continue
        seen_engine_ids[eid] = cid
        leg = budget_by_id.get(eid)
        if leg is None:
            exceptions.extend(rules.v_x4_reproducibility_failure(
                f"true-up {year}",
                f"booked Budget charge {cid} is not reproduced by the "
                "budget recompute (no matching leg)",
                objects=[cid], pool_id=pool_id))
            blocked.add(str(pool_id))
            continue
        fx = _decimal_or_none(row.get("fx_rate"))
        if fx is None or fx <= ZERO:
            exceptions.extend(rules.v_x4_reproducibility_failure(
                f"true-up {year}",
                f"booked Budget charge {cid} has no verifiable fx_rate — "
                "its conversion cannot be reproduced",
                objects=[cid], pool_id=pool_id))
            blocked.add(str(pool_id))
            continue
        unit = minor_unit(str(row.get("charge_currency")))
        # Re-derive the booked amounts at SPEC §5.6 boundary 3 with the row's
        # own logged rate: cost and markup convert separately; gross is the
        # exact sum (M4 #38).
        exp_cost = (leg["cost_recovered"] * fx).quantize(
            unit, rounding=ROUND_HALF_EVEN)
        exp_markup = (leg["markup_amount"] * fx).quantize(
            unit, rounding=ROUND_HALF_EVEN)
        if (Decimal(row["cost_recovered_amount"]) != exp_cost
                or Decimal(row["markup_amount"]) != exp_markup
                or Decimal(row["gross_charge_amount"]) != exp_cost + exp_markup):
            exceptions.extend(rules.v_x4_reproducibility_failure(
                f"true-up {year}",
                f"booked Budget charge {cid} amounts differ from the "
                f"deterministic budget recompute (expected cost {exp_cost}, "
                f"markup {exp_markup} at logged rate {fx})",
                objects=[cid], pool_id=pool_id))
            blocked.add(str(pool_id))
            continue
        verified.append((row, leg))

    unbooked = sorted(set(budget_by_id) - set(seen_engine_ids))
    if unbooked:
        # Only BOOKED charges are subtracted (SPEC §5.4): a never-booked
        # recompute leg stays out of the subtrahend (DECISIONS.md M6).
        log.append(f"true-up[{year}]: {len(unbooked)} budget recompute leg(s) "
                   f"were never booked and are excluded from the booked "
                   f"subtrahend: {unbooked}")

    # ---- deltas per (pool, provider, recipient) — provider booking ccy ------
    actual_sum: dict[tuple[str, str, str], dict[str, Any]] = {}
    for charge in actual:
        agg = actual_sum.setdefault(_triple(charge), {
            "cost": ZERO, "markup": ZERO, "gross": ZERO,
            "currency": charge["cost_currency"], "pcts": set()})
        assert agg["currency"] == charge["cost_currency"]
        agg["cost"] += charge["cost_recovered"]
        agg["markup"] += charge["markup_amount"]
        agg["gross"] += charge["gross_charge"]
        agg["pcts"].add(str(charge["markup_pct"]))

    booked_sum: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row, leg in verified:
        agg = booked_sum.setdefault(_triple(leg), {
            "cost": ZERO, "markup": ZERO, "gross": ZERO,
            "currency": leg["cost_currency"], "rows": []})
        assert agg["currency"] == leg["cost_currency"]
        agg["cost"] += leg["cost_recovered"]
        agg["markup"] += leg["markup_amount"]
        agg["gross"] += leg["gross_charge"]
        agg["rows"].append(row)

    deltas: list[dict] = []
    rows_out: list[dict] = []
    by_pool: dict[str, dict[str, Any]] = {}
    for triple in sorted(set(actual_sum) | set(booked_sum)):
        pool_id, provider, recipient = triple
        a = actual_sum.get(triple)
        b = booked_sum.get(triple)
        delta_cost = (a["cost"] if a else ZERO) - (b["cost"] if b else ZERO)
        delta_markup = (a["markup"] if a else ZERO) - (b["markup"] if b else ZERO)
        delta_gross = (a["gross"] if a else ZERO) - (b["gross"] if b else ZERO)

        pool_kpi = by_pool.setdefault(pool_id, {
            "provider_entity_id": provider,
            "delta_gross": ZERO, "actual_gross": ZERO, "budget_gross": ZERO})
        pool_kpi["delta_gross"] += delta_gross
        pool_kpi["actual_gross"] += a["gross"] if a else ZERO
        pool_kpi["budget_gross"] += b["gross"] if b else ZERO

        if delta_cost == ZERO and delta_markup == ZERO and delta_gross == ZERO:
            continue  # nothing to adjust — no row (DECISIONS.md M6)

        # Parent: the latest-period verified booked charge for the triple,
        # tie-break ascending charge_id (SPEC §5.1 determinism convention).
        parent: str | None = None
        if b and b["rows"]:
            parent = sorted(
                b["rows"],
                key=lambda r: (str(r.get("period")), str(r.get("charge_id"))),
            )[-1]["charge_id"]

        provider_ccy = (a or b)["currency"]
        if pool_id in blocked:
            continue  # the pool's booked year already failed V-X4
        if currency_mode == "provider":
            target = provider_ccy
        else:
            ent = entities.get(recipient)
            if ent is None:
                exceptions.append(rules.exception(
                    "V-R1",
                    f"pool {pool_id}: true-up recipient {recipient!r} does "
                    f"not resolve to an 8_Entity row in scope as-of {year}",
                    objects=[recipient], pool_id=pool_id))
                blocked.add(pool_id)
                continue
            target = ent["functional_currency"]
        if provider_ccy == target:
            rate, rate_date = IDENTITY_RATE, year_end
        else:
            fx_rows = fx_idx.get((provider_ccy, target), [])
            if len(fx_rows) != 1:
                exceptions.append(rules.exception(
                    "V-R1",
                    f"pool {pool_id}: {len(fx_rows)} {fx_cfg!r} true-up FX "
                    f"snapshot rows for {provider_ccy}->{target} — the "
                    "true-up rate reference must resolve to exactly one row",
                    objects=[f"{provider_ccy}->{target}"], pool_id=pool_id))
                blocked.add(pool_id)
                continue
            rate = _decimal_or_none(fx_rows[0].get("rate"))
            rate_date = fx_rows[0].get("rate_date")
            if rate is None or rate <= ZERO or not isinstance(rate_date, str):
                exceptions.append(rules.exception(
                    "V-R2",
                    f"pool {pool_id}: true-up FX snapshot row for "
                    f"{provider_ccy}->{target} is malformed — rate must be a "
                    "positive exact decimal string and rate_date an ISO date",
                    objects=[f"{provider_ccy}->{target}"], pool_id=pool_id))
                blocked.add(pool_id)
                continue
        unit = minor_unit(target)
        # SPEC §5.6 boundary 3 — the ONLY rounding in this module: cost and
        # markup convert separately, gross is their exact sum (M4 #38).
        conv_cost = (delta_cost * rate).quantize(unit, rounding=ROUND_HALF_EVEN)
        conv_markup = (delta_markup * rate).quantize(unit, rounding=ROUND_HALF_EVEN)

        # markup_pct_applied is Mandatory on sheet 10: a delta row records the
        # year's single policy rate when determinate, else the blended
        # markup/cost delta ratio at full precision (DECISIONS.md M6).
        pcts = sorted((a or {}).get("pcts") or ())
        if len(pcts) == 1:
            pct_applied = pcts[0]
        elif delta_cost != ZERO:
            pct_applied = str(delta_markup / delta_cost)
        else:
            pct_applied = "0"

        row = {
            "charge_id": f"CHG-{year}-{pool_id}-{recipient}-TRUEUP",
            "pool_id": pool_id,
            "provider_entity_id": provider,
            "recipient_entity_id": recipient,
            "period": year,
            "fiscal_year": year,
            "budget_or_actual": "True-up",
            "cost_recovered_amount": str(conv_cost),
            "markup_pct_applied": pct_applied,
            "markup_amount": str(conv_markup),
            "gross_charge_amount": str(conv_cost + conv_markup),
            "charge_currency": target,
            "fx_rate": str(rate),
            "fx_rate_type": row_fx_type,
            "fx_rate_date": rate_date,
            "posting_date": posting_date,
        }
        if parent is not None:
            row["true_up_parent_charge_id"] = parent
        rows_out.append(row)
        deltas.append({
            "pool_id": pool_id,
            "provider_entity_id": provider,
            "recipient_entity_id": recipient,
            "delta_cost": delta_cost,
            "delta_markup": delta_markup,
            "delta_gross": delta_gross,
            "parent_charge_id": parent,
        })

    # Withhold rows of pools blocked above (BLOCK halts the affected pool).
    rows_out = [r for r in rows_out if r["pool_id"] not in blocked]
    deltas = [d for d in deltas if d["pool_id"] not in blocked]

    # ---- V-X3 — true-up KPI threshold per (pool, provider) ------------------
    for pool_id in sorted(by_pool):
        if pool_id in blocked:
            continue
        kpi = by_pool[pool_id]
        exceptions.extend(rules.v_x3_true_up_exceeds_threshold(
            pool_id, kpi["delta_gross"], kpi["actual_gross"], threshold))

    # Engine self-check: emitted rows are exactly schema-shaped (True-up rows
    # legitimately carry negative deltas — the V-R3 reversal exception).
    schema_errors = validation.validate_rows("10_ChargeLedger", rows_out)
    assert not schema_errors, schema_errors

    log.append(
        f"true-up[{year}]: {len(verified)} booked Budget rows verified, "
        f"{len(rows_out)} True-up rows emitted across "
        f"{len({r['pool_id'] for r in rows_out})} pools, "
        f"{len(blocked)} pools blocked",
    )
    return {
        "outputs": {
            "true_up_rows": rows_out,
            "deltas": deltas,
            "by_pool": by_pool,
            "blocked_pool_ids": sorted(blocked),
        },
        "exceptions": exceptions,
        "log": log,
    }
