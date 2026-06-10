"""Shaped calculation traces — the "explain this number" tree (Calc Studio CS-d).

``shape_trace(run, calc_def, output=None)`` turns a persisted calculation run
(``state/calc_runs.py`` row: summary + params_read + raw trace steps) into an
ordered list of human-readable steps, PaPM/Anaplan drill-down style. Each step
is ``{id, label, formula, params, values, sources}``: ``params`` are the
governed parameter reads driving the step (with their scenario ``overridden``
flag), ``values`` the figures the step produced, ``sources`` catalog ids drawn
from the definition's inputs (they always resolve via ``services/catalog.py``
— test-enforced in tests/test_calc_traces.py).

csa / profit_split / beat get curated decompositions mirroring the handlers'
actual arithmetic; service_allocation (M6) shapes the allocation engine's
SEVEN pipeline stages (SPEC §4) from the "stage" trace events the orchestrator
emits; the other calculations fall back to the generic two-step shape
(Inputs → Output). A FRESH run can pass the full output body for
per-participant figures; historical runs (the output body is never persisted)
shape from the stored summary/trace alone, so they gain the tree retroactively.
"""

from __future__ import annotations

from typing import Any


def _step(
    step_id: str,
    label: str,
    formula: str,
    params: list[dict[str, Any]] | None = None,
    values: dict[str, Any] | None = None,
    sources: list[str] | None = None,
) -> dict[str, Any]:
    """One shaped step — ``values`` drops missing (None) figures so a run
    shaped without its output body simply shows fewer chips."""
    return {
        "id": step_id,
        "label": label,
        "formula": formula,
        "params": params or [],
        "values": {k: v for k, v in (values or {}).items() if v is not None},
        "sources": sources or [],
    }


def _params_read(run: dict[str, Any], *keys: str) -> list[dict[str, Any]]:
    """The run's persisted parameter reads for ``keys``, in the order given,
    as step params ``{key, value, overridden}`` (last read wins per key)."""
    by_key: dict[str, dict[str, Any]] = {}
    for p in run.get("params_read") or []:
        by_key[p["key"]] = {
            "key": p["key"],
            "value": p.get("value"),
            "overridden": bool(p.get("overridden")),
        }
    return [by_key[k] for k in keys if k in by_key]


def _agg_rows(run: dict[str, Any], table: str) -> int | None:
    """Row count of the first "aggregate" trace event over ``table``."""
    for s in run.get("trace") or []:
        if s.get("step") == "aggregate" and s.get("table") == table:
            return s.get("rows")
    return None


def _per_participant(output: Any, field: str) -> dict[str, Any]:
    """``{rbukrs: field}`` over the output's participants ({} without one)."""
    if not isinstance(output, dict):
        return {}
    return {p["rbukrs"]: p.get(field) for p in output.get("participants") or []}


# --- Curated decompositions (mirror the routers' actual arithmetic) -----------

def _shape_csa(run: dict[str, Any], d: dict[str, Any], output: Any) -> list[dict[str, Any]]:
    """routers/csa.py:csa() — aggregate → projected sales → pool → RAB shares
    → true-ups → PCT buy-ins."""
    s = run.get("summary") or {}
    out = output if isinstance(output, dict) else {}
    totals = out.get("totals") or {}
    args = run.get("args") or {}
    return [
        _step(
            "aggregate", "Aggregate segment_pl",
            "GROUP segment_pl BY RBUKRS: Σ revenue, Σ opex_rd (CSA participants)",
            values={"year": args.get("year", out.get("year")),
                    "rows": _agg_rows(run, "segment_pl")},
            sources=["warehouse:segment_pl"],
        ),
        _step(
            "projected_sales", "Project sales for RAB benefit",
            "projected_sales_i = revenue_i × (1 + growth)",
            params=_params_read(run, "csa.growth"),
            values={"Σ revenue": totals.get("revenue"),
                    **_per_participant(out, "projected_sales")},
        ),
        _step(
            "pool", "Cost pool",
            "pool = Σ opex_rd",
            values={"pool": s.get("pool", out.get("pool")),
                    **_per_participant(out, "opex_rd")},
            sources=["warehouse:segment_pl"],
        ),
        _step(
            "rab_shares", "RAB shares",
            "rab_share_i = projected_sales_i / Σ projected_sales; "
            "target_contribution_i = rab_share_i × pool",
            values=_per_participant(out, "rab_share"),
        ),
        _step(
            "true_ups", "In-period true-ups",
            "true_up_i = target_contribution_i − opex_rd_i  (Σ true_up = 0)",
            values={"Σ true_up": totals.get("true_up"),
                    **_per_participant(out, "true_up")},
        ),
        _step(
            "pct_buyins", "PCT platform buy-ins",
            "platform_value = pct_mult × pool; pct_buyin_i = rab_share_i × platform_value",
            params=_params_read(run, "csa.pct_mult"),
            values={"platform_value": s.get("platform_value", out.get("platform_value")),
                    **_per_participant(out, "pct_buyin")},
        ),
    ]


