"""Read-only reference seeds — benchmarks, intangibles, DEMPE, and the
compliance sets (CbCR, Pillar Two, UTP). Served straight from the committed
JSON, like the process catalog."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_SEEDS = Path(__file__).parent.parent / "seeds"
_FILES = {
    "benchmarks": "benchmarking_sets/benchmarks.v1.json",
    "intangibles": "intangible_register/intangibles.v1.json",
    "dempe": "dempe_allocations/dempe.v1.json",
    "cbcr": "compliance/cbcr.v1.json",
    "pillar_two": "compliance/pillar_two.v1.json",
    "utp_reserve": "compliance/utp_reserve.v1.json",
}


@lru_cache(maxsize=None)
def load(name: str) -> dict[str, Any]:
    if name not in _FILES:
        raise KeyError(name)
    return json.loads((_SEEDS / _FILES[name]).read_text(encoding="utf-8"))


def names() -> list[str]:
    return list(_FILES)
