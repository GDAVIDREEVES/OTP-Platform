"""TP-band status & formatting helpers.

Pure functions — no I/O, no database access. Used by the entities service
to derive `status` and `variance` from a YTD margin and target band.
"""

from __future__ import annotations

from datetime import date


def fmt_pct_band(low: float, high: float) -> str:
    if low == 0 and high == 0:
        return "—"
    return f"{int(round(low * 100))}–{int(round(high * 100))}%"


def compute_status(
    actual_margin: float | None, low: float, high: float
) -> tuple[str, float | None]:
    """
    Return (status, variance) where:
      status   = 'in-range' | 'watch' | 'out-of-range'
      variance = points outside the band (0 if inside; signed otherwise)
    Rule:
      - in-range:     low ≤ m ≤ high
      - watch:        within +/- 1.5 * band-width of the band
      - out-of-range: otherwise
    Special case: financing entity (band 0–0) uses a 1pt tolerance.
    """
    if actual_margin is None:
        return "in-range", None

    if low == 0 and high == 0:
        # Financing entity — flat target with tight tolerance
        tol = 0.01
        if abs(actual_margin) <= tol:
            return "in-range", 0.0
        if abs(actual_margin) <= 3 * tol:
            return "watch", round((abs(actual_margin) - tol) * 100, 2)
        return "out-of-range", round(actual_margin * 100, 2)

    band_width = max(high - low, 0.005)
    if low <= actual_margin <= high:
        return "in-range", 0.0

    # outside band — signed distance in percentage points
    if actual_margin < low:
        delta = actual_margin - low
    else:
        delta = actual_margin - high

    pts = round(delta * 100, 2)
    if abs(delta) <= 1.5 * band_width:
        return "watch", pts
    return "out-of-range", pts


def short_date(d: date | None) -> str | None:
    if d is None:
        return None
    return d.strftime("%b %d, %Y")
