"""Allocation run orchestrator — SPEC §4's thin orchestration layer (M6).

The engine (backend/allocation/) is pure; THIS module is the adapter that
owns I/O (ADAPTATION D1):

    loadInputs (seeds + SQLite) -> snapshot + sha256 hash recorded on the run
    -> execute stages 1-7 (cascade-aware; true-up for annual runs)
    -> persist outputs ATOMICALLY (all-or-nothing per run)
    -> emit the documentation pack + exception report + posting files as run
       artifacts (SQLite text — state/allocation_store.py)

Run mechanics (DECISIONS.md M6):

- ``run_id`` = ``RUN-{seq:04d}-{run_type}-{period}``; persisted ledger ids are
  namespaced ``{run_id}:{engine_charge_id}`` so the deterministic engine ids
  (M4 #35) stay unique across runs on the append-only ledger.
- The OUTPUT hash is computed over the ENGINE outputs (pre run-stamping), so
  a re-run of identical inputs must reproduce it byte-for-byte: a prior
  succeeded run with the same input snapshot hash but a different output hash
  is a V-X4 BLOCK and the run fails.
- ANY BLOCK exception fails the WHOLE run: nothing reaches the ledgers; only
  the exception report (and the output hash) is persisted with status
  ``failed`` (the conservative reading of "atomic, all-or-nothing").
- A run period's FX snapshot = the dataset rows whose ``rate_date`` falls
  inside the period (stage 6 requires exactly one row per pair).
- True-up runs (period = "YYYY") recompute every period of the year on
  actuals AND on budget through stage 5 (provider booking currency), verify
  the booked Budget ledger rows against the budget recompute, and persist
  ONLY the True-up delta rows + the annual recon (SPEC §5.4).

Registered in the Calc Studio registry as calculation ``service_allocation``
(``run_for_registry``): registry runs land in the job console with a shaped
7-stage trace (services/calc_traces.py) and the standard audit "run" event at
``calc:service_allocation``; every run — registry or direct API — is also
audited at ``allocation:{run_id}``.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
from decimal import Decimal
from typing import Any, Mapping

import state.allocation_store as store
import state.audit as audit
import state.seeds as seeds
from allocation import docpack
from allocation.algorithms.cascade import cascade_allocate
from allocation.algorithms.effective_dating import period_bounds
from allocation.algorithms.trueup import true_up
from allocation.stages import (
    stage1_capture_and_classify,
    stage2_pool,
    stage3_benefit_gate,
    stage5_markup,
    stage6_chargeout,
    stage7_reconcile,
)
from allocation.validation import rules
from calc import trace

ZERO = Decimal("0")

PROCESS_ID = "OTP-10"  # service charge batch — the allocation engine's home

RUN_TYPES = ("budget", "actual", "trueup")

#: SPEC §6 run config — demo defaults (chargeCurrency "provider" per
#: DECISIONS.md M4 #36; the golden run overrides to the SPEC default
#: "recipient").
DEFAULT_CONFIG: dict[str, Any] = {
    "cascadeMarkupPolicy": "single",
    "midPeriodProration": False,
    "fxRateType": "monthly_average",
    "trueUpFxRateType": "year_end_closing",
    "trueUpWarnThreshold": 0.10,
    "unallocatedResidualTolerance": 0,
    "chargeCurrency": "provider",
    "reciprocalSolverEnabled": True,
}

#: The seven pipeline stages, in order — ids shared with the shaped trace.
STAGE_IDS = ("capture", "pool", "benefit_gate", "allocate",
             "markup", "chargeout", "reconcile")


# ------------------------------------------------------------------- inputs --


def load_demo_dataset() -> dict[str, Any]:
    """The committed demo dataset: reference sheets + the actual/budget
    ledgers from the allocation seeds (state/seeds.py registry)."""
    def rows(name: str) -> list[dict]:
        return seeds.load(name)["rows"]

    cost_lines = seeds.load("allocation_cost_lines")
    key_values = seeds.load("allocation_key_values")
    return {
        "entities": rows("allocation_entities"),
        "cc_mapping": rows("allocation_cc_mapping"),
        "pools": rows("allocation_pools"),
        "markup_policies": rows("allocation_markup_policies"),
        "exclusions": rows("allocation_exclusions"),
        "key_defs": rows("allocation_key_defs"),
        "participation": rows("allocation_participation"),
        "cost_lines": {"actual": cost_lines["actual"],
                       "budget": cost_lines["budget"]},
        "key_values": {"actual": key_values["actual"],
                       "budget": key_values["budget"]},
        "fx_rates": [],
        "trueup_fx_rates": [],
        "tax_rules": [],
    }


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _sha256(obj: Any) -> str:
    return hashlib.sha256(_canonical(obj).encode("utf-8")).hexdigest()


def _strs(d: Mapping[str, Any]) -> dict[str, Any]:
    """Decimals -> exact decimal strings (JSON-safe, never floats)."""
    return {k: str(v) if isinstance(v, Decimal) else v for k, v in d.items()}


def _fx_for_period(dataset: Mapping[str, Any], period: str) -> list[dict]:
    """The period's FX snapshot: dataset rows dated inside the period."""
    start, end = period_bounds(period)
    return [r for r in dataset.get("fx_rates", ())
            if start <= str(r.get("rate_date")) <= end]


# ---------------------------------------------------------- engine execution --


def _execute_period(
    dataset: Mapping[str, Any], period: str, source: str,
    config: Mapping[str, Any],
) -> dict[str, Any]:
    """Stages 1-5 (cascade-aware) for one period over the actual|budget
    envelope. Pure-engine composition — no persistence here."""
    cfg = {**config, "period": period}
    ref = {
        "entities": dataset["entities"],
        "cc_mapping": dataset["cc_mapping"],
        "pools": dataset["pools"],
        "markup_policies": dataset["markup_policies"],
        "exclusions": dataset["exclusions"],
        "key_defs": dataset["key_defs"],
        "participation": dataset["participation"],
        "key_values": dataset["key_values"][source],
        "received_charge_lineage": dataset.get("received_charge_lineage") or {},
        "prior_year_keys": dataset.get("prior_year_keys") or {},
    }
    lines = [r for r in dataset["cost_lines"][source]
             if r["fiscal_period"] == period]

    s1 = stage1_capture_and_classify({"cost_lines": lines}, ref, cfg)
    s2 = stage2_pool(
        {"classified_lines": s1["outputs"]["classified_lines"]}, ref, cfg)
    s3 = stage3_benefit_gate({"pools": s2["outputs"]["pools"]}, ref, cfg)
    casc = cascade_allocate({"pools": s3["outputs"]["pools"]}, ref, cfg)
    # Direct/pass-through streams are priced by a separate Stage-5 pass —
    # they do not cascade in v1 (DECISIONS.md M5 #54).
    extra5 = stage5_markup(
        {"pools": [],
         "direct_charges": s2["outputs"]["direct_charges"],
         "pass_through": s2["outputs"]["pass_through"]},
        {"markup_policies": dataset["markup_policies"],
         "entities": dataset["entities"]},
        cfg)

    line_rows = {l["cost_line_id"]: l
                 for l in s1["outputs"]["classified_lines"]}
    line_rows.update({l["cost_line_id"]: l
                      for l in casc["outputs"]["received_lines"]})
    return {
        "s1": s1, "s2": s2, "s3": s3, "cascade": casc, "extra5": extra5,
        "pools5": casc["outputs"]["pools"],
        "charges5": (casc["outputs"]["charges"]
                     + extra5["outputs"]["charges"]),
        "exceptions": (s1["exceptions"] + s2["exceptions"] + s3["exceptions"]
                       + casc["exceptions"] + extra5["exceptions"]),
        "log": (s1["log"] + s2["log"] + s3["log"]
                + casc["log"] + extra5["log"]),
        "line_rows": line_rows,
    }


