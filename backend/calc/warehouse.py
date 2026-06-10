"""Warehouse aggregation kernel.

``aggregate()`` builds the GROUP-BY ``SUM(measure)`` query that csa/pnl/beat/flows
each hand-roll, optionally constrained by a ``PeriodFilter`` and an arbitrary
``where`` predicate, and runs it through ``db.q``. It returns the raw aggregated
rows (group columns + one summed column per measure) — callers keep their own
re-keying, defaulting, and rounding, so the output stays byte-identical.

Measures may be a plain column name (``"revenue"`` → ``SUM(revenue) AS revenue``)
or a ``(expr, alias)`` pair (``("CASE WHEN HSL < 0 THEN -HSL ELSE 0 END",
"paid_to")`` → ``SUM(CASE …) AS paid_to``) so the same helper covers conditional
sums and ``COUNT(*)``-style measures.
"""

from __future__ import annotations

from typing import Any, Sequence, Union

from db import q
from period_filter import PeriodFilter

# A measure is either a column name (summed under its own alias) or an
# (expression, alias) pair for conditional sums / counts.
Measure = Union[str, tuple[str, str]]


def _measure_sql(measure: Measure) -> str:
    if isinstance(measure, tuple):
        expr, alias = measure
        # A bare aggregate expression (e.g. "COUNT(*)") is emitted verbatim;
        # otherwise it is wrapped in SUM(...). The simple SUM(col) case below
        # produces SUM(col) AS col, matching the hand-written router queries.
        return f"{expr} AS {alias}"
    return f"SUM({measure}) AS {measure}"


def aggregate(
    table: str,
    group_cols: Sequence[str],
    measures: Sequence[Measure],
    year: int | None = None,
    pf: PeriodFilter | None = None,
    where: str | None = None,
    params: Sequence[Any] | None = None,
) -> list[dict[str, Any]]:
    """``SELECT group_cols, SUM(measure) … FROM table [WHERE …] GROUP BY group_cols``.

    Args:
      table:      warehouse view name (``segment_pl`` / ``journal`` / …).
      group_cols: columns to GROUP BY (and select verbatim).
      measures:   each summed as ``SUM(col) AS col`` or, given an
                  ``(expr, alias)`` pair, emitted as ``expr AS alias``.
      year:       optional ``GJAHR = ?`` equality predicate (convenience for the
                  csa/beat callers that filter on a single year).
      pf:         optional ``PeriodFilter`` whose ``AND …`` fragment is appended.
      where:      optional extra predicate (without a leading ``AND``/``WHERE``),
                  e.g. ``"RBUKRS IN (?,?,?)"``.
      params:     bind parameters for ``where`` (and any ``IN`` lists), appended
                  after the ``year``/``pf`` params in source order.

    Returns the aggregated rows as a list of dicts (one summed column per
    measure, plus the group columns). Callers do their own defaulting/rounding.
    """
    select_cols = list(group_cols) + [_measure_sql(m) for m in measures]
    sql = f"SELECT {', '.join(select_cols)} FROM {table}"

    clauses: list[str] = []
    bind: list[Any] = []
    if year is not None:
        clauses.append("GJAHR = ?")
        bind.append(year)
    if where:
        clauses.append(where)
    if params:
        bind.extend(params)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    if pf is not None:
        pf_clause, pf_params = pf.where()
        # PeriodFilter.where() already prefixes its fragment with " AND ".
        if pf_clause:
            sql += (" WHERE 1=1" if not clauses else "") + pf_clause
            bind.extend(pf_params)
    if group_cols:
        sql += " GROUP BY " + ", ".join(group_cols)
    return q(sql, bind)
