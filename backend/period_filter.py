"""Period filter applied to most read endpoints.

Frontend passes ?year=&periodFrom=&periodTo=. The class builds a SQL
fragment ('AND ...' or '') and the corresponding bind parameters.
"""

from __future__ import annotations

from typing import Any


class PeriodFilter:
    def __init__(
        self,
        year: int | None = None,
        period_from: str | None = None,
        period_to: str | None = None,
    ):
        self.year = year
        self.period_from = period_from
        self.period_to = period_to

    def where(self, alias: str = "") -> tuple[str, list[Any]]:
        """Build a SQL fragment ('AND ...' or '') and the corresponding params list."""
        prefix = f"{alias}." if alias else ""
        clauses: list[str] = []
        params: list[Any] = []
        if self.year is not None:
            clauses.append(f"{prefix}GJAHR = ?")
            params.append(self.year)
        if self.period_from is not None:
            clauses.append(f"{prefix}POPER >= ?")
            params.append(self.period_from)
        if self.period_to is not None:
            clauses.append(f"{prefix}POPER <= ?")
            params.append(self.period_to)
        return (" AND " + " AND ".join(clauses)) if clauses else "", params

    @property
    def has(self) -> bool:
        return any((self.year, self.period_from, self.period_to))