def _period_stage_summaries(ex: Mapping[str, Any], s6: Mapping[str, Any],
                            s7: Mapping[str, Any]) -> list[dict[str, Any]]:
    casc = ex["cascade"]["outputs"]
    recon = s7["outputs"]["recon"]
    balanced = sum(1 for r in recon if r["recon_status"] == "Balanced")
    return [
        {"id": "capture", "label": "Capture & classify (Stage 1)", "values": {
            "lines_in": len(ex["s1"]["outputs"]["classified_lines"])
            + len(ex["s1"]["outputs"]["excluded_flows"])
            + len(ex["s1"]["outputs"]["held_line_ids"]),
            "classified": len(ex["s1"]["outputs"]["classified_lines"]),
            "excluded_flows": len(ex["s1"]["outputs"]["excluded_flows"]),
            "held": len(ex["s1"]["outputs"]["held_line_ids"])}},
        {"id": "pool", "label": "Pool (Stage 2)", "values": {
            "pools": len(ex["s2"]["outputs"]["pools"]),
            "direct": len(ex["s2"]["outputs"]["direct_charges"]),
            "pass_through": len(ex["s2"]["outputs"]["pass_through"])}},
        {"id": "benefit_gate", "label": "Benefit-test gate (Stage 3)", "values": {
            "pools": len(ex["s3"]["outputs"]["pools"]),
            "total_exclusions": str(sum(
                (p["total_exclusions"] for p in ex["s3"]["outputs"]["pools"]),
                ZERO)),
            "exclusion_entries": len(ex["s3"]["outputs"]["exclusion_ledger"])}},
        {"id": "allocate", "label": "Allocate (Stage 4, cascade-aware)", "values": {
            "allocations": len(casc["allocations"]),
            "total_allocated": str(sum(
                (a["allocated_cost"] for a in casc["allocations"]), ZERO)),
            "received_charge_lines": len(casc["received_lines"]),
            "reciprocal_groups": len(
                {tuple(p["reciprocal_scc"]) for p in casc["pools"]
                 if p.get("reciprocal_scc")})}},
        {"id": "markup", "label": "Cost base & markup (Stage 5)", "values": {
            "charges": len(ex["charges5"]),
            "total_markup": str(sum(
                (c["markup_amount"] for c in ex["charges5"]), ZERO))}},
        {"id": "chargeout", "label": "Charge-out (Stage 6)", "values": {
            "ledger_rows": len(s6["outputs"]["charges"]),
            "posting_files": len(s6["outputs"]["posting_files"])}},
        {"id": "reconcile", "label": "Reconcile (Stage 7)", "values": {
            "recon_rows": len(recon),
            "balanced": balanced,
            "breaks": len(recon) - balanced}},
    ]


# ------------------------------------------------------------------ artifacts --


def _posting_csv(posting_file: Mapping[str, Any]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["charge_id", "provider_entity_id", "recipient_entity_id",
                     "period", "gross_amount", "currency",
                     "provider_revenue_account", "recipient_expense_account",
                     "invoice_required"])
    for c in posting_file["charges"]:
        writer.writerow([
            c["charge_id"], c["provider_entity_id"], c["recipient_entity_id"],
            c["period"], c["gross_amount"], c["currency"],
            c["account_hints"]["provider_revenue"],
            c["account_hints"]["recipient_expense"],
            "yes" if c["invoice_required"] else "no",
        ])
    return buf.getvalue()


def _artifact(name: str, content_type: str, content: str) -> dict[str, str]:
    return {"name": name, "content_type": content_type, "content": content}


def _json_artifact(name: str, obj: Any) -> dict[str, str]:
    return _artifact(name, "application/json",
                     json.dumps(obj, indent=2, sort_keys=True, default=str))


# ------------------------------------------------------------------ run entry --


