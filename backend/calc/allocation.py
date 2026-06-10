"""Allocation kernel.

``allocate()`` generalises the two share-and-allocate computations in
``routers/csa.py``:

* ``csa()``'s **RAB share** — ``share_i = projected_sales_i / Σ projected_sales``,
  then ``allocated_i = share_i * pool`` (and again against ``platform_value``).
* ``profit_split()``'s **value-driver** split — ``share_i = key_i / Σ key``,
  then ``allocated_i = share_i * combined_profit``.

Both are the same kernel: full-precision shares summing to 1, times a total.
``basis`` names which per-participant measure drives the split. Shares are kept
at full precision (no rounding) so callers reproduce their existing 2dp output
byte-identically.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from calc import trace

# basis -> the per-row measure that drives the split.
_BASIS_MEASURE = {
    "rab_share": "projected_sales",  # csa() RAB benefit measure
    "value_driver": "key_value",     # profit_split() selected value-driver
}


def allocate(
    rows: Sequence[Mapping[str, Any]],
    basis: str,
    total: float = 0.0,
    measure: str | None = None,
) -> list[dict[str, Any]]:
    """Compute per-participant shares (summing to 1) and allocated amounts.

    Args:
      rows:    per-participant dicts each carrying the basis measure.
      basis:   ``"rab_share"`` (measure ``projected_sales``) or ``"value_driver"``
               (measure ``key_value``). Selects the default measure column.
      total:   the amount to allocate (``pool`` / ``combined_profit`` / …).
      measure: override the basis's default measure column name.

    Returns one dict per input row: ``{"share": float, "allocated": float}``.
    ``share`` is full precision; ``share_i = basis_i / Σ basis`` (0.0 for every
    row when the basis total is 0, matching the routers' graceful-zero path);
    ``allocated_i = share_i * total``. ``Σ share == 1`` whenever the basis total
    is non-zero; ``Σ allocated == total`` (up to float precision).
    """
    if basis not in _BASIS_MEASURE:
        raise ValueError(f"unknown allocation basis: {basis!r}")
    col = measure or _BASIS_MEASURE[basis]
    basis_total = sum(float(r[col]) for r in rows)
    out: list[dict[str, Any]] = []
    for r in rows:
        share = (float(r[col]) / basis_total) if basis_total else 0.0
        out.append({"share": share, "allocated": share * total})
    trace.emit("allocate", basis=basis, total=total, rows=len(out))
    return out
