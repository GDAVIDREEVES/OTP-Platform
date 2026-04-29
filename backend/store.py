"""
File-based JSON store for editable state — submitted adjustments, policy
overrides, and app settings.

Persistence: a single JSON file (`overrides.json`) inside this directory.
Writes are atomic (write to a temp sibling, then `os.replace`) and
serialised through a threading.Lock so concurrent FastAPI requests can't
corrupt the file.

Why not a real database? The dataset is small (10s of records max) and
the deployment story stays a single Python file plus a JSON file. If the
write surface grows, swap this module for SQLite without changing the API.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

STORE_DIR = Path(__file__).parent
STORE_PATH = STORE_DIR / "overrides.json"

_LOCK = threading.Lock()

_DEFAULTS: dict[str, Any] = {
    "adjustments": [],          # list[SubmittedAdjustment]
    "policy_overrides": {},     # dict[flow_id -> PolicyOverride]
    "settings": {
        "companyName": "Aperture Tax",
        "defaultCurrency": "USD",
        "defaultReviewer": "Sam Rodriguez",
        "notifyOnDeviation": True,
    },
}


def _read_unsafe() -> dict[str, Any]:
    """Read the store file. Returns a fresh copy of defaults on first run."""
    if not STORE_PATH.exists():
        return json.loads(json.dumps(_DEFAULTS))  # deep copy
    with STORE_PATH.open("r", encoding="utf-8") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError:
            return json.loads(json.dumps(_DEFAULTS))
    # Heal missing keys so older files don't crash
    for k, v in _DEFAULTS.items():
        data.setdefault(k, json.loads(json.dumps(v)))
    return data


def _write_unsafe(data: dict[str, Any]) -> None:
    """Atomic write: temp file in same dir, then replace."""
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="overrides.", suffix=".json", dir=STORE_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, STORE_PATH)
    except Exception:
        # Best-effort cleanup of the temp file if rename failed
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read() -> dict[str, Any]:
    with _LOCK:
        return _read_unsafe()


# ----------------- adjustments -----------------

def list_adjustments() -> list[dict[str, Any]]:
    return list(read().get("adjustments", []))


def submit_adjustment(payload: dict[str, Any]) -> dict[str, Any]:
    with _LOCK:
        data = _read_unsafe()
        record = {
            "id": f"ADJ-{uuid4().hex[:8].upper()}",
            "submittedAt": datetime.now(timezone.utc).isoformat(),
            "status": "Pending Approval",
            **payload,
        }
        data["adjustments"].append(record)
        _write_unsafe(data)
        return record


VALID_STATUSES = {"Pending Approval", "Approved", "Rejected", "Exported", "Reversed"}


def _find(data: dict[str, Any], adj_id: str) -> dict[str, Any] | None:
    for a in data["adjustments"]:
        if a.get("id") == adj_id:
            return a
    return None


def update_adjustment(adj_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    """
    Patch a subset of fields on the adjustment. Common path: status updates
    (Approved / Rejected / Exported). Records who/when on every change.
    """
    with _LOCK:
        data = _read_unsafe()
        record = _find(data, adj_id)
        if record is None:
            return None
        new_status = fields.get("status")
        if new_status is not None and new_status not in VALID_STATUSES:
            raise ValueError(f"Invalid status {new_status!r}; expected one of {sorted(VALID_STATUSES)}")
        # Apply allowed fields only
        for k in ("status", "approvedBy", "exportedRef", "rejectionReason", "notes"):
            if k in fields:
                record[k] = fields[k]
        record["updatedAt"] = datetime.now(timezone.utc).isoformat()
        if "by" in fields:
            record["updatedBy"] = fields["by"]
        _write_unsafe(data)
        return dict(record)


def delete_adjustment(adj_id: str) -> bool:
    """Hard-delete. Allowed only when status is 'Pending Approval'."""
    with _LOCK:
        data = _read_unsafe()
        before = len(data["adjustments"])
        kept = []
        deleted = False
        for a in data["adjustments"]:
            if a.get("id") == adj_id:
                if a.get("status") == "Pending Approval":
                    deleted = True
                    continue  # drop it
                # not deletable — preserve
                kept.append(a)
            else:
                kept.append(a)
        data["adjustments"] = kept
        if deleted:
            _write_unsafe(data)
        return deleted and len(data["adjustments"]) < before


def reverse_adjustment(adj_id: str, by: str | None = None) -> dict[str, Any] | None:
    """
    Create a counter-adjustment with the opposite sign, mark the original as
    'Reversed'. The pair stays in the audit trail.
    """
    with _LOCK:
        data = _read_unsafe()
        original = _find(data, adj_id)
        if original is None:
            return None
        if original.get("status") == "Reversed":
            return None  # already reversed

        counter = {
            "id": f"ADJ-{uuid4().hex[:8].upper()}",
            "submittedAt": datetime.now(timezone.utc).isoformat(),
            "status": "Pending Approval",
            "entityId": original.get("entityId"),
            "entityName": original.get("entityName"),
            "amount": -float(original.get("amount", 0)),
            "currency": original.get("currency", "USD"),
            "mode": original.get("mode", "median"),
            "targetMargin": original.get("targetMargin"),
            "actualMargin": original.get("actualMargin"),
            "notes": f"Reversal of {original['id']}",
            "submittedBy": by or "Reverse",
            "reversesId": original["id"],
        }
        original["status"] = "Reversed"
        original["reversedById"] = counter["id"]
        original["reversedAt"] = counter["submittedAt"]
        if by:
            original["reversedBy"] = by

        data["adjustments"].append(counter)
        _write_unsafe(data)
        return counter


# ----------------- policy overrides -----------------

def list_policy_overrides() -> dict[str, dict[str, Any]]:
    return dict(read().get("policy_overrides", {}))


def upsert_policy_override(flow_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    with _LOCK:
        data = _read_unsafe()
        record = {
            **payload,
            "flowId": flow_id,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        data["policy_overrides"][flow_id] = record
        _write_unsafe(data)
        return record


# ----------------- settings -----------------

def get_settings() -> dict[str, Any]:
    return dict(read().get("settings", _DEFAULTS["settings"]))


def update_settings(payload: dict[str, Any]) -> dict[str, Any]:
    with _LOCK:
        data = _read_unsafe()
        data["settings"] = {**_DEFAULTS["settings"], **(data.get("settings") or {}), **payload}
        _write_unsafe(data)
        return dict(data["settings"])