def run_allocation(
    *,
    period: str,
    run_type: str,
    actor: str,
    scope: Mapping[str, Any] | None = None,
    config: Mapping[str, Any] | None = None,
    dataset: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Launch one allocation run end to end. Returns the run record plus
    summary / recon / exception report (the ledger rows live in SQLite)."""
    if run_type not in RUN_TYPES:
        raise ValueError(f"run_type must be one of {RUN_TYPES}, got {run_type!r}")
    period = str(period)
    period_bounds(period)  # validates "YYYY-MM" / "YYYY"
    if run_type == "trueup" and len(period) != 4:
        raise ValueError("a trueup run takes the YEAR ('YYYY') as its period "
                         "(SPEC §5.4/§6)")
    if run_type != "trueup" and len(period) == 4:
        raise ValueError(f"a {run_type} run takes a monthly period 'YYYY-MM'")
    dataset = dataset or load_demo_dataset()
    cfg: dict[str, Any] = {**DEFAULT_CONFIG, **(config or {}),
                           "period": period, "runType": run_type,
                           "scope": dict(scope or {})}

    # ---- loadInputs: snapshot + hash (SPEC §4) -------------------------------
    booked_budget_rows: list[dict] = []
    if run_type == "trueup":
        booked_budget_rows = store.latest_booked_budget_rows(period)
    snapshot = {
        "dataset": {k: dataset.get(k) for k in (
            "entities", "cc_mapping", "pools", "markup_policies", "exclusions",
            "key_defs", "participation", "cost_lines", "key_values",
            "fx_rates", "trueup_fx_rates", "tax_rules",
            "received_charge_lineage", "prior_year_keys")},
        "booked_budget_rows": booked_budget_rows,
        "config": {k: v for k, v in cfg.items() if k != "postingDate" or v},
    }
    input_hash = _sha256(snapshot)

    # ---- execute the engine (pure; no persistence yet) -----------------------
    exceptions: list[dict] = []
    engine_charges: list[dict] = []      # stage-6 rows (engine ids)
    trueup_rows: list[dict] = []         # schema rows (engine ids)
    posting_files: list[dict] = []
    lineage6: list[dict] = []
    line_rows: dict[str, dict] = {}
    docs: dict[str, str] = {}
    stage_summaries: list[dict] = []
    recon_engine: list[dict] = []
    pools5: list[dict] = []
    exclusion_ledger: list[dict] = []

    if run_type in ("budget", "actual"):
        source = "budget" if run_type == "budget" else "actual"
        ex = _execute_period(dataset, period, source, cfg)
        s6 = stage6_chargeout(
            {"charges": ex["charges5"]},
            {"entities": dataset["entities"],
             "fx_rates": _fx_for_period(dataset, period),
             "tax_rules": dataset.get("tax_rules", ())},
            {**cfg})
        s7 = stage7_reconcile({"pools": ex["pools5"]}, {}, cfg)
        exceptions = ex["exceptions"] + s6["exceptions"] + s7["exceptions"]
        engine_charges = s6["outputs"]["charges"]
        posting_files = s6["outputs"]["posting_files"]
        lineage6 = s6["outputs"]["lineage"]
        line_rows = ex["line_rows"]
        recon_engine = s7["outputs"]["recon"]
        pools5 = ex["pools5"]
        exclusion_ledger = ex["s3"]["outputs"]["exclusion_ledger"]
        stage_summaries = _period_stage_summaries(ex, s6, s7)
    else:
        # ---- true-up: recompute the year on actuals AND budget (SPEC §5.4) --
        months = sorted({
            str(r["fiscal_period"])
            for src in ("actual", "budget")
            for r in dataset["cost_lines"][src]
            if str(r["fiscal_period"]).startswith(period)})
        actual_charges: list[dict] = []
        budget_charges: list[dict] = []
        monthly_actual_pools: list[dict] = []
        s1_counts = {"lines_in": 0, "classified": 0}
        excl_total = ZERO
        alloc_count = 0
        for month in months:
            ex_a = _execute_period(dataset, month, "actual", cfg)
            ex_b = _execute_period(dataset, month, "budget", cfg)
            exceptions.extend(ex_a["exceptions"] + ex_b["exceptions"])
            actual_charges.extend(ex_a["charges5"])
            budget_charges.extend(ex_b["charges5"])
            monthly_actual_pools.extend(ex_a["pools5"])
            exclusion_ledger.extend(ex_a["s3"]["outputs"]["exclusion_ledger"])
            s1_counts["classified"] += len(
                ex_a["s1"]["outputs"]["classified_lines"])
            s1_counts["lines_in"] += (
                len(ex_a["s1"]["outputs"]["classified_lines"])
                + len(ex_a["s1"]["outputs"]["excluded_flows"])
                + len(ex_a["s1"]["outputs"]["held_line_ids"]))
            excl_total += sum((p["total_exclusions"]
                               for p in ex_a["s3"]["outputs"]["pools"]), ZERO)
            alloc_count += len(ex_a["cascade"]["outputs"]["allocations"])

        tu = true_up(
            {"actual_charges": actual_charges,
             "budget_charges": budget_charges,
             "booked_budget_rows": booked_budget_rows},
            {"entities": dataset["entities"],
             "trueup_fx_rates": dataset.get("trueup_fx_rates", ())},
            {**cfg, "year": period})
        exceptions.extend(tu["exceptions"])
        trueup_rows = tu["outputs"]["true_up_rows"]

        # Annual recon: aggregate the monthly stage-5 pools per (pool,
        # provider) and tie out the whole year, recording true_up_delta.
        agg: dict[str, dict] = {}
        for pool in monthly_actual_pools:
            a = agg.setdefault(pool["pool_id"], {
                "pool_id": pool["pool_id"],
                "provider_entity_id": pool["provider_entity_id"],
                "period": period,
                "service_line": pool.get("service_line"),
                "characterization": pool.get("characterization"),
                "documentation_ref": pool.get("documentation_ref"),
                "key_id": pool.get("key_id"),
                "total_factor_value": pool.get("total_factor_value"),
                "total_pooled_cost": ZERO, "total_exclusions": ZERO,
                "chargeable_base": ZERO, "charges": [], "lines": [],
                "allocations": [],
                "reciprocal_scc": pool.get("reciprocal_scc"),
            })
            a["total_pooled_cost"] += pool["total_pooled_cost"]
            a["total_exclusions"] += pool["total_exclusions"]
            a["chargeable_base"] += pool["chargeable_base"]
            a["charges"].extend(pool.get("charges") or ())
            a["lines"].extend(pool.get("lines") or ())
            a["allocations"].extend(pool.get("allocations") or ())
        pools5 = [agg[k] for k in sorted(agg)]
        s7 = stage7_reconcile(
            {"pools": pools5,
             "true_up_by_pool": tu["outputs"]["by_pool"]},
            {}, cfg)
        exceptions.extend(s7["exceptions"])
        recon_engine = s7["outputs"]["recon"]

        warn_pools = sorted({e["pool_id"] for e in exceptions
                             if e["rule_id"] == "V-X3"})
        balanced = sum(1 for r in recon_engine
                       if r["recon_status"] == "Balanced")
        stage_summaries = [
            {"id": "capture", "label": "Capture & classify (Stage 1, year on actuals)",
             "values": {**s1_counts, "months": len(months)}},
            {"id": "pool", "label": "Pool (Stage 2, year on actuals)",
             "values": {"pools": len(pools5)}},
            {"id": "benefit_gate", "label": "Benefit-test gate (Stage 3)",
             "values": {"total_exclusions": str(excl_total)}},
            {"id": "allocate", "label": "Allocate (Stage 4, year on actuals)",
             "values": {"allocations": alloc_count}},
            {"id": "markup", "label": "Cost base & markup (Stage 5)",
             "values": {"actual_charges": len(actual_charges),
                        "budget_charges": len(budget_charges)}},
            {"id": "chargeout", "label": "True-up delta rows (SPEC §5.4)",
             "values": {"true_up_rows": len(trueup_rows),
                        "booked_budget_rows": len(booked_budget_rows)}},
            {"id": "reconcile", "label": "Reconcile & true-up KPIs (Stage 7)",
             "values": {"recon_rows": len(recon_engine), "balanced": balanced,
                        "breaks": len(recon_engine) - balanced,
                        "trueup_warn_pools": warn_pools}},
        ]

    # Output hash over the ENGINE outputs (pre-stamping): a re-run of the
    # same inputs must reproduce it byte-for-byte (V-X4).
    output_hash = _sha256({
        "charges": engine_charges,
        "true_up_rows": trueup_rows,
        "recon": [_strs(r) for r in recon_engine],
        "exceptions": exceptions,
    })

    # ---- V-X4: prior identical-input runs must have identical outputs -------
    for prior in store.list_runs(period=period):
        if (prior["run_type"] != run_type or prior["status"] != "succeeded"
                or prior["input_snapshot_hash"] != input_hash):
            continue
        prior_hash = store.get_artifact(prior["run_id"], "output.sha256")
        if prior_hash and prior_hash["content"] != output_hash:
            exceptions.extend(rules.v_x4_reproducibility_failure(
                f"run {period} ({run_type})",
                f"output hash {output_hash[:12]}… differs from prior run "
                f"{prior['run_id']} ({prior_hash['content'][:12]}…) despite an "
                "identical input snapshot hash",
                objects=[prior["run_id"]]))

    # ---- record the run; persist atomically ----------------------------------
    run_id = store.new_run_id(period, run_type)
    store.insert_run(
        run_id=run_id, period=period, run_type=run_type,
        input_snapshot_hash=input_hash, scope=dict(scope or {}),
        config={k: v for k, v in cfg.items() if k != "scope"},
    )

    report = docpack.build_exception_report(
        exceptions, run_id=run_id, period=period)
    for s in stage_summaries:
        trace.emit("stage", stage=s["id"], label=s["label"], values=s["values"])

    blocks = rules.blocks(exceptions)
    if blocks:
        run = store.persist_run_failure(run_id, artifacts=[
            _json_artifact("exceptions.json", report),
            _artifact("output.sha256", "text/plain", output_hash),
        ])
        summary = {
            "run_id": run_id, "period": period, "run_type": run_type,
            "status": "failed", "charges": 0, "recon_balanced": False,
            "blocks": len(blocks),
            "warns": report["counts"]["WARN"],
            "total_charged_out": "0",
            "output_hash": output_hash,
        }
        audit.record(actor=actor, actor_kind="human",
                     record_ref=f"allocation:{run_id}", process_id=PROCESS_ID,
                     event_type="run", after=summary,
                     rationale="allocation run failed: BLOCK exceptions "
                               "withheld every output (SPEC §7)")
        return {**run, "summary": summary, "stage_summaries": stage_summaries,
                "recon": [_strs(r) for r in recon_engine],
                "exception_report": report, "artifacts": ["exceptions.json",
                                                          "output.sha256"]}

    # Stamp run identity onto the engine outputs (M4 #41): persisted charge
    # ids are namespaced per run; documentation_ref points at the run's pack.
    persisted_charges: list[dict] = []
    for row in engine_charges + trueup_rows:
        persisted_charges.append({**row,
                                  "charge_id": f"{run_id}:{row['charge_id']}",
                                  "documentation_ref": run_id})
    run_row = store.get_run(run_id)
    started_at = run_row["started_at"] if run_row else ""
    recon_rows = [{
        **_strs({k: v for k, v in r.items() if v is not None}),
        "recon_id": f"RECON-{run_id}-{r['pool_id']}",
        "run_id": run_id,
        "run_timestamp": started_at,
    } for r in recon_engine]

    docs = docpack.build_doc_pack(
        period=period, run_type=run_type, pools=pools5,
        pool_catalog=dataset["pools"], exclusion_ledger=exclusion_ledger,
        participation=dataset["participation"], key_defs=dataset["key_defs"],
        entities=dataset["entities"], recon_rows=recon_engine,
        ledger_rows=persisted_charges, run_id=run_id)

    lineage_obj: dict[str, Any] = {"charges": {}, "lines": {}}
    for entry in lineage6:
        pid = f"{run_id}:{entry['charge_id']}"
        lineage_obj["charges"][pid] = {
            "pool_id": entry["pool_id"],
            "charge_kind": entry["charge_kind"],
            "key_value_id": entry.get("key_value_id"),
            "line_ids": list(entry.get("line_ids") or ()),
        }
        for lid in entry.get("line_ids") or ():
            if lid in line_rows:
                lineage_obj["lines"][lid] = line_rows[lid]
    for row in trueup_rows:
        pid = f"{run_id}:{row['charge_id']}"
        lineage_obj["charges"][pid] = {
            "pool_id": row["pool_id"],
            "charge_kind": "true_up",
            "true_up_parent_charge_id": row.get("true_up_parent_charge_id"),
            "line_ids": [],
        }

    artifacts = [
        _json_artifact("exceptions.json", report),
        _artifact("output.sha256", "text/plain", output_hash),
        _json_artifact("lineage.json", lineage_obj),
    ]
    for name, content in sorted(docs.items()):
        artifacts.append(_artifact(f"docs/{name}", "text/markdown", content))
    for pf in posting_files:
        stamped = {**pf, "run_id": run_id, "charges": [
            {**c, "charge_id": f"{run_id}:{c['charge_id']}"}
            for c in pf["charges"]]}
        artifacts.append(_json_artifact(
            f"posting/{pf['provider_entity_id']}.json", stamped))
        artifacts.append(_artifact(
            f"posting/{pf['provider_entity_id']}.csv", "text/csv",
            _posting_csv(stamped)))

    balanced_all = all(r["recon_status"] == "Balanced" for r in recon_engine)
    summary = {
        "run_id": run_id, "period": period, "run_type": run_type,
        "status": "succeeded",
        "pools": len(recon_engine),
        "charges": len(persisted_charges),
        "recon_balanced": balanced_all,
        "total_charged_out": str(sum(
            (Decimal(r["total_charged_out"]) for r in recon_rows), ZERO)),
        "blocks": 0,
        "warns": report["counts"]["WARN"],
        "output_hash": output_hash,
        "input_snapshot_hash": input_hash,
    }
    artifacts.append(_json_artifact("summary.json", summary))

    run = store.persist_run_success(
        run_id, charges=persisted_charges, recon_rows=recon_rows,
        artifacts=artifacts)
    audit.record(actor=actor, actor_kind="human",
                 record_ref=f"allocation:{run_id}", process_id=PROCESS_ID,
                 event_type="run", after=summary)
    return {**run, "summary": summary, "stage_summaries": stage_summaries,
            "recon": [_strs(r) for r in recon_rows],
            "exception_report": report,
            "artifacts": [a["name"] for a in artifacts]}


# ------------------------------------------------------- Calc Studio runner --


def latest_actual_period(dataset: Mapping[str, Any] | None = None) -> str:
    dataset = dataset or load_demo_dataset()
    return max(str(r["fiscal_period"]) for r in dataset["cost_lines"]["actual"])


def run_for_registry(
    actor: str = "calc-studio",
    period: str | None = None,
    run_type: str = "actual",
) -> dict[str, Any]:
    """The ``service_allocation`` calculation handler: the POST-equivalent
    run (actual, latest demo period by default), returned as a JSON-safe
    summary body — Calc Studio's job console persists digest/summary/trace,
    never the ledger rows (those live on the allocation ledgers)."""
    if period is None:
        period = (latest_actual_period() if run_type != "trueup"
                  else latest_actual_period()[:4])
    res = run_allocation(period=period, run_type=run_type, actor=actor)
    return {
        **res["summary"],
        "stage_summaries": res["stage_summaries"],
        "recon": res["recon"],
        "exceptions": res["exception_report"]["exceptions"],
        "artifacts": res.get("artifacts", []),
    }


# ============================================================================
# Phase 6 — Authored Pool Builder (PB2): engine integration for user-authored
# pools. An authored pool is a governed EXPERIMENT — built from a cost-capture
# rule over the (fabricated, cost-center-grain) allocation cost lines, run
# through the REAL Stages 1-7 in ISOLATION, and flagged authored. It NEVER
# touches the governed seeded allocation: the demo dataset's pools/cc_mapping/
# cost_lines are not mutated; instead a fresh, minimal overlay dataset is
# assembled per authored pool and executed on its own. The engine invariant
# (pooled = exclusions + recovered + 0 residual) still holds by construction,
# so an authored run reconciles to zero residual exactly like the governed one.
# ============================================================================

#: Recognised key factors (authoring object `key.key_factor`). Each maps a
#: beneficiary to a non-negative Decimal factor value; the engine recomputes
#: the total over the resolved population (V-K3 — never trusted from input).
AUTHORED_KEY_FACTORS = ("Equal", "Revenue", "Cost")

#: segment_pl Cost measure = Σ of the operating-cost columns (matches the
#: warehouse P&L the rest of the demo reads). Wrapped in SUM() by the caller.
_SEGMENT_PL_COST_EXPR = "SUM(cogs + opex_production + opex_rd + opex_sm + opex_ga)"

#: authoring `key_factor` -> the 6_KeyDef.key_factor enum the engine carries
#: (the engine recomputes the total over the resolved population — V-K3). The
#: enum has no "Equal" value, so Equal weighting is labelled "Multi-factor"
#: (a neutral catch-all); Cost maps to the schema's "Total cost".
_SCHEMA_KEY_FACTOR = {"Equal": "Multi-factor", "Revenue": "Revenue",
                      "Cost": "Total cost"}


def _authored_cost_line_matches(
    rule: Mapping[str, Any], line: Mapping[str, Any]
) -> bool:
    """Evaluate a cost-capture rule's predicates over one cost line (AND across
    the three dimensions; OR within each non-empty list). An empty list for a
    dimension is "no constraint on this dimension". A rule with NO predicates
    at all matches nothing (a pool must capture something deliberately)."""
    ccs = rule.get("cost_centers") or []
    pcs = rule.get("profit_centers") or []
    els = rule.get("cost_elements") or []
    if not (ccs or pcs or els):
        return False
    if ccs and line.get("cost_center") not in ccs:
        return False
    if pcs and line.get("profit_center") not in pcs:
        return False
    if els and line.get("cost_element") not in els:
        return False
    return True


def preview_capture_rule(
    rule: Mapping[str, Any], *, source: str = "actual",
    dataset: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Evaluate a cost-capture rule over the cost lines (no persist). Returns
    the captured amount (Decimal-exact), the matched line count and a
    by-(provider) breakdown — what the Builder's live preview card shows.

    An optional ``split_pct`` (Decimal string in (0, 1]) scales the captured
    amount: only that fraction of each matched line is pooled (the remainder
    stays with its existing pool / out of scope). No silent default — if
    ``split_pct`` is present it must parse to a value in (0, 1]."""
    split = _parse_split_pct(rule.get("split_pct"))
    lines = dataset["cost_lines"][source] if dataset else load_demo_dataset()["cost_lines"][source]
    captured = ZERO
    count = 0
    by_entity: dict[str, Decimal] = {}
    for line in lines:
        if not _authored_cost_line_matches(rule, line):
            continue
        amount = Decimal(line["amount_local"]) * split
        captured += amount
        count += 1
        prov = line["provider_entity_id"]
        by_entity[prov] = by_entity.get(prov, ZERO) + amount
    return {
        "captured_amount": str(captured),
        "line_count": count,
        "by_entity": {k: str(v) for k, v in sorted(by_entity.items())},
    }


