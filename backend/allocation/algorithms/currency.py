"""Currency minor units (SPEC §5.6 rounding boundaries 2-3).

Markup amounts quantize to the minor unit of the currency they are computed
in (boundary 2) and FX conversions to the minor unit of the TARGET currency
(boundary 3) — both HALF_EVEN. Most ISO 4217 currencies carry two decimals;
the zero-decimal set below covers the exponent-0 currencies (JPY is the SPEC
§9.1 mandatory edge case).

Pure module — no I/O (ENGINE-CLAUDE.md "Engine purity").
"""

from __future__ import annotations

from decimal import Decimal

CENT = Decimal("0.01")
ONE = Decimal("1")

#: ISO 4217 exponent-0 currencies (no minor unit).
ZERO_DECIMAL_CURRENCIES = frozenset({
    "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW",
    "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
})


def minor_unit(currency: str) -> Decimal:
    """Quantization step for ``currency`` (``0.01`` default, ``1`` for the
    zero-decimal set)."""
    return ONE if currency in ZERO_DECIMAL_CURRENCIES else CENT
