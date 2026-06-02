"""Master data — read-only definitional seeds (functions, transaction types,
entity-function assignments, covered transactions), the policy/calculation
resolution, and the SQLite-backed editable overlay + inbound staging.

Read seeds are cached like the process catalog; mutable state follows the
state/engine + audit pattern used across the platform.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from state import seeds

_DIR = Path(__file__).parent.parent / "seeds" / "master_data"


@lru_cache(maxsize=None)
def _doc(name: str) -> dict[str, Any]:
    return json.loads((_DIR / name).read_text(encoding="utf-8"))


def functions() -> list[dict[str, Any]]:
    return _doc("tp_functions.v1.json")["functions"]


def function_label(code: str) -> str:
    for f in functions():
        if f["code"] == code:
            return f["label"]
    return code


def transaction_types() -> list[dict[str, Any]]:
    return _doc("transaction_types.v1.json")["transaction_types"]


@lru_cache(maxsize=1)
def _benchmark_index() -> dict[str, dict[str, Any]]:
    return {s["set_id"]: s for s in seeds.load("benchmarks")["sets"]}


def resolve(characterising_function: str, category: str) -> dict[str, Any] | None:
    """(function, transaction category) -> the covered transaction type with its
    method, PLI, benchmark set and arm's-length range. Returns None if no type
    matches — this is what makes master data drive the calculation."""
    for t in transaction_types():
        if t["characterising_function"] == characterising_function and t["category"] == category:
            bm = _benchmark_index().get(t["benchmark_set_id"], {})
            return {
                **t,
                "lower": bm.get("lower"),
                "median": bm.get("median"),
                "upper": bm.get("upper"),
                "unit": bm.get("unit"),
            }
    return None
