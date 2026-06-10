"""Effective-dating resolution (SPEC §5.5).

``resolve_as_of(rows, period)``: a reference row is in scope for a run period
iff ``effective_from <= period_end`` and (``effective_to`` is null or
``effective_to >= period_start``). Periods are ``"YYYY-MM"`` (monthly runs) or
``"YYYY"`` (annual true-up); ISO date strings compare lexicographically, so no
datetime arithmetic is needed beyond month-length lookup.

Mid-period proration (config ``midPeriodProration``) defaults to false per
SPEC §5.5 — in/out per whole period — and is not consulted before Stage 4.

Pure module — no I/O (ENGINE-CLAUDE.md "Engine purity").
"""

from __future__ import annotations

import calendar
import re
from typing import Any, Iterable, Mapping

_MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")
_YEAR_RE = re.compile(r"^\d{4}$")


def period_bounds(period: str) -> tuple[str, str]:
    """(period_start, period_end) ISO dates for a "YYYY-MM" or "YYYY" period."""
    m = _MONTH_RE.match(period)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        if not 1 <= month <= 12:
            raise ValueError(f"invalid period: {period!r}")
        last = calendar.monthrange(year, month)[1]
        return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last:02d}"
    if _YEAR_RE.match(period):
        return f"{period}-01-01", f"{period}-12-31"
    raise ValueError(f"invalid period: {period!r}")


def resolve_as_of(rows: Iterable[Mapping[str, Any]], period: str) -> list[dict]:
    """Rows in scope as-of ``period`` (SPEC §5.5), as shallow copies."""
    start, end = period_bounds(period)
    out: list[dict] = []
    for row in rows:
        if row["effective_from"] > end:
            continue
        eff_to = row.get("effective_to")
        if eff_to is not None and eff_to < start:
            continue
        out.append(dict(row))
    return out
