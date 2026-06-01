"""The OTP-1…50 process catalog (registry + pharmaceutical overlay).

Served read-only from the committed seed. The pharma overlay (applicability
H/M, top-15 stars) is data here, not code — a second industry is a new seed,
not a fork.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_SEED = Path(__file__).parent.parent / "seeds" / "process_catalog" / "processes.v1.json"


@lru_cache(maxsize=1)
def _catalog() -> dict[str, Any]:
    return json.loads(_SEED.read_text(encoding="utf-8"))


def list_processes() -> list[dict[str, Any]]:
    return _catalog()["processes"]


def get_process(otp_id: str) -> dict[str, Any] | None:
    for p in _catalog()["processes"]:
        if p["id"].lower() == otp_id.lower():
            return p
    return None


def categories() -> dict[str, str]:
    return _catalog().get("categories", {})