def _parse_split_pct(raw: Any) -> Decimal:
    """A capture rule's optional ``split_pct`` as a Decimal in (0, 1]. Absent =
    full capture (1). NEVER silently defaulted to a bad value: a present but
    out-of-range / malformed split raises (BLOCK, not a default)."""
    if raw is None:
        return Decimal("1")
    try:
        split = Decimal(str(raw))
    except Exception as exc:  # noqa: BLE001 — surface as a domain error
        raise ValueError(f"cost_capture_rule.split_pct malformed: {raw!r}") from exc
    if not (ZERO < split <= Decimal("1")):
        raise ValueError(
            f"cost_capture_rule.split_pct must be in (0, 1], got {split}")
    return split


def _authored_key_factor_values(
    key_factor: str, beneficiaries: list[str], year: int,
) -> dict[str, Decimal]:
    """Factor value per beneficiary for the authored key (the engine recomputes
    the total — V-K3). ``Equal`` = 1 each; ``Revenue`` / ``Cost`` come from
    ``segment_pl`` per beneficiary (the same warehouse P&L the demo reads). A
    beneficiary with NO warehouse row is NOT silently zeroed — it is omitted
    here so Stage 4's V-K1 BLOCK fires (a missing key value is never a zero)."""
    if key_factor not in AUTHORED_KEY_FACTORS:
        raise ValueError(
            f"key_factor must be one of {AUTHORED_KEY_FACTORS}, got {key_factor!r}")
    if key_factor == "Equal":
        return {b: Decimal("1") for b in beneficiaries}
    from calc import warehouse  # local import: warehouse needs duckdb (heavy)

    measure = ("revenue" if key_factor == "Revenue"
               else (_SEGMENT_PL_COST_EXPR, "factor"))
    alias = "revenue" if key_factor == "Revenue" else "factor"
    ph = ",".join("?" for _ in beneficiaries)
    rows = warehouse.aggregate(
        "segment_pl", ["RBUKRS"], [measure], year=year,
        where=f"RBUKRS IN ({ph})", params=list(beneficiaries),
    )
    out: dict[str, Decimal] = {}
    for r in rows:
        val = r.get(alias)
        if val is None:
            continue
        out[str(r["RBUKRS"])] = Decimal(str(val))
    return out


