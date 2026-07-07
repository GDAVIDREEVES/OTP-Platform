"""Maker-checker review queue.

decide() enforces segregation of duties in code, not just configuration:
a maker cannot approve their own work, the assistant can never be a checker,
and a rejection must carry a comment. Every decision writes an audit event,
so the control itself is part of the permanent record.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import persistence.overrides as overrides
import state.audit as audit
import state.authored_datasets as authored_datasets
import state.authored_pools as authored_pools
import state.lineage as lineage
import state.master_data as md
import state.scenarios as scenarios
import state.user_calcs as user_calcs
import state.waterfall_requests as waterfall_requests
from state.engine import LOCK, get_conn

# decision -> (stored status, audit event_type)
_DECISIONS = {"approve": "approved", "reject": "rejected"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_dict(row: Any) -> dict[str, Any]:
    return {k: row[k] for k in row.keys()}


def create_item(*, process_id: str, record_ref: str, maker: str) -> dict[str, Any]:
    now = _now()
    with LOCK:
        conn = get_conn()
        cur = conn.execute(
            "INSERT INTO review_items (process_id, record_ref, maker, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
            (process_id, record_ref, maker, now),
        )
        conn.commit()
        # Enqueuing for review IS the maker submitting — record it.
        audit.record(
            actor=maker, actor_kind="human",
            process_id=process_id, record_ref=record_ref, event_type="submitted",
        )
        row = conn.execute("SELECT * FROM review_items WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _to_dict(row)


def decide(
    item_id: int, checker: str, decision: str, comments: str | None = None
) -> dict[str, Any]:
    if decision not in _DECISIONS:
        raise ValueError(f"decision must be one of {sorted(_DECISIONS)}, got {decision!r}")
    if checker == audit.ASSISTANT_ACTOR:
        raise ValueError("the assistant can never be the checker; maker-checker requires two humans")
    if decision == "reject" and not comments:
        raise ValueError("a rejection requires a comment")

    status = _DECISIONS[decision]
    with LOCK:
        conn = get_conn()
        row = conn.execute("SELECT * FROM review_items WHERE id = ?", (item_id,)).fetchone()
        if row is None:
            raise ValueError(f"no review item {item_id}")
        if row["status"] != "pending":
            raise ValueError(f"review item {item_id} is already {row['status']}")
        if checker == row["maker"]:
            raise ValueError("a maker cannot approve their own work (segregation of duties)")
        now = _now()
        conn.execute(
            "UPDATE review_items SET checker = ?, status = ?, comments = ?, decided_at = ? WHERE id = ?",
            (checker, status, comments, now, item_id),
        )
        conn.commit()
        record_ref = row["record_ref"]
        audit.record(
            actor=checker, actor_kind="human",
            process_id=row["process_id"], record_ref=record_ref,
            event_type=status, rationale=comments,
        )

        # Loop 1.2 — a rejection returns the work to its originating process so the
        # maker knows where to go. The "return" is one more handoff on the same
        # record_ref (from_process == to_process: it loops back to where it came
        # from), surfacing on that record's Audit tab + evidence packet.
        if decision == "reject":
            lineage.record_handoff(
                record_ref=record_ref,
                from_process=row["process_id"],
                to_process=row["process_id"],
                actor=checker,
                summary=f"Returned for changes: {comments or 'see review'}",
            )

        updated = conn.execute("SELECT * FROM review_items WHERE id = ?", (item_id,)).fetchone()

    # Loop 1.1 — an approved in-period adjustment hands back to monitoring (OTP-20):
    # promote the adjustment to Approved and record the OTP-16 -> OTP-20 handoff so the
    # "re-validate" hop surfaces on the adj:* record's Audit tab + evidence packet.
    if decision == "approve" and record_ref.startswith("adj:"):
        adj_id = record_ref.split(":", 1)[1]
        if overrides.update_adjustment(adj_id, {"status": "Approved", "approvedBy": checker}) is not None:
            lineage.record_handoff(
                record_ref=record_ref,
                from_process="OTP-16",
                to_process="OTP-20",
                actor=checker,
                summary="Adjustment approved — re-validate monitoring; entity expected back in range",
            )

    # CS-c — scenario promotion rides the same gate: approving a scenario:*
    # item applies its overrides to the governed store (each set_param audited
    # at param:{key}) and marks the scenario promoted; rejecting returns it to
    # draft so the maker can rework the overrides.
    if record_ref.startswith("scenario:"):
        scenario_id = record_ref.split(":", 1)[1]
        if scenarios.get_scenario(scenario_id) is not None:
            if decision == "approve":
                scenarios.apply_promotion(scenario_id, checker)
            else:
                scenarios.mark_rejected(scenario_id)

    # W3 — user-calculation activation rides the same gate: approving a
    # ucalc:* item activates the calculation in the registry (kind
    # "user-defined"); rejecting returns it to draft so the maker can rework,
    # re-test and resubmit.
    if record_ref.startswith("ucalc:"):
        ucalc_id = record_ref.split(":", 1)[1]
        if user_calcs.get_user_calc(ucalc_id) is not None:
            if decision == "approve":
                user_calcs.apply_activation(ucalc_id, checker)
            else:
                user_calcs.mark_rejected(ucalc_id)

    # PB2 — authored-pool activation rides the same gate: approving an
    # allocpool:* item activates the pool (it now overlays the engine as a
    # flagged authored run — the governed allocation is untouched); rejecting
    # returns it to draft so the maker can rework, re-test and resubmit.
    if record_ref.startswith("allocpool:"):
        ap_id = record_ref.split(":", 1)[1]
        if authored_pools.get_authored_pool(ap_id) is not None:
            if decision == "approve":
                authored_pools.apply_activation(ap_id, checker)
            else:
                authored_pools.mark_rejected(ap_id)

    # DS2 — authored-dataset activation rides the same gate: approving a
    # dataset:* item activates the dataset (it now lists as an ACTIVE source
    # other datasets / calcs / pool cost bases can reference); rejecting returns
    # it to draft so the maker can rework, re-test and resubmit.
    if record_ref.startswith("dataset:"):
        ds_id = record_ref.split(":", 1)[1]
        if authored_datasets.get_authored_dataset(ds_id) is not None:
            if decision == "approve":
                authored_datasets.apply_activation(ds_id, checker)
            else:
                authored_datasets.mark_rejected(ds_id)

    # GP4 — waterfall apply/rollback rides the same gate: approving a
    # waterfall:{request} item EXECUTES the run (or rollback) via
    # services/waterfall_runner.py — the group P&L is written only here, on
    # approval by a DIFFERENT reviewer (execute-on-approve, like scenario
    # promotion); rejecting marks the request terminal and NOTHING runs, so the
    # P&L is left exactly as it was. A missing request id is a defensive no-op
    # (the decision still lands) — an ordinary waterfall:{run} ref is not a
    # request and simply falls through.
    if record_ref.startswith("waterfall:"):
        request_id = record_ref.split(":", 1)[1]
        if waterfall_requests.get_request(request_id) is not None:
            if decision == "approve":
                waterfall_requests.apply_request(request_id, checker)
            else:
                waterfall_requests.mark_rejected(request_id)

    # GP2 — master-data mapping application rides the same gate: approving an
    # mdmap:* item applies the staged mapping to the master (entity / covered
    # transaction), audited at mdmap:{id}; rejecting marks the staging row
    # rejected so the maker can rework and resubmit. This is what makes the
    # UNIVERSAL /review queue and the in-page master-data endpoints converge on
    # ONE side-effect — no split-brain, no staging row orphaned in in_review.
    # A missing staging id is a defensive no-op (the decision still lands).
    if record_ref.startswith("mdmap:"):
        staging_id = record_ref.split(":", 1)[1]
        if md.get_staging(staging_id) is not None:
            if decision == "approve":
                md.apply_mapping(staging_id, applied_by=checker)
            else:
                md.mark_status(staging_id, "rejected")
    return _to_dict(updated)


def list_queue(status: str | None = "pending") -> list[dict[str, Any]]:
    if status is None:
        rows = get_conn().execute("SELECT * FROM review_items ORDER BY id").fetchall()
    else:
        rows = get_conn().execute(
            "SELECT * FROM review_items WHERE status = ? ORDER BY id", (status,)
        ).fetchall()
    return [_to_dict(r) for r in rows]
