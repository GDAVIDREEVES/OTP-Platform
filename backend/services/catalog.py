"""Data catalog assembly — one governed inventory of every data source.

Stitches four tiers into a single flat list of entries, each
``{id, kind, name, description, provenance, lineage}``:

- ``warehouse`` — the read-only DuckDB parquet views (db.py), described in the
  committed catalog seed;
- ``state`` — the mutable SQLite tables (state/schema.sql), described in the
  same seed;
- ``seed`` — every registered reference seed, AUTO-discovered via
  ``seeds.names()`` with provenance lifted from ``seeds.meta()``;
- ``parameter`` — every governed calc parameter via ``parameters.list_params()``.

Provenance is ``real`` (warehouse/state — produced by governed actions over real
data), ``assumed`` (illustrative reference applied over the real base), or
``fabricated`` (magnitudes invented for the demo). The ``/provenance`` rollup
buckets every source + parameter by that field.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import state.parameters as parameters
from state import seeds

_CATALOG = Path(__file__).parent.parent / "seeds" / "catalog" / "catalog.v1.json"


@lru_cache(maxsize=None)
def _descriptors() -> dict[str, Any]:
    return json.loads(_CATALOG.read_text(encoding="utf-8"))


def _warehouse_entries() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for v in _descriptors().get("warehouse", []):
        out.append(
            {
                "id": v["id"],
                "kind": "warehouse",
                "name": v["name"],
                "description": v.get("description"),
                "provenance": v.get("provenance", "real"),
                "lineage": v.get("lineage"),
            }
        )
    return out


def _state_entries() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for t in _descriptors().get("state", []):
        out.append(
            {
                "id": t["id"],
                "kind": "state",
                "name": t["name"],
                "description": t.get("description"),
                "provenance": t.get("provenance", "real"),
                "lineage": t.get("lineage"),
            }
        )
    return out


def _seed_entries() -> list[dict[str, Any]]:
    """Auto-discovered from the seed registry — provenance via seeds.meta()."""
    out: list[dict[str, Any]] = []
    for name in seeds.names():
        m = seeds.meta(name)
        out.append(
            {
                "id": f"seed:{name}",
                "kind": "seed",
                "name": name,
                "description": m.get("source"),
                "provenance": m["provenance"],
                "lineage": m.get("lineage"),
            }
        )
    return out


def _parameter_entries() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for p in parameters.list_params():
        out.append(
            {
                "id": f"parameter:{p['key']}",
                "kind": "parameter",
                "name": p["key"],
                "description": p.get("rationale"),
                "provenance": p.get("provenance"),
                "lineage": (
                    f"{p['process_id']} · read via get_param('{p['key']}')"
                    if p.get("process_id")
                    else f"read via get_param('{p['key']}')"
                ),
            }
        )
    return out


def catalog() -> list[dict[str, Any]]:
    """The full catalog: warehouse views, state tables, seeds, parameters."""
    return (
        _warehouse_entries()
        + _state_entries()
        + _seed_entries()
        + _parameter_entries()
    )


def entry(entry_id: str) -> dict[str, Any] | None:
    """One catalog entry by id, or ``None`` if unknown."""
    for e in catalog():
        if e["id"] == entry_id:
            return e
    return None


def provenance_rollup() -> dict[str, Any]:
    """Group every source + parameter by provenance (real|assumed|fabricated).

    Returns ``{buckets: {real|assumed|fabricated: {count, items}}, total}``.
    Each item is the trimmed catalog entry (id/kind/name) so the dashboard can
    deep-link without re-fetching the full record.
    """
    buckets: dict[str, dict[str, Any]] = {
        "real": {"count": 0, "items": []},
        "assumed": {"count": 0, "items": []},
        "fabricated": {"count": 0, "items": []},
    }
    for e in catalog():
        prov = e.get("provenance") or "assumed"
        bucket = buckets.setdefault(prov, {"count": 0, "items": []})
        bucket["count"] += 1
        bucket["items"].append({"id": e["id"], "kind": e["kind"], "name": e["name"]})
    return {"buckets": buckets, "total": sum(b["count"] for b in buckets.values())}
