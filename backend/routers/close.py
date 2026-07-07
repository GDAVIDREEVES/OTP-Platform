"""Close Command Center — read-only close-status aggregator.

Like routers/worklist.py this owns no store of its own: it composes the
signals the platform already keeps into one ordered 8-step close sequence
(master data -> price setting -> charge & allocate -> waterfall -> monitor
-> adjust -> review -> document). Every signal comes from an existing
list/get function — this module NEVER runs an engine, never mutates state
and never writes an audit event; building the status is observation only.

Step statuses:
- complete  — nothing left to do here
- active    — routine work in flight (the normal "you are here")
- attention — something is off and needs a human (out-of-range parties,
              approvals waiting on YOU, an applied/basis mismatch)
- pending   — not started yet

``current_index`` is the index of the first non-complete step; when every
step is complete the close is done and it points at the final step.

Every value in a step's ``counts`` is an int — the frontend renders them as
badges, so booleans are encoded 1/0 (the raw bool lives in ``basis``).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

import persistence.overrides as overrides
import services.post_charge as post_charge
import state.allocation_store as allocation_store
import state.cases as cases
import state.drafts as drafts
import state.master_data as master_data
import state.parameters as parameters
import state.review as review
from routers.kpis import kpis

router = APIRouter()

#: OTP-1..OTP-8 — the price-setting processes step 2 watches.
_PRICE_PROCESSES = frozenset(f"OTP-{i}" for i in range(1, 9))
#: Staging items still on someone's plate (applied/rejected ones are done).
_OPEN_STAGING = ("unmapped", "proposed", "in_review")


def _step(
    *, step_id: str, label: str, status: str, owner: str, route: str,
    counts: dict[str, Any], detail: str,
) -> dict[str, Any]:
    return {"id": step_id, "label": label, "status": status, "owner": owner,
            "route": route, "counts": counts, "detail": detail}


def _plural(n: int, noun: str, plural: str | None = None) -> str:
    """"1 draft" / "2 drafts"; irregular nouns pass their plural explicitly
    ("6 tested parties", never "6 tested partys")."""
    return f"{n} {noun if n == 1 else (plural or noun + 's')}"


def _master_data_step() -> dict[str, Any]:
    n = sum(1 for i in master_data.list_staging() if i["status"] in _OPEN_STAGING)
    return _step(
        step_id="master_data", label="Master data",
        status="active" if n else "complete",
        owner="operator", route="/master-data", counts={"open": n},
        detail=(f"{_plural(n, 'inbound item')} awaiting mapping" if n
                else "All inbound master data mapped"),
    )


def _price_setting_step(
    user: str, pending_reviews: list[dict[str, Any]]
) -> dict[str, Any]:
    pending = sum(1 for it in pending_reviews
                  if it["process_id"] in _PRICE_PROCESSES)
    open_drafts = sum(1 for d in drafts.list_for_user(user)
                      if d["process_id"] in _PRICE_PROCESSES)
    n = pending + open_drafts
    return _step(
        step_id="price_setting", label="Price setting",
        status="active" if n else "complete",
        owner="operator", route="/process/OTP-3/overview",
        counts={"pending_reviews": pending, "drafts": open_drafts},
        detail=(f"{_plural(pending, 'price submission')} in review, "
                f"{_plural(open_drafts, 'draft')} in progress" if n
                else "Prices set — nothing in flight"),
    )


def _charges_step(year: int) -> dict[str, Any]:
    runs = [r for r in allocation_store.list_runs()
            if r["run_type"] == "actual" and str(r["period"]).startswith(str(year))]
    succeeded = sum(1 for r in runs if r["status"] == "succeeded")
    running = sum(1 for r in runs if r["status"] == "running")
    if succeeded:
        status, detail = "complete", f"{_plural(succeeded, 'actual allocation run')} succeeded"
    elif running:
        status, detail = "active", f"{_plural(running, 'allocation run')} in flight"
    else:
        status, detail = "pending", f"No actual allocation run for {year} yet"
    return _step(
        step_id="charges", label="Charge & allocate", status=status,
        owner="operator", route="/calc-studio/allocations",
        counts={"succeeded": succeeded, "running": running}, detail=detail,
    )


def _waterfall_step(applied_run_id: str | None, param_on: bool) -> dict[str, Any]:
    applied = applied_run_id is not None
    if applied and param_on:
        status, detail = "complete", "Charges applied and post-charge basis live"
    elif applied:
        status = "attention"
        detail = "Charges applied but the post-charge basis is still off"
    elif param_on:
        status = "attention"
        detail = "Post-charge basis is on but no waterfall run is applied"
    else:
        status, detail = "pending", "No charges applied yet"
    return _step(
        step_id="waterfall", label="Apply charges (waterfall)", status=status,
        owner="operator", route="/calc-studio/waterfall",
        counts={"applied_runs": int(applied), "param_on": int(param_on)},
        detail=detail,
    )


def _monitor_step(year: int) -> dict[str, Any]:
    k = kpis(year=year)
    counts = {"in": k["entitiesInRange"], "watch": k["entitiesWatch"],
              "out": k["entitiesOutOfRange"]}
    if counts["out"]:
        status = "attention"
        detail = f"{_plural(counts['out'], 'tested party', 'tested parties')} out of range"
    elif counts["watch"]:
        status = "active"
        detail = f"{_plural(counts['watch'], 'tested party', 'tested parties')} on watch"
    else:
        status, detail = "complete", "All tested parties in range"
    return _step(
        step_id="monitor", label="Monitor margins", status=status,
        owner="shared", route="/process/OTP-20/overview",
        counts=counts, detail=detail,
    )


def _adjust_step(out_of_range: int) -> dict[str, Any]:
    pending = sum(1 for a in overrides.list_adjustments()
                  if a.get("status") == "Pending Approval")
    if pending:
        status, detail = "active", f"{_plural(pending, 'adjustment')} pending approval"
    elif out_of_range:
        status = "attention"
        detail = (f"{_plural(out_of_range, 'party', 'parties')} out of range "
                  "with no adjustment in flight")
    else:
        status, detail = "complete", "No true-ups outstanding"
    return _step(
        step_id="adjust", label="Adjust & true-up", status=status,
        owner="operator", route="/process/OTP-16/overview",
        counts={"pending": pending, "out_of_range": out_of_range}, detail=detail,
    )


def _review_step(
    user: str, pending_reviews: list[dict[str, Any]]
) -> dict[str, Any]:
    # Segregation of duties, same split as the worklist: you act on others'
    # submissions; your own only wait on someone else.
    to_approve = sum(1 for it in pending_reviews if it["maker"] != user)
    awaiting = sum(1 for it in pending_reviews if it["maker"] == user)
    if to_approve:
        status, detail = "attention", f"{_plural(to_approve, 'item')} waiting on your approval"
    elif awaiting:
        status, detail = "active", f"{_plural(awaiting, 'submission')} awaiting a checker"
    else:
        status, detail = "complete", "Review queue clear"
    return _step(
        step_id="review", label="Review & sign-off", status=status,
        owner="reviewer", route="/review",
        counts={"to_approve": to_approve, "awaiting": awaiting}, detail=detail,
    )


def _document_step() -> dict[str, Any]:
    n = sum(1 for c in cases.list_cases() if c["status"] != "closed")
    return _step(
        step_id="document", label="Document & reserve",
        status="active" if n else "complete",
        owner="director", route="/process/OTP-45/overview",
        counts={"open_cases": n},
        detail=(f"{_plural(n, 'open case')} to document" if n
                else "All cases closed"),
    )


def build_close_status(user: str, year: int = 2026) -> dict[str, Any]:
    applied = post_charge.applied_run_id()
    param_on = bool(parameters.get_param(post_charge.PARAM_KEY, False))
    # One queue read serves both the price-setting scope and the review step.
    pending_reviews = review.list_queue("pending")
    monitor = _monitor_step(year)
    steps = [
        _master_data_step(),
        _price_setting_step(user, pending_reviews),
        _charges_step(year),
        _waterfall_step(applied, param_on),
        monitor,
        _adjust_step(monitor["counts"]["out"]),
        _review_step(user, pending_reviews),
        _document_step(),
    ]
    current_index = next(
        (i for i, s in enumerate(steps) if s["status"] != "complete"),
        len(steps) - 1,
    )
    return {
        "year": year,
        "basis": {
            "mode": post_charge.resolve_mode(None),
            "param_on": param_on,
            "applied_run_id": applied,
        },
        "current_index": current_index,
        "steps": steps,
    }


@router.get("/api/close/status")
def get_close_status(user: str, year: int = 2026):
    return build_close_status(user, year)
