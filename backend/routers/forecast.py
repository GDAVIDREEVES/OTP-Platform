"""Latest-Estimate forecast workpaper (OTP-24).

Read-only. The full-year Latest Estimate (LE) is **derived from real actuals**:
we read the same monthly ``segment_pl`` source as ``/api/segments/pl`` /
OTP-20 / OTP-21, sum actuals-to-date per tested party, and project the
remaining months by simple run-rate (the average month-to-date, repeated for
the months with no posting yet). There is **no separate seeded budget** — LE is
``actuals_to_date + forecast_remainder`` and reconciles with the segmented P&L
by construction.

Per tested party we return actuals-to-date, the run-rate remainder, the full-year
LE (revenue / operating profit / margin), the arm's-length target band
(``OM_LOW_PCT`` / ``OM_HIGH_PCT`` from ``entity_roles`` — the exact band behind
OTP-20), and the projected in/watch/out status via the shared
``services.status.compute_status`` so the early-warning verdict matches the
monitoring screen.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from constants import ENTITY_DIM, ROLE_FUNCTION
from db import q
from services.status import compute_status, fmt_pct_band

router = APIRouter()

# Full fiscal year is 12 monthly periods (POPER 001..012); the run-rate projects
# the remaining months from the months actually posted to date.
FULL_YEAR_MONTHS = 12


@router.get("/api/forecast")
def forecast(year: int = 2026) -> dict[str, Any]:
    """Full-year Latest Estimate per tested party for ``year``.

    Aggregates the monthly ``segment_pl`` actuals-to-date per RBUKRS, projects
    the remaining months by run-rate, and tests the resulting full-year margin
    against the entity's arm's-length band. Returns a graceful empty model (one
    zeroed row per entity in the band table) when the year has no data.
    """
    # Actuals-to-date per tested party: sum the monthly actuals and count the
    # distinct months posted so the run-rate divides by the right denominator.
    rows = q(
        """
        SELECT RBUKRS,
               COUNT(DISTINCT POPER)  AS months_posted,
               SUM(revenue)           AS revenue,
               SUM(operating_profit)  AS operating_profit
        FROM segment_pl
        WHERE GJAHR = ?
        GROUP BY RBUKRS
        """,
        [year],
    )
    by_id = {str(r["RBUKRS"]): r for r in rows}

    # The tested-party universe + arm's-length bands come from entity_roles —
    # the same source OTP-20 uses for its status verdict.
    band_rows = q(
        "SELECT RBUKRS, ROLE_CODE, ROLE_DESCRIPTION, OM_LOW_PCT, OM_HIGH_PCT "
        "FROM entity_roles ORDER BY RBUKRS"
    )

    parties: list[dict[str, Any]] = []
    for b in band_rows:
        rb = str(b["RBUKRS"])
        low = float(b["OM_LOW_PCT"] or 0)
        high = float(b["OM_HIGH_PCT"] or 0)
        dim = ENTITY_DIM.get(rb, {})

        a = by_id.get(rb)
        months_posted = int(a["months_posted"]) if a and a["months_posted"] else 0
        actual_revenue = float(a["revenue"]) if a and a["revenue"] is not None else 0.0
        actual_profit = float(a["operating_profit"]) if a and a["operating_profit"] is not None else 0.0

        if months_posted > 0:
            months_remaining = max(FULL_YEAR_MONTHS - months_posted, 0)
            # Run-rate: average posted month, repeated for the unposted months.
            run_rate_revenue = actual_revenue / months_posted
            run_rate_profit = actual_profit / months_posted
            remainder_revenue = run_rate_revenue * months_remaining
            remainder_profit = run_rate_profit * months_remaining
        else:
            months_remaining = FULL_YEAR_MONTHS
            remainder_revenue = 0.0
            remainder_profit = 0.0

        le_revenue = actual_revenue + remainder_revenue
        le_profit = actual_profit + remainder_profit
        le_margin = (le_profit / le_revenue) if le_revenue else None

        # Project the early-warning verdict from the full-year LE margin against
        # the arm's-length band — same rule (and tolerances) as OTP-20.
        status, variance = compute_status(le_margin, low, high)

        parties.append(
            {
                "rbukrs": rb,
                "name": dim.get("display_name", f"Entity {rb}"),
                "country": dim.get("country", ""),
                "function": dim.get("function") or ROLE_FUNCTION.get(b["ROLE_CODE"], "Other"),
                "roleCode": b["ROLE_CODE"],
                "tpRole": b["ROLE_DESCRIPTION"],
                "monthsPosted": months_posted,
                "monthsRemaining": months_remaining,
                "actuals": {
                    "revenue": round(actual_revenue, 2),
                    "operating_profit": round(actual_profit, 2),
                    "margin": round(actual_profit / actual_revenue * 100, 2) if actual_revenue else None,
                },
                "forecastRemainder": {
                    "revenue": round(remainder_revenue, 2),
                    "operating_profit": round(remainder_profit, 2),
                },
                "latestEstimate": {
                    "revenue": round(le_revenue, 2),
                    "operating_profit": round(le_profit, 2),
                },
                "fullYearMargin": round(le_margin * 100, 2) if le_margin is not None else None,
                "targetMarginLow": round(low * 100, 2),
                "targetMarginHigh": round(high * 100, 2),
                "targetMarginLabel": fmt_pct_band(low, high),
                "variance": variance,
                "status": status,
            }
        )

    return {
        "year": year,
        "fullYearMonths": FULL_YEAR_MONTHS,
        "basis": "run-rate",
        "parties": parties,
    }
