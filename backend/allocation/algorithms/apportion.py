"""Apportionment — largest remainder (SPEC §5.1).

SPEC pseudocode, implemented verbatim::

    raw[r]   = base * ratios[r]
    floor[r] = round_down(raw[r], minor_unit)
    residual = base - sum(floor)
    distribute residual one minor unit at a time to recipients in descending
    order of (raw[r] - floor[r]); tie-break by recipient_entity_id ascending
    assert sum(result) == base exactly

This is rounding boundary (1) of SPEC §5.6 — the ONLY place Stage-4 amounts
are quantized. All inputs/outputs are ``decimal.Decimal``; never floats
(ENGINE-CLAUDE.md).

Contract (violations raise ``ValueError`` — they are caller bugs, not V-rule
exceptions; the stage validates V-K1..V-K3 before calling):

- ``base`` is non-negative and an exact multiple of ``minor_unit`` (the
  exact-sum assert is unsatisfiable otherwise — DECISIONS.md M3);
- ``ratios`` values are non-negative and sum to 1 within ``RATIO_TOLERANCE``
  (1e-12, V-K3's bound); an empty ``ratios`` is only legal for a zero base.

Pure module — no I/O.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_DOWN
from typing import Mapping

CENT = Decimal("0.01")
ONE = Decimal("1")
ZERO = Decimal("0")

#: V-K3 — ratios sum to 1 within 1e-12 before apportionment (SPEC §7).
RATIO_TOLERANCE = Decimal("1E-12")


def apportion(
    base: Decimal,
    ratios: Mapping[str, Decimal],
    *,
    minor_unit: Decimal = CENT,
) -> dict[str, Decimal]:
    """Split ``base`` across recipients by ``ratios``, summing EXACTLY.

    Returns ``{recipient_entity_id: amount}`` in ascending recipient order
    (deterministic regardless of the input mapping's iteration order —
    SPEC §5.1 determinism).
    """
    if base < ZERO:
        raise ValueError(f"apportion: base must be non-negative, got {base}")
    try:
        if base.quantize(minor_unit) != base:
            raise ValueError(
                f"apportion: base {base} is not an exact multiple of the "
                f"minor unit {minor_unit} — the SPEC §5.1 exact-sum assert "
                "is unsatisfiable (DECISIONS.md M3)"
            )
    except InvalidOperation as exc:  # pragma: no cover - astronomically large
        raise ValueError(f"apportion: base {base} not representable at "
                         f"minor unit {minor_unit}") from exc
    if not ratios:
        if base == ZERO:
            return {}
        raise ValueError("apportion: no recipients for a non-zero base")
    negative = {r: p for r, p in ratios.items() if p < ZERO}
    if negative:
        raise ValueError(f"apportion: negative ratios {negative}")
    ratio_sum = sum(ratios.values(), ZERO)
    if abs(ONE - ratio_sum) > RATIO_TOLERANCE:
        raise ValueError(
            f"apportion: ratios sum to {ratio_sum}, not 1 within "
            f"{RATIO_TOLERANCE} (V-K3 must gate before apportionment)"
        )

    recipients = sorted(ratios)  # ascending recipient_entity_id
    raw = {r: base * ratios[r] for r in recipients}
    floor = {r: raw[r].quantize(minor_unit, rounding=ROUND_DOWN)
             for r in recipients}
    residual = base - sum(floor.values(), ZERO)
    if residual < ZERO:
        raise ValueError(
            f"apportion: floors exceed the base by {-residual} — ratios "
            "above 1 beyond tolerance"
        )
    n_units = int((residual / minor_unit).to_integral_value())
    assert residual == n_units * minor_unit  # multiples of minor_unit only

    # Descending fractional remainder (raw - floor); tie-break ascending
    # recipient_entity_id (`recipients` is already ascending, sort is stable
    # on the negated remainder). One minor unit at a time; cycle defensively
    # if residual ever exceeds one unit per recipient.
    order = sorted(recipients, key=lambda r: -(raw[r] - floor[r]))
    result = dict(floor)
    for k in range(n_units):
        result[order[k % len(order)]] += minor_unit

    assert sum(result.values(), ZERO) == base  # SPEC §5.1 exact-sum contract
    return result