def _shape_profit_split(run: dict[str, Any], d: dict[str, Any], output: Any) -> list[dict[str, Any]]:
    """routers/csa.py:profit_split() — aggregate → key totals → residual
    shares → allocated → true-ups."""
    s = run.get("summary") or {}
    out = output if isinstance(output, dict) else {}
    totals = out.get("totals") or {}
    return [
        _step(
            "aggregate", "Aggregate segment_pl",
            "GROUP segment_pl BY RBUKRS: Σ operating_profit, Σ opex_rd, "
            "Σ opex_sm, Σ opex_ga (non-routine parties)",
            params=_params_read(run, "csa.ps_participants"),
            values={"year": s.get("year", out.get("year")),
                    "rows": _agg_rows(run, "segment_pl")},
            sources=["warehouse:segment_pl"],
        ),
        _step(
            "key_totals", "Value-driver key totals",
            "key_i = opex_rd_i | (opex_sm_i + opex_ga_i); key_total = Σ key_i",
            params=_params_read(run, "csa.ps_default_key", "csa.ps_keys"),
            values={"key": out.get("key"),
                    "key_total": s.get("key_total", out.get("key_total")),
                    **_per_participant(out, "key_value")},
        ),
        _step(
            "residual_shares", "Residual shares",
            "share_i = key_i / Σ key",
            values=_per_participant(out, "residual_share"),
        ),
        _step(
            "allocated", "Allocate combined profit",
            "allocated_i = share_i × combined_profit",
            values={"combined_profit": s.get("combined_profit", out.get("combined_profit")),
                    **_per_participant(out, "allocated_profit")},
        ),
        _step(
            "true_ups", "True-ups",
            "true_up_i = allocated_i − operating_profit_i",
            values={"Σ true_up": totals.get("true_up"),
                    **_per_participant(out, "true_up")},
        ),
    ]


def _shape_beat(run: dict[str, Any], d: dict[str, Any], output: Any) -> list[dict[str, Any]]:
    """routers/beat.py:beat() — related-party deductions → classification →
    base-eroding total → erosion % vs threshold → MTI → BEAT tax."""
    s = run.get("summary") or {}
    out = output if isinstance(output, dict) else {}
    by_type = {t["type"]: t.get("amount") for t in out.get("payment_types") or []}
    by_account = out.get("by_account")
    return [
        _step(
            "deductions", "Related-party deductions by RACCT",
            "Σ journal HSL (HSL < 0, affiliate RASSC set) GROUP BY RACCT — US payer",
            params=_params_read(run, "beat.us_payer"),
            values={"related_party_deductions": out.get("related_party_deductions"),
                    "accounts": len(by_account) if isinstance(by_account, list) else None,
                    "rows": _agg_rows(run, "journal")},
            sources=["warehouse:journal"],
        ),
        _step(
            "classification", "Classify by payment type",
            "payment_type = racct_type[RACCT] (unmapped → 'other')",
            params=_params_read(run, "beat.racct_type", "beat.payment_types"),
            values=by_type,
        ),
        _step(
            "base_eroding", "Base-eroding total (COGS exception)",
            "base_eroding = Σ amounts where payment_type ∉ non_base_eroding",
            params=_params_read(run, "beat.non_base_eroding"),
            values={"base_eroding_payments": s.get("base_eroding_payments", out.get("base_eroding_payments")),
                    "cogs_excluded": out.get("cogs_excluded")},
        ),
        _step(
            "erosion_test", "Base-erosion % vs threshold",
            "base_erosion_pct = 100 × base_eroding / total_deductions, tested ≥ threshold_pct",
            params=_params_read(run, "beat.threshold_pct"),
            values={"base_erosion_pct": s.get("base_erosion_pct", out.get("base_erosion_pct")),
                    "total_deductions": s.get("total_deductions", out.get("total_deductions")),
                    "threshold_met": out.get("threshold_met")},
        ),
        _step(
            "mti", "Modified taxable income",
            "MTI = (gross_receipts − total_deductions) + base_eroding",
            values={"gross_receipts": out.get("gross_receipts"),
                    "regular_taxable_income": out.get("regular_taxable_income"),
                    "modified_taxable_income": out.get("modified_taxable_income")},
            sources=["warehouse:segment_pl"],
        ),
        _step(
            "beat_tax", "BEAT base tax",
            "beat_base_tax = MTI × rate_pct / 100",
            params=_params_read(run, "beat.rate_pct"),
            values={"beat_base_tax": s.get("beat_base_tax", out.get("beat_base_tax"))},
        ),
    ]