def build_authored_overlay(
    pool: Mapping[str, Any], *, periods: list[str],
    source: str = "actual", dataset: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble a minimal, self-contained engine dataset for ONE authored pool.

    Derives, from the authoring ``definition`` and the demo cost lines:
      * the matched cost lines (capture rule), with their ``pool_id`` OVERRIDDEN
        to the authored pool id and amounts scaled by ``split_pct`` if set;
      * a ``cc_mapping`` row per distinct (company_code, cost_center) in the
        matched set, split 1.0 to the authored pool (V-P1/V-P2 satisfied);
      * a single 3_Pool row for the authored pool;
      * participation (provider + beneficiaries) and key values computed from
        the chosen key factor (the engine recomputes the total — V-K3);
      * markup policies + exclusions exactly as authored.

    The result plugs straight into ``_execute_period`` — no special-casing in
    the stages. Reuses the demo ``entities`` (jurisdiction / currency / dating).
    Raises (BLOCK) on a structurally impossible pool (no provider, missing
    markup, etc.) — never silently defaults."""
    dataset = dataset or load_demo_dataset()
    definition = pool["definition"] if "definition" in pool else pool
    pool_id = pool.get("pool_id") or pool.get("id")
    if not pool_id:
        raise ValueError("authored pool overlay needs a pool id")
    provider = definition.get("provider_entity_id")
    if not provider:
        raise ValueError(f"authored pool {pool_id}: provider_entity_id is required")
    service_line = definition.get("service_line")
    characterization = definition.get("characterization")
    cost_base = definition.get("cost_base_definition")
    capture = definition.get("cost_capture_rule") or {}
    beneficiaries = list(definition.get("beneficiaries") or [])
    if not beneficiaries:
        raise ValueError(f"authored pool {pool_id}: at least one beneficiary is required")
    key = definition.get("key") or {}
    key_factor = key.get("key_factor")
    split = _parse_split_pct(capture.get("split_pct"))

    period_set = set(periods)
    src_lines = dataset["cost_lines"][source]
    matched: list[dict] = []
    cc_keys: dict[tuple[str, str], dict] = {}
    for line in src_lines:
        if line.get("fiscal_period") not in period_set:
            continue
        if not _authored_cost_line_matches(capture, line):
            continue
        row = dict(line)
        # Override the pool assignment (strip the governed pool_id) and scale
        # by split_pct. amount stays an exact decimal string.
        amt = Decimal(line["amount_local"]) * split
        row["amount_local"] = str(amt.quantize(Decimal("0.01")))
        row["pool_id"] = pool_id
        # Unique cost_line_id within the authored overlay (avoid colliding with
        # the governed line's id if both ever share a DB — overlay runs are
        # isolated, but keep ids stable + distinct).
        row["cost_line_id"] = f"AP::{pool_id}::{line['cost_line_id']}"
        row["source_document_ref"] = f"AP::{pool_id}::{line.get('source_document_ref') or line['cost_line_id']}"
        matched.append(row)
        cc_keys.setdefault((line["company_code"], line["cost_center"]),
                           {"company_code": line["company_code"],
                            "cost_center": line["cost_center"]})

    # cc_mapping: every matched cost center maps 1.0 to the authored pool.
    cc_mapping = []
    for (company, cc) in sorted(cc_keys):
        cc_mapping.append({
            "mapping_id": f"MAP-AP-{pool_id}-{cc}",
            "company_code": company,
            "cost_center": cc,
            "service_line_id": pool_id,
            "function": service_line,
            "allocation_split_pct": "1",
            "effective_from": "2026-01-01",
            "effective_to": "2026-12-31",
            "version": 1,
            "owner": "authored",
            "rationale": f"Authored pool {pool_id}: cost center captured 100% into the pool.",
        })

    pool_row = {
        "pool_id": pool_id,
        "pool_name": pool.get("name") or definition.get("name") or pool_id,
        "service_line": service_line,
        "service_description": definition.get("service_description")
        or f"Authored pool {pool_id}.",
        "provider_entity_id": provider,
        "characterization": characterization,
        "core_or_support": "Support",
        "unique_intangible_flag": False,
        "significant_risk_flag": False,
        "cost_base_definition": cost_base,
        "default_key_id": f"KEY-AP-{pool_id}",
        "direct_charge_flag": False,
        "documentation_ref": f"DOC/AP/{pool_id}",
        "effective_from": "2026-01-01",
        "effective_to": "2026-12-31",
        "status": "Active",
    }

    key_def = {
        "key_id": f"KEY-AP-{pool_id}",
        "key_name": f"{key_factor} key (authored {pool_id})",
        "key_factor": _SCHEMA_KEY_FACTOR.get(key_factor, "Other"),
        "source_system": "Authored (Allocation Pool Builder)",
        "static_or_dynamic": "Dynamic",
        "description": f"Authored allocation key: {key_factor} per beneficiary.",
        "owner": "authored",
    }

    # participation: one Provider row + one Beneficiary row per beneficiary.
    participation = [{
        "participation_id": f"PP-AP-{pool_id}-{provider}",
        "pool_id": pool_id, "entity_id": provider, "role": "Provider",
        "effective_from": "2026-01-01",
    }]
    for b in beneficiaries:
        participation.append({
            "participation_id": f"PP-AP-{pool_id}-{b}",
            "pool_id": pool_id, "entity_id": b, "role": "Beneficiary",
            "benefit_rationale": f"Authored beneficiary of pool {pool_id}.",
            "effective_from": "2026-01-01",
        })

    # key values per period: factor per beneficiary from the chosen key factor;
    # the engine recomputes the total over the resolved population (V-K3), so we
    # emit a per-period total = Σ factor over the SAME beneficiary set.
    year = int(str(periods[0])[:4]) if periods else 2026
    factors = _authored_key_factor_values(key_factor, beneficiaries, year)
    key_values: list[dict] = []
    for per in sorted(period_set):
        total = sum((factors.get(b, ZERO) for b in beneficiaries), ZERO)
        for b in beneficiaries:
            fv = factors.get(b)
            if fv is None:
                continue  # omit -> Stage-4 V-K1 BLOCK (never a silent zero)
            ratio = (fv / total) if total > ZERO else ZERO
            key_values.append({
                "key_value_id": f"KV-AP-{pool_id}-{b}-{per}",
                "key_id": f"KEY-AP-{pool_id}",
                "pool_id": pool_id,
                "recipient_entity_id": b,
                "period": per,
                "factor_value": str(fv),
                "total_factor_value": str(total),
                "allocation_ratio": str(ratio),
                "as_of_date": _month_end(per),
                "source_ref": f"authored:{key_factor}:{b}:{per}",
            })

    # markup policies: per (jurisdiction, regime, pct) as authored. No silent
    # default — a beneficiary jurisdiction with no policy will hit V-M1 BLOCK.
    markup_policies = []
    for i, mp in enumerate(definition.get("markup_policies") or []):
        jur = mp.get("jurisdiction")
        regime = mp.get("regime")
        pct = mp.get("markup_pct")
        if jur is None or regime is None or pct is None:
            raise ValueError(
                f"authored pool {pool_id}: markup policy {i} needs jurisdiction, "
                "regime and markup_pct")
        markup_policies.append({
            "markup_policy_id": f"MP-AP-{pool_id}-{jur}-{i}",
            "pool_id": pool_id,
            "jurisdiction": str(jur),
            "regime": str(regime),
            "markup_pct": str(pct),
            "scm_eligibility_basis": mp.get("scm_eligibility_basis") or "n/a",
            "benchmark_study_ref": mp.get("benchmark_study_ref")
            or f"BM-AP-{pool_id}-{jur}",
            "effective_from": "2026-01-01",
            "effective_to": "2026-12-31",
        })

    # exclusions exactly as authored (pct OR amount; V-B3 needs exactly one).
    exclusions = []
    for i, ex in enumerate(definition.get("exclusions") or []):
        row: dict[str, Any] = {
            "exclusion_id": f"EX-AP-{pool_id}-{i}",
            "pool_id": pool_id,
            "exclusion_type": ex.get("exclusion_type") or "Stewardship",
            "basis_rationale": ex.get("basis_rationale") or "",
            "effective_from": "2026-01-01",
            "effective_to": "2026-12-31",
            "owner": "authored",
        }
        if ex.get("amount") is not None:
            row["exclusion_amount"] = str(ex["amount"])
        if ex.get("pct") is not None:
            row["exclusion_pct"] = str(ex["pct"])
        exclusions.append(row)

    return {
        "entities": dataset["entities"],
        "cc_mapping": cc_mapping,
        "pools": [pool_row],
        "markup_policies": markup_policies,
        "exclusions": exclusions,
        "key_defs": [key_def],
        "participation": participation,
        "cost_lines": {source: matched, "budget": []},
        "key_values": {source: key_values, "budget": []},
        "fx_rates": [],
        "trueup_fx_rates": [],
        "tax_rules": [],
        "received_charge_lineage": {},
        "prior_year_keys": {},
    }


def _month_end(period: str) -> str:
    import calendar
    if len(str(period)) == 4:
        return f"{period}-12-31"
    y, m = int(str(period)[:4]), int(str(period)[5:7])
    return f"{y:04d}-{m:02d}-{calendar.monthrange(y, m)[1]:02d}"


def authored_pool_periods(
    definition: Mapping[str, Any], *, source: str = "actual",
    dataset: Mapping[str, Any] | None = None,
) -> list[str]:
    """The billing periods an authored pool's capture rule touches (the
    distinct fiscal periods of the matched cost lines), ascending."""
    dataset = dataset or load_demo_dataset()
    capture = definition.get("cost_capture_rule") or {}
    return sorted({
        str(line["fiscal_period"])
        for line in dataset["cost_lines"][source]
        if _authored_cost_line_matches(capture, line)
    })


def dry_run_authored_pool(
    definition: Mapping[str, Any], *, pool_id: str = "AP-DRYRUN",
    name: str | None = None, source: str = "actual",
    dataset: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Run ONE authored pool through Stages 1-7 in isolation (no persist) for
    every period its capture rule touches. Returns charges / recon / exceptions
    / trace — the Builder's "Test run" surface. The engine invariant holds, so
    a structurally-sound pool reconciles to zero residual; a missing markup
    policy / participation gap surfaces as the corresponding V-rule.

    A pool whose capture rule matches NO cost lines is a domain error (nothing
    to charge) — reported as an empty-capture block, never a silent success."""
    dataset = dataset or load_demo_dataset()
    periods = authored_pool_periods(definition, source=source, dataset=dataset)
    if not periods:
        return {
            "pool_id": pool_id, "periods": [], "charges": [],
            "recon": [], "exceptions": [{
                "rule_id": "V-P1", "severity": "BLOCK",
                "message": (f"authored pool {pool_id}: cost-capture rule matches "
                            "no cost lines — nothing to pool"),
                "objects": [pool_id], "pool_id": pool_id,
            }], "trace": [], "balanced": False, "total_charged_out": "0",
        }
    cfg = {**DEFAULT_CONFIG, "scope": {}}
    pool_obj = {"pool_id": pool_id, "name": name or pool_id, "definition": definition}
    overlay = build_authored_overlay(
        pool_obj, periods=periods, source=source, dataset=dataset)

    all_charges: list[dict] = []
    all_recon: list[dict] = []
    exceptions: list[dict] = []
    with trace.collect() as steps:
        for per in periods:
            ex = _execute_period(overlay, per, source, cfg)
            s6 = stage6_chargeout(
                {"charges": ex["charges5"]},
                {"entities": overlay["entities"],
                 "fx_rates": [], "tax_rules": []},
                {**cfg, "period": per})
            s7 = stage7_reconcile({"pools": ex["pools5"]}, {}, {**cfg, "period": per})
            exceptions.extend(ex["exceptions"] + s6["exceptions"] + s7["exceptions"])
            all_charges.extend(s6["outputs"]["charges"])
            all_recon.extend(s7["outputs"]["recon"])
            trace.emit("authored_period", period=per,
                       charges=len(s6["outputs"]["charges"]),
                       pools=len(s7["outputs"]["recon"]))

    balanced = bool(all_recon) and all(
        r["recon_status"] == "Balanced" for r in all_recon)
    total = sum((Decimal(str(r["total_charged_out"])) for r in all_recon), ZERO)
    return {
        "pool_id": pool_id,
        "periods": periods,
        "charges": [_strs(c) for c in all_charges],
        "recon": [_strs(r) for r in all_recon],
        "exceptions": exceptions,
        "trace": list(steps),
        "balanced": balanced,
        "total_charged_out": str(total),
    }


