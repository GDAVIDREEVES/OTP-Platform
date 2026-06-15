"""TP calculation waterfall orchestrator (Phase 5 W1 — Author & Apply).

Charges must be computed and APPLIED to each entity / entity-function P&L
before TP decisions (monitoring OTP-20, adjustments OTP-16, goods pricing
OTP-1/2). This module runs the ordered charge sequence — default

    service_allocation -> royalties -> csa_true_up -> profit_split

— executing each step's UNDERLYING engine/calc and mapping its output to
DOUBLE-ENTRY overlay lines on the append-only ``pl_overlays`` ledger
(state/pl_overlays.py): per charge the provider books revenue+ and the
recipient cost+ for the same amount, so the group nets to ZERO by
construction (test-enforced).

Step sources (every amount is Decimal end to end — no float arithmetic):

- ``service_allocation`` — launches REAL allocation engine runs
  (services/allocation_runner.py, run_type "actual") for every billing
  period of the year in the demo dataset, then maps the persisted charge
  ledger rows (gross_charge_amount) to overlay lines. source_ref =
  ``charge:{charge_id}`` — drillable via /api/allocation/charges/{id}/lineage.
- ``royalties`` — FY royalty fees per (licensor, licensee) pair from the
  warehouse (``supply_chain`` MATERIAL_TYPE='ROYALTY'), the exact source
  behind /api/transactions/royalties. DuckDB DECIMAL stays Decimal.
- ``csa_true_up`` — the OTP-11 CSA true-ups from routers/csa.py:csa():
  a positive true_up pays INTO the pool (cost+), a negative one receives
  (revenue+). Σ true_up == 0 by construction.
- ``profit_split`` — the OTP-12/44 residual split from
  routers/csa.py:profit_split(): a positive true_up is owed residual profit
  (revenue+), a negative one pays it away (cost+). Σ true_up == 0.

Run mechanics: a run is recorded in ``waterfall_runs`` ('running'); ALL step
line-sets are built and zero-net-checked BEFORE anything is applied; any
failure marks the run 'failed' with nothing on the overlay ledger. Applying
a new run first reverses the prior applied run's lines (reversing rows) and
marks it 'superseded', so EXACTLY ONE waterfall is applied at a time and
/api/pl/adjusted never double-counts. Rollback = reversing rows + status
'rolled_back'. Every run is audited at record_ref="waterfall:{run_id}".

EXISTING ENDPOINTS ARE UNTOUCHED: nothing here writes segment_pl, and
/api/segments/pl + /api/margins/trend never read the overlay ledger —
byte-identical non-regression is golden-gated in tests/test_waterfall.py.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Callable

import services.allocation_runner as allocation_runner
import state.allocation_store as allocation_store
import state.audit as audit
import state.pl_overlays as pl_overlays
from calc import trace
from db import q
from routers.csa import csa, profit_split

ZERO = Decimal("0")
CENT = Decimal("0.01")

PROCESS_ID = pl_overlays.PROCESS_ID  # OTP-21 — segmented financials

DEFAULT_STEPS = ("service_allocation", "royalties", "csa_true_up", "profit_split")

STEP_LABELS = {
    "service_allocation": "Service cost allocation (OTP-10 engine, actual runs)",
    "royalties": "Royalty charges (OTP-44 register)",
    "csa_true_up": "CSA true-up (OTP-11)",
    "profit_split": "Residual profit split (OTP-12)",
}


def _role_map() -> dict[str, str]:
    """RBUKRS -> ROLE_CODE from segment_pl (each demo entity has exactly one
    function); overlay lines carry it so the entity_function grain works."""
    rows = q("SELECT DISTINCT RBUKRS, ROLE_CODE FROM segment_pl")
    return {str(r["RBUKRS"]): r["ROLE_CODE"] for r in rows}


def _line(
    *, entity: str, function: str | None, period: str, line_kind: str,
    side: str, amount: Decimal, source_ref: str,
) -> dict[str, Any]:
    return {"entity": entity, "function": function, "period": period,
            "line_kind": line_kind, "side": side, "amount": amount,
            "source_ref": source_ref}


# ------------------------------------------------------------ step builders --


def _service_allocation_lines(
    year: int, actor: str
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Run the allocation engine (actual) for every billing period of the
    year and map the persisted charge ledger rows to double-entry lines."""
    dataset = allocation_runner.load_demo_dataset()
    periods = sorted({
        str(r["fiscal_period"]) for r in dataset["cost_lines"]["actual"]
        if str(r["fiscal_period"]).startswith(str(year))})
    if not periods:
        raise ValueError(f"no actual billing periods for {year} in the "
                         "allocation dataset")
    roles = _role_map()
    lines: list[dict[str, Any]] = []
    run_ids: list[str] = []
    for period in periods:
        res = allocation_runner.run_allocation(
            period=period, run_type="actual", actor=actor)
        if res["status"] != "succeeded":
            raise ValueError(
                f"allocation run for {period} failed "
                f"({res['run_id']}): BLOCK exceptions withheld its charges")
        run_ids.append(res["run_id"])
        for charge in allocation_store.list_charges(run_id=res["run_id"]):
            gross = Decimal(charge["gross_charge_amount"])
            ref = f"charge:{charge['charge_id']}"
            for entity, side in ((charge["provider_entity_id"], "revenue"),
                                 (charge["recipient_entity_id"], "cost")):
                lines.append(_line(
                    entity=entity, function=roles.get(entity),
                    period=str(charge["period"]), line_kind="service_charge",
                    side=side, amount=gross, source_ref=ref))
    return lines, {"allocation_run_ids": run_ids, "billing_periods": periods}