#: The allocation engine's seven pipeline stages (SPEC §4), in run order —
#: step ids match services/allocation_runner.py STAGE_IDS, formulas are the
#: SPEC stage contracts, sources the registry def's allocation seeds.
_ALLOCATION_STAGES: list[tuple[str, str, str, list[str]]] = [
    ("capture", "Capture & classify (Stage 1)",
     "validate (V-R*, V-P1/P2) → derive function/pool via 2_CCMapping splits "
     "→ route non-Service flows out",
     ["seed:allocation_cost_lines", "seed:allocation_cc_mapping"]),
    ("pool", "Pool (Stage 2)",
     "group classified lines into pools per 3_Pool; split direct-charge / "
     "pass-through / poolable streams",
     ["seed:allocation_pools"]),
    ("benefit_gate", "Benefit-test gate (Stage 3)",
     "chargeable_base = total_pooled_cost − exclusions (5_Exclusions: pct "
     "carve-outs pro-rata, fixed amounts at pool level)",
     ["seed:allocation_exclusions"]),
    ("allocate", "Allocate (Stage 4, cascade-aware)",
     "allocation_ratio = factor / Σ factor over the resolved beneficiaries; "
     "largest-remainder apportionment; cascade topological, reciprocal SCCs "
     "solved S = C + AᵀS",
     ["seed:allocation_participation", "seed:allocation_key_defs",
      "seed:allocation_key_values"]),
    ("markup", "Cost base & markup (Stage 5)",
     "markup = (cost − received component) × policy pct per (pool, recipient "
     "jurisdiction); LVAIGS 5% / SCM 0% / Benchmarked / Pass-through 0%",
     ["seed:allocation_markup_policies"]),
    ("chargeout", "Charge-out (Stage 6)",
     "10_ChargeLedger rows: FX to the charge currency (rate + date logged), "
     "VAT/WHT attributes, posting file per provider",
     ["seed:allocation_entities"]),
    ("reconcile", "Reconcile & true-up (Stage 7)",
     "pooled − exclusions − recovered = 0 (V-X1/V-X2); true-up deltas vs "
     "booked Budget charges (V-X3/V-X4)",
     []),
]


def _shape_service_allocation(
    run: dict[str, Any], d: dict[str, Any], output: Any
) -> list[dict[str, Any]]:
    """services/allocation_runner.py — the seven SPEC §4 stages, with each
    stage's run-time figures from the orchestrator's "stage" trace events
    (persisted on the run) or the fresh output's stage_summaries."""
    values_by_stage: dict[str, dict[str, Any]] = {}
    labels_by_stage: dict[str, str] = {}
    for s in run.get("trace") or []:
        if s.get("step") == "stage" and s.get("stage"):
            values_by_stage[s["stage"]] = dict(s.get("values") or {})
            if s.get("label"):
                labels_by_stage[s["stage"]] = s["label"]
    if isinstance(output, dict):
        for s in output.get("stage_summaries") or []:
            values_by_stage.setdefault(s["id"], dict(s.get("values") or {}))
            labels_by_stage.setdefault(s["id"], s.get("label", ""))
    summary = run.get("summary") or {}
    steps = []
    for stage_id, label, formula, sources in _ALLOCATION_STAGES:
        values = dict(values_by_stage.get(stage_id) or {})
        if stage_id == "reconcile":
            for key in ("recon_balanced", "output_hash"):
                if key in summary:
                    values.setdefault(key, summary[key])
        steps.append(_step(
            stage_id, labels_by_stage.get(stage_id) or label, formula,
            values=values, sources=sources,
        ))
    return steps


def _shape_generic(run: dict[str, Any], d: dict[str, Any], output: Any) -> list[dict[str, Any]]:
    """Fallback for the calculations without a curated decomposition: the
    inputs actually read (params_read + the def's catalog sources), then the
    output summary + digest under the seed's pseudo-formula."""
    s = run.get("summary") or {}
    keys: list[str] = []
    for p in run.get("params_read") or []:
        if p["key"] not in keys:
            keys.append(p["key"])
    catalog_ids = list(d["inputs"]["catalog"])
    return [
        _step(
            "inputs", "Inputs",
            ("read " + " + ".join(catalog_ids)) if catalog_ids else "read governed inputs",
            params=_params_read(run, *keys),
            sources=catalog_ids,
        ),
        _step(
            "output", "Output",
            d.get("formula", ""),
            values={**s, "digest": run.get("output_digest")},
        ),
    ]


_SHAPERS = {
    "csa": _shape_csa,
    "profit_split": _shape_profit_split,
    "beat": _shape_beat,
    "service_allocation": _shape_service_allocation,
}


def shape_trace(
    run: dict[str, Any],
    calc_def: dict[str, Any],
    output: Any = None,
) -> list[dict[str, Any]]:
    """Shape a persisted run into the ordered explain-steps for the trace tree.

    ``output`` is the (never-persisted) full output body — pass it for fresh
    runs to enrich the curated steps with per-participant figures; omit it for
    historical runs, which shape from summary + raw trace alone.
    """
    shaper = _SHAPERS.get(calc_def["id"], _shape_generic)
    return shaper(run, calc_def, output)
