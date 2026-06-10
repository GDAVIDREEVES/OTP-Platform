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
