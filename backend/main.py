"""
OTP Platform backend — FastAPI service over DuckDB + parquet.

Single-file API that serves the React frontend at parity with its mock-data
contracts (Entity, TransactionFlow, Invoice, Royalty, monthlyMarginTrend),
then adds drill-downs that the mocks couldn't (segment P&L, journal entries).

Run:  uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Any, Optional

import duckdb
from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import store

# ------------------------------------------------------------------
# Config
# ------------------------------------------------------------------
load_dotenv()

BASE_DIR = Path(__file__).parent
DATA_DIR = Path(
    os.getenv(
        "DATA_DIR",
        "/Users/gregreeves/Documents/acdoca_exports/20260429-115302 NEW 29april26",
    )
)
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://localhost:3000"
    ).split(",")
    if o.strip()
]

ENTITY_ROLES = str(DATA_DIR / "entity_roles" / "*.parquet")
SEGMENT_PL = str(DATA_DIR / "segment_pl" / "*.parquet")
SUPPLY_CHAIN = str(DATA_DIR / "supply_chain_flows" / "*.parquet")
JOURNAL = str(DATA_DIR / "journal_entries" / "*.parquet")

# Static dimension table: SAP company code (RBUKRS) -> display fields used by the UI
with open(BASE_DIR / "dim" / "entity_dim.json", encoding="utf-8") as f:
    ENTITY_DIM = {row["rbukrs"]: row for row in json.load(f)["entities"]}

# Local-currency lookup so amounts come back tagged correctly.
# Derived once from journal_entries' RHCUR; encoded statically for performance.
ENTITY_CCY = {
    "1000": "USD", "3000": "EUR", "3100": "CHF", "3200": "EUR",
    "3300": "GBP", "3400": "EUR", "3800": "EUR", "4100": "INR",
}

# Friendly labels for the role taxonomy
ROLE_FUNCTION = {
    "IPPR": "Principal",
    "FRMF": "Manufacturer",
    "TOLL": "Manufacturer",
    "LRD":  "Distributor",
    "FINC": "Treasury / Finance",
}

MATERIAL_LABELS = {
    "FG":         "Tangible Goods Sales",
    "SEMI":       "Tangible Goods Sales",
    "RAW":        "Tangible Goods Sales",
    "ROYALTY":    "Royalties",
    "SERVICE":    "Management / Concept Fees",
    "COST_SHARE": "Cost Sharing",
}


# ------------------------------------------------------------------
# DuckDB connection (one in-memory instance, queries hit parquet directly)
# ------------------------------------------------------------------
_con: duckdb.DuckDBPyConnection | None = None


def db() -> duckdb.DuckDBPyConnection:
    global _con
    if _con is None:
        _con = duckdb.connect(database=":memory:", read_only=False)
        # Memory-friendly settings for analytical queries
        _con.execute("SET memory_limit='2GB'")
        _con.execute("SET threads=4")
    return _con


def q(sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
    """Execute SQL and return rows as a list of dicts (JSON-friendly).

    Uses a fresh DuckDB cursor per call so concurrent FastAPI requests don't
    collide on the connection's internal cursor.
    """
    cur = db().cursor()
    try:
        cur.execute(sql, params or [])
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        cur.close()


# ------------------------------------------------------------------
# Domain helpers
# ------------------------------------------------------------------
def fmt_pct_band(low: float, high: float) -> str:
    if low == 0 and high == 0:
        return "—"
    return f"{int(round(low * 100))}–{int(round(high * 100))}%"


def compute_status(actual_margin: float | None, low: float, high: float) -> tuple[str, float | None]:
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


# ------------------------------------------------------------------
# Period filter — applied to every endpoint that reads time-series data.
# Frontend passes ?year=&periodFrom=&periodTo=. Defaults span all 2026.
# ------------------------------------------------------------------
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


# ------------------------------------------------------------------
# Lifespan: warm DuckDB on startup
# ------------------------------------------------------------------
@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Eager init + sanity check
    db().execute("SELECT 1").fetchone()
    if not (DATA_DIR / "entity_roles").is_dir():
        raise RuntimeError(f"DATA_DIR not found or missing entity_roles/: {DATA_DIR}")
    yield
    if _con is not None:
        _con.close()


app = FastAPI(title="OTP Platform API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------
# Health
# ------------------------------------------------------------------
@app.get("/api/health")
def health():
    rows = q(f"SELECT COUNT(*) AS n FROM read_parquet('{ENTITY_ROLES}')")
    return {
        "ok": True,
        "data_dir": str(DATA_DIR),
        "entity_roles_rows": rows[0]["n"],
    }


# ------------------------------------------------------------------
# Entities — drives Dashboard, Policy, SegmentedPnL, PriceSetting, WorldMap
# ------------------------------------------------------------------
@app.get("/api/entities")
def list_entities(
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    """
    Return one row per legal entity in the format the React `Entity` type expects.
    Joins entity_roles (target band + role) with segment_pl (actuals) and
    journal_entries (last posting date).
    Margin/volume aggregates respect the period filter so the dashboard can
    show "Q4 only" or "FY" views.
    """
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    # Build the SQL with the period filter folded into the segment_pl reads.
    # Note: clauses are inlined (no `?`) for the ytd/current CTEs to keep param ordering simple,
    # but we still parameterise via the params list.
    sql = f"""
    WITH ytd AS (
      SELECT RBUKRS,
             SUM(revenue)          AS ytd_revenue,
             SUM(operating_profit) AS ytd_op_profit,
             CASE WHEN SUM(revenue) <> 0
                  THEN SUM(operating_profit) / SUM(revenue)
                  ELSE NULL END   AS ytd_margin
      FROM read_parquet('{SEGMENT_PL}')
      WHERE 1=1 {pf_clause}
      GROUP BY 1
    ),
    latest_p AS (
      SELECT MAX(POPER) AS p, MAX(GJAHR) AS y
      FROM read_parquet('{SEGMENT_PL}')
      WHERE 1=1 {pf_clause}
    ),
    current AS (
      SELECT s.RBUKRS, s.operating_margin AS current_margin
      FROM read_parquet('{SEGMENT_PL}') s, latest_p
      WHERE s.POPER = latest_p.p AND s.GJAHR = latest_p.y
    ),
    last_post AS (
      SELECT RBUKRS, MAX(BUDAT) AS last_posted
      FROM read_parquet('{JOURNAL}')
      GROUP BY 1
    ),
    method AS (
      -- dominant TP method on flows where the entity is the buyer (tested party heuristic)
      SELECT BUYING_COMPANY AS RBUKRS,
             ARG_MAX(TP_METHOD, n) AS tp_method
      FROM (
        SELECT BUYING_COMPANY, TP_METHOD, COUNT(*) AS n
        FROM read_parquet('{SUPPLY_CHAIN}')
        GROUP BY 1, 2
      )
      GROUP BY 1
    ),
    sell_method AS (
      SELECT SELLING_COMPANY AS RBUKRS,
             ARG_MAX(TP_METHOD, n) AS tp_method
      FROM (
        SELECT SELLING_COMPANY, TP_METHOD, COUNT(*) AS n
        FROM read_parquet('{SUPPLY_CHAIN}')
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
    FROM read_parquet('{ENTITY_ROLES}') r
    LEFT JOIN ytd        y  USING (RBUKRS)
    LEFT JOIN current    c  USING (RBUKRS)
    LEFT JOIN last_post  lp USING (RBUKRS)
    LEFT JOIN method     m  USING (RBUKRS)
    LEFT JOIN sell_method sm USING (RBUKRS)
    ORDER BY r.RBUKRS
    """
    # Period clause appears twice (ytd CTE + latest_p CTE), so duplicate the params.
    rows = q(sql, pf_params + pf_params)
    out: list[dict[str, Any]] = []
    for r in rows:
        rb = r["RBUKRS"]
        dim = ENTITY_DIM.get(rb, {})
        # Status is driven by revenue-weighted YTD margin (matches financials)
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
            "tpMethod": _pretty_method(r["tp_method"]),
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


def _pretty_method(m: str | None) -> str:
    if not m:
        return "TNMM"
    base = m.replace("/APA", "")
    return {
        "CUP": "CUP",
        "COST_PLUS": "Cost Plus",
        "RPM": "Resale Price",
    }.get(base, base.replace("_", " ").title())


@app.get("/api/entities/{entity_id}")
def get_entity(
    entity_id: str,
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    rows = list_entities(year=year, periodFrom=periodFrom, periodTo=periodTo)
    for e in rows:
        if e["id"] == entity_id:
            return e
    raise HTTPException(status_code=404, detail=f"Entity {entity_id} not found")


# ------------------------------------------------------------------
# Per-entity material-type breakdown — drives EntityDetail drill-down
# ------------------------------------------------------------------
@app.get("/api/entities/{entity_id}/flows")
def entity_flows(
    entity_id: str,
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    """
    Return the supply-chain flows the entity participates in, grouped by
    material type and direction (this entity sells vs. buys), with volume,
    APA / CHALLENGED flags, and counterparty list.
    """
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    sql = f"""
      WITH base AS (
        SELECT
          CASE WHEN SELLING_COMPANY = ? THEN 'sell'
               WHEN BUYING_COMPANY  = ? THEN 'buy' END AS direction,
          MATERIAL_TYPE,
          TP_METHOD,
          CASE WHEN SELLING_COMPANY = ? THEN BUYING_COMPANY
               ELSE SELLING_COMPANY END AS counterparty,
          TOTAL_LEGAL_PRICE,
          APA_FLAG,
          CHALLENGED_FLAG,
          CHAIN_ID
        FROM read_parquet('{SUPPLY_CHAIN}')
        WHERE (SELLING_COMPANY = ? OR BUYING_COMPANY = ?) {pf_clause}
      )
      SELECT
        direction,
        MATERIAL_TYPE,
        TP_METHOD,
        SUM(TOTAL_LEGAL_PRICE) AS ytd_volume,
        COUNT(*) AS step_count,
        COUNT(DISTINCT CHAIN_ID) AS chains,
        BOOL_OR(APA_FLAG) AS any_apa,
        BOOL_OR(CHALLENGED_FLAG) AS any_challenged,
        LIST(DISTINCT counterparty) AS counterparties
      FROM base
      GROUP BY 1, 2, 3
      ORDER BY direction, ytd_volume DESC
    """
    rows = q(sql, [entity_id, entity_id, entity_id, entity_id, entity_id, *pf_params])
    return [
        {
            "direction": r["direction"],
            "materialType": r["MATERIAL_TYPE"],
            "materialLabel": MATERIAL_LABELS.get(r["MATERIAL_TYPE"], r["MATERIAL_TYPE"]),
            "tpMethod": _pretty_method(r["TP_METHOD"]),
            "ytdVolume": float(r["ytd_volume"] or 0),
            "stepCount": r["step_count"],
            "chains": r["chains"],
            "apa": bool(r["any_apa"]),
            "challenged": bool(r["any_challenged"]),
            "counterparties": r["counterparties"],
        }
        for r in rows
    ]


# ------------------------------------------------------------------
# KPI summary — drives Dashboard top cards
# ------------------------------------------------------------------
@app.get("/api/kpis")
def kpis(
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    entities = list_entities(year=year, periodFrom=periodFrom, periodTo=periodTo)
    total_volume = sum(e["ytdVolume"] for e in entities)
    in_range = sum(1 for e in entities if e["status"] == "in-range")
    watch = sum(1 for e in entities if e["status"] == "watch")
    out_of_range = sum(1 for e in entities if e["status"] == "out-of-range")

    # Quick "open adjustments" count — one per OOR entity
    open_adj = sum(1 for e in entities if e["status"] == "out-of-range")

    # APA / Challenged flow counts (distinct chains) — surface tax-controversy posture
    pf_clause, pf_params = pf.where()
    apa_chains = q(
        f"""
        SELECT COUNT(DISTINCT CHAIN_ID) AS n
        FROM read_parquet('{SUPPLY_CHAIN}')
        WHERE APA_FLAG = TRUE {pf_clause}
        """,
        pf_params,
    )[0]["n"]
    challenged_chains = q(
        f"""
        SELECT COUNT(DISTINCT CHAIN_ID) AS n
        FROM read_parquet('{SUPPLY_CHAIN}')
        WHERE CHALLENGED_FLAG = TRUE {pf_clause}
        """,
        pf_params,
    )[0]["n"]

    return {
        "totalICVolume": total_volume,
        "entityCount": len(entities),
        "entitiesInRange": in_range,
        "entitiesWatch": watch,
        "entitiesOutOfRange": out_of_range,
        "openAdjustments": open_adj,
        "flowsUnderAPA": int(apa_chains or 0),
        "flowsChallenged": int(challenged_chains or 0),
    }


# ------------------------------------------------------------------
# Margin trend — Dashboard chart + EntityDetail trend
# ------------------------------------------------------------------
@app.get("/api/margins/trend")
def margin_trend(
    entities: Optional[str] = Query(None, description="Comma-separated RBUKRS list"),
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    """
    Returns wide-format rows usable directly by Recharts:
      [{ "month": "Jan", "1000": 35.3, "3000": 12.1, ... }, ...]
    """
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    where_parts = []
    params: list[Any] = []
    if entities:
        ids = [e.strip() for e in entities.split(",") if e.strip()]
        if ids:
            placeholders = ",".join("?" for _ in ids)
            where_parts.append(f"RBUKRS IN ({placeholders})")
            params.extend(ids)
    where = ("WHERE " + " AND ".join(where_parts)) if where_parts else "WHERE 1=1"

    sql = f"""
      SELECT RBUKRS, GJAHR, POPER, operating_margin
      FROM read_parquet('{SEGMENT_PL}')
      {where} {pf_clause}
      ORDER BY RBUKRS, GJAHR, POPER
    """
    rows = q(sql, params + pf_params)
    months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    pivot: dict[str, dict[str, Any]] = {m: {"month": m} for m in months}
    for r in rows:
        idx = int(r["POPER"]) - 1
        if 0 <= idx < 12:
            pivot[months[idx]][r["RBUKRS"]] = round(float(r["operating_margin"]) * 100, 2)
    return list(pivot.values())


# ------------------------------------------------------------------
# Transaction flows — Policy screen
# ------------------------------------------------------------------
@app.get("/api/transactions/flows")
def list_flows(
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    sql = f"""
      SELECT MATERIAL_TYPE,
             SELLER_ROLE,
             BUYER_ROLE,
             TP_METHOD,
             COUNT(*)                    AS step_count,
             COUNT(DISTINCT CHAIN_ID)    AS chains,
             SUM(TOTAL_LEGAL_PRICE)      AS ytd_volume,
             BOOL_OR(APA_FLAG)           AS any_apa,
             BOOL_OR(CHALLENGED_FLAG)    AS any_challenged,
             LIST(DISTINCT SELLING_COMPANY) AS sellers,
             LIST(DISTINCT BUYING_COMPANY)  AS buyers
      FROM read_parquet('{SUPPLY_CHAIN}')
      WHERE 1=1 {pf_clause}
      GROUP BY 1,2,3,4
      ORDER BY ytd_volume DESC
    """
    rows = q(sql, pf_params)
    out = []
    for i, r in enumerate(rows, start=1):
        # Derive a deterministic status from the challenged/APA flags
        if r["any_challenged"]:
            status = "out-of-range"
        elif r["any_apa"]:
            status = "watch"
        else:
            status = "in-range"
        out.append({
            "id": f"TXN-{i:03d}",
            "type": MATERIAL_LABELS.get(r["MATERIAL_TYPE"], r["MATERIAL_TYPE"]),
            "materialType": r["MATERIAL_TYPE"],
            "description": _describe_flow(r),
            "payors": r["buyers"],   # buyers pay the sellers
            "payees": r["sellers"],
            "tpMethod": _pretty_method(r["TP_METHOD"]),
            "pli": _pli_for(r["TP_METHOD"]),
            "ytdVolume": float(r["ytd_volume"] or 0),
            "status": status,
            "apa": bool(r["any_apa"]),
            "challenged": bool(r["any_challenged"]),
            "sellerRole": r["SELLER_ROLE"],
            "buyerRole": r["BUYER_ROLE"],
            "chains": r["chains"],
        })
    return out


def _describe_flow(r: dict[str, Any]) -> str:
    mat = MATERIAL_LABELS.get(r["MATERIAL_TYPE"], r["MATERIAL_TYPE"])
    return f"{mat}: {r['SELLER_ROLE']} → {r['BUYER_ROLE']} ({_pretty_method(r['TP_METHOD'])})"


def _pli_for(method: str | None) -> str:
    base = (method or "").replace("/APA", "")
    return {
        "CUP": "Comparable price",
        "COST_PLUS": "Markup on cost",
        "RPM": "Gross resale margin",
    }.get(base, "Operating margin")


# ------------------------------------------------------------------
# Royalties — Royalties screen
# ------------------------------------------------------------------
@app.get("/api/transactions/royalties")
def list_royalties(
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    sql = f"""
      SELECT IP_OWNER, SELLING_COMPANY, BUYING_COMPANY, MATNR, TP_METHOD,
             AVG(MARKUP_RATE) * 100 AS rate_pct,
             SUM(TOTAL_LEGAL_PRICE) AS ytd_fees,
             BOOL_OR(APA_FLAG) AS any_apa,
             BOOL_OR(CHALLENGED_FLAG) AS any_challenged
      FROM read_parquet('{SUPPLY_CHAIN}')
      WHERE MATERIAL_TYPE = 'ROYALTY' {pf_clause}
      GROUP BY 1,2,3,4,5
      ORDER BY ytd_fees DESC
    """
    rows = q(sql, pf_params)
    out = []
    # naive benchmark range — ±1.5pp around observed rate; keeps the UI honest
    # without a real benchmark dim table
    for i, r in enumerate(rows, start=1):
        rate = float(r["rate_pct"] or 0)
        # IP-category guess from MATNR — would be replaced by a real dim
        ip_category = _ip_category_for(r["MATNR"])
        bench_low = max(0.0, rate - 1.5)
        bench_high = rate + 1.5
        within = bench_low <= rate <= bench_high
        out.append({
            "id": f"RY-{i:03d}",
            "ipCategory": ip_category,
            "licensor": r["SELLING_COMPANY"],
            "licensee": r["BUYING_COMPANY"],
            "ipOwner": r["IP_OWNER"],
            "matnr": r["MATNR"],
            "rate": round(rate, 2),
            "base": "Net Sales",
            "benchmarkRange": f"{bench_low:.1f}–{bench_high:.1f}%",
            "ytdFees": float(r["ytd_fees"] or 0),
            "withinBenchmark": within,
            "jurisdictionNote": _wht_note(r["SELLING_COMPANY"], r["BUYING_COMPANY"]),
            "method": _pretty_method(r["TP_METHOD"]),
            "apa": bool(r["any_apa"]),
            "challenged": bool(r["any_challenged"]),
        })
    return out


def _ip_category_for(matnr: str | None) -> str:
    if not matnr:
        return "Other IP"
    m = matnr.upper()
    if "TM" in m or "BRAND" in m:
        return "Distribution Trademarks"
    if "PAT" in m or "API" in m:
        return "Core Manufacturing Patents"
    if "SW" in m or "PLAT" in m:
        return "Software & Platform IP"
    return "Process Know-How"


def _wht_note(licensor: str, licensee: str) -> str:
    licensor_cc = ENTITY_DIM.get(licensor, {}).get("country_code", "")
    licensee_cc = ENTITY_DIM.get(licensee, {}).get("country_code", "")
    return f"{licensee_cc}–{licensor_cc} treaty applies"


# ------------------------------------------------------------------
# Invoices — Invoicing screen (synthesized from supply_chain_flows)
# ------------------------------------------------------------------
@app.get("/api/invoices")
def list_invoices(
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    """
    One invoice per (selling, buying, period, material_type) bucket.
    Status is bucketed by period: latest = Pending Approval, mid = Approved,
    earliest = Exported. Older = Draft. This gives the UI a realistic mix
    without requiring a workflow store.
    """
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    sql = f"""
      SELECT SELLING_COMPANY AS payee,
             BUYING_COMPANY  AS payor,
             GJAHR, POPER,
             MATERIAL_TYPE,
             SUM(TOTAL_LEGAL_PRICE) AS amount
      FROM read_parquet('{SUPPLY_CHAIN}')
      WHERE 1=1 {pf_clause}
      GROUP BY 1,2,3,4,5
      HAVING SUM(TOTAL_LEGAL_PRICE) > 0
      ORDER BY GJAHR DESC, POPER DESC, amount DESC
    """
    rows = q(sql, pf_params)
    max_period = max((int(r["POPER"]) for r in rows), default=12)
    out = []
    # Real submitted adjustments come first — they're the live workflow items
    for adj in store.list_adjustments():
        out.append({
            "id": adj["id"],
            "date": (adj.get("submittedAt") or "")[:10],
            "payor": adj["entityId"],
            "payee": "",  # adjustments are entity-internal — no counterparty
            "type": f"Year-End TP Adjustment ({adj.get('mode','')})",
            "amount": float(adj["amount"]),
            "currency": adj.get("currency", "USD"),
            "status": adj.get("status", "Pending Approval"),
            "period": "012",
            "year": 0,
            "submitted": True,  # marker so the UI can highlight these
        })
    for i, r in enumerate(rows[:60]):  # cap for UI
        period_int = int(r["POPER"])
        # status bucket
        if period_int == max_period:
            status = "Pending Approval"
        elif period_int >= max_period - 2:
            status = "Approved"
        elif period_int >= max_period - 5:
            status = "Exported"
        else:
            status = "Exported"
        currency = ENTITY_CCY.get(r["payor"], "USD")
        type_label = MATERIAL_LABELS.get(r["MATERIAL_TYPE"], r["MATERIAL_TYPE"])
        out.append({
            "id": f"INV-{r['GJAHR']}-{1000 + i:04d}",
            "date": f"{r['GJAHR']}-{period_int:02d}-20",
            "payor": r["payor"],
            "payee": r["payee"],
            "type": f"{type_label} — P{period_int:02d}",
            "amount": float(r["amount"]),
            "currency": currency,
            "status": status,
            "period": r["POPER"],
            "year": int(r["GJAHR"]),
            "submitted": False,
        })
    return out


# ------------------------------------------------------------------
# Segment P&L — SegmentedPnL + DetailedPnL
# ------------------------------------------------------------------
@app.get("/api/segments/pl")
def segment_pl(
    entity: Optional[str] = None,
    period: Optional[str] = Query(None, description="POPER like '012'"),
    year: Optional[int] = None,
):
    where_parts = []
    params: list[Any] = []
    if entity:
        where_parts.append("RBUKRS = ?"); params.append(entity)
    if period:
        where_parts.append("POPER = ?");  params.append(period)
    if year:
        where_parts.append("GJAHR = ?");  params.append(year)
    where = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    sql = f"""
      SELECT RBUKRS, ROLE_CODE, SEGMENT, GJAHR, POPER,
             revenue, other_income, cogs,
             opex_production, opex_rd, opex_sm, opex_ga, opex_dist,
             ic_charges, depreciation,
             operating_profit, operating_margin
      FROM read_parquet('{SEGMENT_PL}')
      {where}
      ORDER BY RBUKRS, GJAHR, POPER
    """
    rows = q(sql, params)
    # Cast Decimals to float for JSON
    return [
        {**r,
         **{k: (float(v) if v is not None else None)
            for k, v in r.items()
            if k in ("revenue","other_income","cogs","opex_production","opex_rd",
                     "opex_sm","opex_ga","opex_dist","ic_charges","depreciation",
                     "operating_profit","operating_margin")}
        }
        for r in rows
    ]


# ------------------------------------------------------------------
# Write-side endpoints — adjustments, policy overrides, settings
# All persistence goes through backend/store.py (atomic JSON file).
# ------------------------------------------------------------------
@app.get("/api/years")
def list_years():
    """Distinct fiscal years present in the data — drives the FY dropdown."""
    rows = q(
        f"""
        SELECT DISTINCT GJAHR AS y FROM read_parquet('{SEGMENT_PL}')
        UNION
        SELECT DISTINCT GJAHR FROM read_parquet('{JOURNAL}')
        UNION
        SELECT DISTINCT GJAHR FROM read_parquet('{SUPPLY_CHAIN}')
        ORDER BY y DESC
        """
    )
    return [int(r["y"]) for r in rows if r["y"] is not None]


@app.get("/api/adjustments")
def list_submitted_adjustments():
    return store.list_adjustments()


@app.post("/api/adjustments")
def post_adjustment(payload: dict[str, Any] = Body(...)):
    required = {"entityId", "amount", "currency", "mode", "targetMargin", "actualMargin", "submittedBy"}
    missing = required - payload.keys()
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing fields: {sorted(missing)}")
    return store.submit_adjustment(payload)


@app.patch("/api/adjustments/{adj_id}")
def patch_adjustment(adj_id: str, payload: dict[str, Any] = Body(...)):
    """Update status / approver / notes on an adjustment."""
    try:
        record = store.update_adjustment(adj_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if record is None:
        raise HTTPException(status_code=404, detail=f"Adjustment {adj_id} not found")
    return record


@app.delete("/api/adjustments/{adj_id}")
def delete_adjustment(adj_id: str):
    """Hard-delete a still-pending adjustment. Approved/Exported require reversal."""
    deleted = store.delete_adjustment(adj_id)
    if not deleted:
        raise HTTPException(
            status_code=409,
            detail=f"Adjustment {adj_id} not found, or already approved (use reverse instead).",
        )
    return {"deleted": adj_id}


@app.post("/api/adjustments/{adj_id}/reverse")
def reverse_adjustment(adj_id: str, payload: dict[str, Any] = Body(default={})):
    """Mark original as Reversed and create a counter-adjustment with opposite sign."""
    counter = store.reverse_adjustment(adj_id, by=payload.get("by"))
    if counter is None:
        raise HTTPException(
            status_code=409,
            detail=f"Adjustment {adj_id} not found or already reversed.",
        )
    return counter


@app.get("/api/overrides/policy")
def get_policy_overrides():
    return store.list_policy_overrides()


@app.put("/api/overrides/policy/{flow_id}")
def put_policy_override(flow_id: str, payload: dict[str, Any] = Body(...)):
    return store.upsert_policy_override(flow_id, payload)


@app.get("/api/settings")
def get_settings():
    return store.get_settings()


@app.put("/api/settings")
def put_settings(payload: dict[str, Any] = Body(...)):
    return store.update_settings(payload)


# ------------------------------------------------------------------
# Berry ratio — drives ProductPricing chart
# ------------------------------------------------------------------
@app.get("/api/berry")
def berry_trend(
    entity: Optional[str] = Query(None, description="RBUKRS to filter (default: aggregate of LRDs)"),
    target: float = Query(1.20, description="Target Berry ratio for the band line"),
    year: int | None = None,
    periodFrom: str | None = None,
    periodTo: str | None = None,
):
    """
    Monthly Berry ratio = Gross Profit / Operating Expenses (S,G&A only).

    For an LRD context the denominator-of-sales naturally includes IC charges,
    so we compute:
        gp   = revenue - cogs - opex_production - ic_charges
        opex = opex_rd + opex_sm + opex_ga + opex_dist     (S,G,&A only)
        berry = gp / opex

    Returns one row per fiscal period with month label, gp, opex, ratio,
    and the requested target. If `entity` is omitted, aggregates all LRDs.
    """
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    where = ""
    params: list[Any] = []
    if entity:
        where = "WHERE RBUKRS = ?"
        params.append(entity)
    else:
        # Default: aggregate the three LRDs in the dataset
        where = "WHERE RBUKRS IN ('3200', '3300', '3800')"

    sql = f"""
      SELECT GJAHR,
             POPER,
             SUM(revenue)         AS revenue,
             SUM(cogs)            AS cogs,
             SUM(ic_charges)      AS ic_charges,
             SUM(COALESCE(opex_production,0)) AS opex_production,
             SUM(COALESCE(opex_rd,0)
               + COALESCE(opex_sm,0)
               + COALESCE(opex_ga,0)
               + COALESCE(opex_dist,0)) AS opex_sga
      FROM read_parquet('{SEGMENT_PL}')
      {where} {pf_clause}
      GROUP BY 1, 2
      ORDER BY 1, 2
    """
    rows = q(sql, params + pf_params)
    months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    out = []
    for r in rows:
        revenue = float(r["revenue"] or 0)
        cogs = float(r["cogs"] or 0)
        ic = float(r["ic_charges"] or 0)
        prod = float(r["opex_production"] or 0)
        opex = float(r["opex_sga"] or 0)
        gp = revenue - cogs - prod - ic
        berry = (gp / opex) if opex > 0 else None
        idx = int(r["POPER"]) - 1 if r["POPER"] else 0
        out.append({
            "year": int(r["GJAHR"]),
            "period": r["POPER"],
            "month": months[idx] if 0 <= idx < 12 else r["POPER"],
            "revenue": round(revenue, 2),
            "gp": round(gp, 2),
            "opex": round(opex, 2),
            "berry": round(berry, 3) if berry is not None else None,
            "target": target,
        })
    return out


# ------------------------------------------------------------------
# Journal entries — drill-down for Adjustment / EntityDetail
# ------------------------------------------------------------------
@app.get("/api/journal-entries")
def journal_entries(
    entity: Optional[str] = None,
    period: Optional[str] = None,
    year: Optional[int] = None,
    limit: int = Query(200, ge=1, le=2000),
):
    where_parts = []
    params: list[Any] = []
    if entity:
        where_parts.append("RBUKRS = ?"); params.append(entity)
    if period:
        where_parts.append("POPER = ?");  params.append(period)
    if year:
        where_parts.append("GJAHR = ?");  params.append(year)
    where = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    sql = f"""
      SELECT RBUKRS, GJAHR, POPER, BUDAT, BLART, BELNR, DOCLN,
             RACCT, RASSC, MATNR, WERKS,
             HSL, RHCUR,
             SGTXT
      FROM read_parquet('{JOURNAL}')
      {where}
      ORDER BY BUDAT DESC, BELNR DESC, DOCLN
      LIMIT {limit}
    """
    rows = q(sql, params)
    out = []
    for r in rows:
        r["BUDAT"] = r["BUDAT"].isoformat() if r["BUDAT"] else None
        if r["HSL"] is not None:
            r["HSL"] = float(r["HSL"])
        out.append(r)
    return out


# ------------------------------------------------------------------
# Entrypoint for `python main.py` convenience
# ------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=True,
    )