def run_authored_allocation(
    *, period: str, actor: str, source: str = "actual",
    pools: list[Mapping[str, Any]] | None = None,
    dataset: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Launch an ACTUAL run that overlays the supplied ACTIVE authored pools for
    one period, persisted + flagged authored. Each active authored pool whose
    capture rule touches ``period`` runs through Stages 1-7 on its own minimal
    overlay; the resulting charges/recon/exceptions are aggregated and persisted
    as ONE authored run (``run_type="actual"``, ``config.authored = True``).
    The governed run is untouched — authored runs are namespaced + flagged."""
    if pools is None:
        import state.authored_pools as authored_pools
        pools = [p for p in authored_pools.list_authored_pools(status="active")]
    dataset = dataset or load_demo_dataset()
    period = str(period)
    period_bounds(period)
    cfg = {**DEFAULT_CONFIG, "scope": {}, "authored": True}

    engine_charges: list[dict] = []
    recon_engine: list[dict] = []
    exceptions: list[dict] = []
    line_rows: dict[str, dict] = {}
    pools5: list[dict] = []
    exclusion_ledger: list[dict] = []
    lineage6: list[dict] = []
    in_scope_pool_ids: list[str] = []

    for pool in pools:
        definition = pool.get("definition") or pool
        pool_id = pool.get("id") or pool.get("pool_id")
        periods = authored_pool_periods(definition, source=source, dataset=dataset)
        if period not in periods:
            continue
        in_scope_pool_ids.append(pool_id)
        overlay = build_authored_overlay(
            {"pool_id": pool_id, "name": pool.get("name"), "definition": definition},
            periods=[period], source=source, dataset=dataset)
        ex = _execute_period(overlay, period, source, cfg)
        s6 = stage6_chargeout(
            {"charges": ex["charges5"]},
            {"entities": overlay["entities"], "fx_rates": [], "tax_rules": []},
            {**cfg, "period": period})
        s7 = stage7_reconcile({"pools": ex["pools5"]}, {}, {**cfg, "period": period})
        exceptions.extend(ex["exceptions"] + s6["exceptions"] + s7["exceptions"])
        engine_charges.extend(s6["outputs"]["charges"])
        recon_engine.extend(s7["outputs"]["recon"])
        pools5.extend(ex["pools5"])
        exclusion_ledger.extend(ex["s3"]["outputs"]["exclusion_ledger"])
        lineage6.extend(s6["outputs"]["lineage"])
        line_rows.update(ex["line_rows"])

    output_hash = _sha256({
        "charges": engine_charges, "true_up_rows": [],
        "recon": [_strs(r) for r in recon_engine], "exceptions": exceptions,
    })
    input_hash = _sha256({"authored_pools": sorted(in_scope_pool_ids),
                          "period": period, "source": source})

    run_id = store.new_run_id(period, "actual")
    store.insert_run(
        run_id=run_id, period=period, run_type="actual",
        input_snapshot_hash=input_hash,
        scope={"authored_pool_ids": in_scope_pool_ids},
        config={k: v for k, v in cfg.items() if k != "scope"})

    report = docpack.build_exception_report(exceptions, run_id=run_id, period=period)
    blocks = rules.blocks(exceptions)
    if blocks:
        run = store.persist_run_failure(run_id, artifacts=[
            _json_artifact("exceptions.json", report),
            _artifact("output.sha256", "text/plain", output_hash)])
        summary = {
            "run_id": run_id, "period": period, "run_type": "actual",
            "authored": True, "status": "failed", "charges": 0,
            "recon_balanced": False, "blocks": len(blocks),
            "warns": report["counts"]["WARN"], "total_charged_out": "0",
            "output_hash": output_hash, "authored_pool_ids": in_scope_pool_ids,
        }
        audit.record(actor=actor, actor_kind="human",
                     record_ref=f"allocation:{run_id}", process_id=PROCESS_ID,
                     event_type="run", after=summary,
                     rationale="authored allocation run failed: BLOCK exceptions")
        return {**run, "summary": summary,
                "recon": [_strs(r) for r in recon_engine],
                "exception_report": report,
                "artifacts": ["exceptions.json", "output.sha256"]}

    persisted_charges = [{**row,
                          "charge_id": f"{run_id}:{row['charge_id']}",
                          "documentation_ref": run_id}
                         for row in engine_charges]
    run_row = store.get_run(run_id)
    started_at = run_row["started_at"] if run_row else ""
    recon_rows = [{
        **_strs({k: v for k, v in r.items() if v is not None}),
        "recon_id": f"RECON-{run_id}-{r['pool_id']}",
        "run_id": run_id, "run_timestamp": started_at,
    } for r in recon_engine]

    lineage_obj: dict[str, Any] = {"charges": {}, "lines": {}}
    for entry in lineage6:
        pid = f"{run_id}:{entry['charge_id']}"
        lineage_obj["charges"][pid] = {
            "pool_id": entry["pool_id"], "charge_kind": entry["charge_kind"],
            "key_value_id": entry.get("key_value_id"),
            "line_ids": list(entry.get("line_ids") or ())}
        for lid in entry.get("line_ids") or ():
            if lid in line_rows:
                lineage_obj["lines"][lid] = line_rows[lid]

    balanced_all = bool(recon_engine) and all(
        r["recon_status"] == "Balanced" for r in recon_engine)
    summary = {
        "run_id": run_id, "period": period, "run_type": "actual",
        "authored": True, "status": "succeeded", "pools": len(recon_engine),
        "charges": len(persisted_charges), "recon_balanced": balanced_all,
        "total_charged_out": str(sum(
            (Decimal(r["total_charged_out"]) for r in recon_rows), ZERO)),
        "blocks": 0, "warns": report["counts"]["WARN"],
        "output_hash": output_hash, "input_snapshot_hash": input_hash,
        "authored_pool_ids": in_scope_pool_ids,
    }
    artifacts = [
        _json_artifact("exceptions.json", report),
        _artifact("output.sha256", "text/plain", output_hash),
        _json_artifact("lineage.json", lineage_obj),
        _json_artifact("summary.json", summary),
    ]
    run = store.persist_run_success(
        run_id, charges=persisted_charges, recon_rows=recon_rows,
        artifacts=artifacts)
    audit.record(actor=actor, actor_kind="human",
                 record_ref=f"allocation:{run_id}", process_id=PROCESS_ID,
                 event_type="run", after=summary,
                 rationale=f"authored allocation run — {len(in_scope_pool_ids)} "
                           "active authored pool(s) overlaid in isolation")
    return {**run, "summary": summary,
            "recon": [_strs(r) for r in recon_rows],
            "exception_report": report,
            "artifacts": [a["name"] for a in artifacts]}
