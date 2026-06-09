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
    "wht_treaty": "compliance/wht_treaty.v1.json",
    "treasury": "finance/treasury.v1.json",
    "fx": "finance/fx.v1.json",
    "vat": "finance/vat.v1.json",
    "stewardship": "finance/stewardship.v1.json",
    "guarantee": "finance/guarantee.v1.json",
    "captive": "finance/captive.v1.json",
    "customs": "finance/customs.v1.json",
}


@lru_cache(maxsize=None)
def load(name: str) -> dict[str, Any]:
    if name not in _FILES:
        raise KeyError(name)
    return json.loads((_SEEDS / _FILES[name]).read_text(encoding="utf-8"))


def names() -> list[str]:
    return list(_FILES)


# Seeds whose magnitudes are invented for the demo carry an explicit
# `fabricated: true` flag OR a `note` that opens with "FABRICATED" (the
# treasury/stewardship registers pre-date the flag but say so in prose). Both
# signals collapse to provenance "fabricated"; every other seed is "assumed"
# (illustrative reference applied over the real warehouse base).
def meta(name: str) -> dict[str, Any]:
    """Provenance metadata for a registered seed (does not alter load()).

    Returns ``{provenance, source, maintainer, lineage, fabricated}``:
    - ``provenance`` is "fabricated" when the seed declares ``fabricated: true``
      or its ``note`` opens with "FABRICATED", else "assumed";
    - ``source`` lifts the seed's existing ``note`` (description) if present;
    - ``fabricated`` is the resolved boolean.
    """
    if name not in _FILES:
        raise KeyError(name)
    doc = load(name)
    note = doc.get("note") if isinstance(doc, dict) else None
    fabricated = bool(doc.get("fabricated")) if isinstance(doc, dict) else False
    if isinstance(note, str) and note.strip().upper().startswith("FABRICATED"):
        fabricated = True
    return {
        "provenance": "fabricated" if fabricated else "assumed",
        "source": note,
        "maintainer": "TP team",
        "lineage": f"seed → /api/reference/{name}",
        "fabricated": fabricated,
    }