def _royalty_lines(
    year: int, actor: str
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """FY royalty fees per (licensor, licensee) pair from the warehouse —
    licensor revenue+ / licensee cost+."""
    rows = q(
        "SELECT SELLING_COMPANY, BUYING_COMPANY, SUM(TOTAL_LEGAL_PRICE) AS fees "
        "FROM supply_chain WHERE MATERIAL_TYPE = 'ROYALTY' AND GJAHR = ? "
        "GROUP BY 1, 2 ORDER BY 1, 2",
        [year],
    )
    roles = _role_map()
    lines: list[dict[str, Any]] = []
    for r in rows:
        fees = Decimal(str(r["fees"]))
        if fees == ZERO:
            continue
        if fees < ZERO:
            raise ValueError(
                f"negative royalty fees for {r['SELLING_COMPANY']}->"
                f"{r['BUYING_COMPANY']}: {fees}")
        licensor, licensee = str(r["SELLING_COMPANY"]), str(r["BUYING_COMPANY"])
        ref = f"royalty:{year}:{licensor}->{licensee}"
        for entity, side in ((licensor, "revenue"), (licensee, "cost")):
            lines.append(_line(
                entity=entity, function=roles.get(entity), period=str(year),
                line_kind="royalty", side=side, amount=fees, source_ref=ref))
    return lines, {"pairs": len(rows)}


def _true_up_lines(
    participants: list[dict[str, Any]], *, year: int, line_kind: str,
    positive_side: str, source_prefix: str, roles: dict[str, str],
) -> list[dict[str, Any]]:
    """Map a calc's zero-sum true_up column to overlay lines.

    ``positive_side`` is the P&L side a POSITIVE true_up books to ('cost' for
    the CSA — pays into the pool; 'revenue' for the profit split — is owed
    residual profit); a negative true_up books the opposite side. The set
    must net to zero — enforced centrally by run_waterfall().
    """
    other = "revenue" if positive_side == "cost" else "cost"
    lines: list[dict[str, Any]] = []
    for p in participants:
        t = Decimal(str(p["true_up"])).quantize(CENT)
        if t == ZERO:
            continue
        side = positive_side if t > ZERO else other
        lines.append(_line(
            entity=p["rbukrs"], function=roles.get(p["rbukrs"]),
            period=str(year), line_kind=line_kind, side=side, amount=abs(t),
            source_ref=f"{source_prefix}:{year}:{p['rbukrs']}"))
    return lines


def _csa_true_up_lines(
    year: int, actor: str
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    out = csa(year=year)
    lines = _true_up_lines(
        out["participants"], year=year, line_kind="csa_true_up",
        positive_side="cost", source_prefix="csa", roles=_role_map())
    return lines, {"participants": len(out["participants"]),
                   "pool": out["pool"]}


def _profit_split_lines(
    year: int, actor: str
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    out = profit_split(year=year)
    lines = _true_up_lines(
        out["participants"], year=year, line_kind="profit_split",
        positive_side="revenue", source_prefix="profit_split",
        roles=_role_map())
    return lines, {"participants": len(out["participants"]),
                   "key": out["key"], "combined_profit": out["combined_profit"]}


_BUILDERS: dict[str, Callable[[int, str], tuple[list[dict], dict]]] = {
    "service_allocation": _service_allocation_lines,
    "royalties": _royalty_lines,
    "csa_true_up": _csa_true_up_lines,
    "profit_split": _profit_split_lines,
}


# -------------------------------------------------------------- run / rollback --


def _totals(lines: list[dict[str, Any]]) -> tuple[Decimal, Decimal]:
    revenue = sum((l["amount"] for l in lines if l["side"] == "revenue"), ZERO)
    cost = sum((l["amount"] for l in lines if l["side"] == "cost"), ZERO)
    return revenue, cost


def run_waterfall(
    *, actor: str, year: int = 2026, steps: list[str] | None = None
) -> dict[str, Any]:
    """Launch one waterfall run end to end and return the run record.

    ALL step line-sets are built and zero-net-checked before anything touches
    the overlay ledger; a build failure is a recorded 'failed' run with
    nothing applied. On success the prior applied run (if any) is superseded
    (its lines reversed) and the new lines append step by step.
    """
    step_ids = list(steps) if steps else list(DEFAULT_STEPS)
    unknown = [s for s in step_ids if s not in _BUILDERS]
    if unknown:
        raise ValueError(f"unknown waterfall steps: {unknown}; "
                         f"known: {sorted(_BUILDERS)}")
    if len(set(step_ids)) != len(step_ids):
        raise ValueError(f"duplicate waterfall steps: {step_ids}")

    run = pl_overlays.insert_run(year=year, steps=step_ids, actor=actor)
    run_id = run["id"]

    # ---- build phase: execute every underlying engine/calc, net-check -------
    built: list[tuple[str, list[dict[str, Any]], dict[str, Any]]] = []
    try:
        for sid in step_ids:
            lines, detail = _BUILDERS[sid](year, actor)
            revenue, cost = _totals(lines)
            if revenue - cost != ZERO:
                raise ValueError(
                    f"step {sid!r} does not net to zero: revenue {revenue} "
                    f"vs cost {cost} — refusing to apply")
            trace.emit("stage", stage=sid, label=STEP_LABELS[sid],
                       values={"lines": len(lines), "revenue_total": str(revenue),
                               "cost_total": str(cost)})
            built.append((sid, lines, detail))
    except Exception as e:
        summaries = [{"id": sid, "status": "built", "lines": len(lines)}
                     for sid, lines, _ in built]
        failed_idx = len(built)
        for i, sid in enumerate(step_ids):
            if i == failed_idx:
                summaries.append({"id": sid, "status": "failed", "error": str(e)})
            elif i > failed_idx:
                summaries.append({"id": sid, "status": "pending"})
        run = pl_overlays.finish_run(run_id, status="failed",
                                     steps=summaries, error=str(e))
        audit.record(
            actor=actor, actor_kind="human",
            process_id=PROCESS_ID, record_ref=f"waterfall:{run_id}",
            event_type="run",
            after={"id": run_id, "year": year, "status": "failed",
                   "steps": step_ids},
            rationale=f"waterfall run failed during build: {e}")
        return run

    # ---- apply phase: supersede the prior applied run, then append ----------
    for prior in pl_overlays.list_runs(status="applied"):
        pl_overlays.reverse_run_lines(
            prior["id"], actor=actor,
            rationale=f"superseded by waterfall run {run_id}")
        pl_overlays.set_run_status(prior["id"], "superseded")
        audit.record(
            actor=actor, actor_kind="human",
            process_id=PROCESS_ID, record_ref=f"waterfall:{prior['id']}",
            event_type="reversed",
            rationale=f"superseded by waterfall run {run_id}")

    summaries = []
    total_lines = 0
    try:
        for sid, lines, detail in built:
            stored = pl_overlays.append_lines(
                lines, waterfall_run_id=run_id, step=sid, actor=actor)
            revenue, cost = _totals(lines)
            total_lines += len(stored)
            summaries.append({
                "id": sid, "label": STEP_LABELS[sid], "status": "applied",
                "lines": len(stored), "revenue_total": str(revenue),
                "cost_total": str(cost), "net": str(revenue - cost), **detail,
            })
    except Exception as e:  # pragma: no cover — lines are pre-validated
        pl_overlays.reverse_run_lines(
            run_id, actor=actor, rationale=f"apply failed: {e}")
        run = pl_overlays.finish_run(run_id, status="failed",
                                     steps=summaries, error=str(e))
        audit.record(
            actor=actor, actor_kind="human",
            process_id=PROCESS_ID, record_ref=f"waterfall:{run_id}",
            event_type="run",
            after={"id": run_id, "year": year, "status": "failed"},
            rationale=f"waterfall apply failed and was reversed: {e}")
        return run

    run = pl_overlays.finish_run(run_id, status="applied", steps=summaries)
    audit.record(
        actor=actor, actor_kind="human",
        process_id=PROCESS_ID, record_ref=f"waterfall:{run_id}",
        event_type="run",
        after={"id": run_id, "year": year, "status": "applied",
               "steps": [s["id"] for s in summaries], "lines": total_lines,
               "group_net": "0"})
    return run


def rollback(run_id: str, *, actor: str) -> dict[str, Any]:
    """Roll back an applied run: one reversing row per overlay line (the
    ledger stays append-only) + status 'rolled_back'. Only an applied run can
    roll back — a second rollback raises."""
    run = pl_overlays.get_run(run_id)
    if run is None:
        raise ValueError(f"unknown waterfall run: {run_id}")
    if run["status"] != "applied":
        raise ValueError(
            f"only an applied run can be rolled back; {run_id} is "
            f"{run['status']}")
    reversed_lines = pl_overlays.reverse_run_lines(
        run_id, actor=actor, rationale=f"rollback of waterfall run {run_id}")
    run = pl_overlays.set_run_status(run_id, "rolled_back")
    audit.record(
        actor=actor, actor_kind="human",
        process_id=PROCESS_ID, record_ref=f"waterfall:{run_id}",
        event_type="reversed",
        after={"id": run_id, "status": "rolled_back",
               "reversed_lines": len(reversed_lines)},
        rationale=f"rollback of waterfall run {run_id}")
    return {**run, "reversed_lines": len(reversed_lines)}
