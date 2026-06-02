"""Business logic for /api/entities — shared between the entities and KPI routers."""

from __future__ import annotations

from typing import Any

from constants import ENTITY_CCY, ENTITY_DIM, ROLE_FUNCTION
from db import q
from period_filter import PeriodFilter
from services.labels import pretty_method
from services.status import compute_status, fmt_pct_band, short_date


def list_entities(
    pf: PeriodFilter, entity_id: str | None = None
) -> list[dict[str, Any]]:
    """Return one row per legal entity in the format the React `Entity` type expects.

    Pass `entity_id` to filter to a single entity in SQL (used by the
    /api/entities/{id} detail route) instead of materialising every entity.
    """
    pf_clause, pf_params = pf.where()
    entity_clause = " WHERE r.RBUKRS = ?" if entity_id is not None else ""
    sql = f"""
    WITH ytd AS (
      SELECT RBUKRS,
             SUM(revenue)          AS ytd_revenue,
             SUM(operating_profit) AS ytd_op_profit,
             CASE WHEN SUM(revenue) <> 0
                  THEN SUM(operating_profit) / SUM(revenue)
                  ELSE NULL END   AS ytd_margin
      FROM segment_pl
      WHERE 1=1 {pf_clause}
      GROUP BY 1
    ),
    latest_p AS (
      SELECT MAX(POPER) AS p, MAX(GJAHR) AS y
      FROM segment_pl
      WHERE 1=1 {pf_clause}
    ),
    current AS (
      SELECT s.RBUKRS, s.operating_margin AS current_margin
      FROM segment_pl s, latest_p
      WHERE s.POPER = latest_p.p AND s.GJAHR = latest_p.y
    ),
    last_post AS (
      SELECT RBUKRS, MAX(BUDAT) AS last_posted
      FROM journal
      GROUP BY 1
    ),
    method AS (
      SELECT BUYING_COMPANY AS RBUKRS,
             ARG_MAX(TP_METHOD, n) AS tp_method
      FROM (
        SELECT BUYING_COMPANY, TP_METHOD, COUNT(*) AS n
        FROM supply_chain
        GROUP BY 1, 2
      )
      GROUP BY 1
    ),
    sell_method AS (
      SELECT SELLING_COMPANY AS RBUKRS,
             ARG_MAX(TP_METHOD, n) AS tp_method
      FROM (
        SELECT SELLING_COMPANY, TP_METHOD, COUNT(*) AS n
        FROM supply_chain
        GROUP BY 1, 2
      )
      GROUP BY 1
    )
    SELECT r.RBUKRS, r.LAND1, r.ROLE_CODE, r.ROLE_DESCRIPTION,
           r.OM_LOW_PCT, r.OM_HIGH_PCT,
           y.ytd_revenue, y.ytd_op_profit, y.ytd_margin,
           c.current_margin,
           lp.last_posted,
           COALESCE(m.tp_method, sm.tp_method) AS tp_method
    FROM entity_roles r
    LEFT JOIN ytd        y  USING (RBUKRS)
    LEFT JOIN current    c  USING (RBUKRS)
    LEFT JOIN last_post  lp USING (RBUKRS)
    LEFT JOIN method     m  USING (RBUKRS)
    LEFT JOIN sell_method sm USING (RBUKRS)
    {entity_clause}
    ORDER BY r.RBUKRS
    """
    # Period clause appears twice (ytd CTE + latest_p CTE), so duplicate the
    # params; the optional entity filter binds last (outer WHERE).
    params = pf_params + pf_params + ([entity_id] if entity_id is not None else [])
    rows = q(sql, params)
    out: list[dict[str, Any]] = []
    for r in rows:
        rb = r["RBUKRS"]
        dim = ENTITY_DIM.get(rb, {})
        actual = float(r["ytd_margin"]) if r["ytd_margin"] is not None else None
        latest = float(r["current_margin"]) if r["current_margin"] is not None else None
        low = float(r["OM_LOW_PCT"] or 0)
        high = float(r["OM_HIGH_PCT"] or 0)
        status, variance = compute_status(actual, low, high)

        out.append({
            "id": rb,
            "name": dim.get("display_name", f"Entity {rb}"),
            "country": dim.get("country", r["LAND1"]),
            "countryCode": dim.get("country_code", r["LAND1"]),
            "function": dim.get("function") or ROLE_FUNCTION.get(r["ROLE_CODE"], "Other"),
            "tpRole": r["ROLE_DESCRIPTION"],
            "tpMethod": pretty_method(r["tp_method"]),
            "ytdVolume": float(r["ytd_revenue"] or 0),
            "ytdOpProfit": float(r["ytd_op_profit"] or 0),
            "actualMargin": round(actual * 100, 2) if actual is not None else None,
            "latestPeriodMargin": round(latest * 100, 2) if latest is not None else None,
            "targetMarginLow": round(low * 100, 2),
            "targetMarginHigh": round(high * 100, 2),
            "targetMarginLabel": fmt_pct_band(low, high),
            "variance": variance,
            "status": status,
            "lastUpdated": short_date(r["last_posted"]),
            "lat": dim.get("lat", 0),
            "lng": dim.get("lng", 0),
            "currency": ENTITY_CCY.get(rb, "USD"),
            "roleCode": r["ROLE_CODE"],
        })
    return out
