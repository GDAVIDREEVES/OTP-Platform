# OTP Platform — Backend

FastAPI service that serves the React frontend by querying the four parquet
datasets (`entity_roles`, `segment_pl`, `supply_chain_flows`, `journal_entries`)
through DuckDB. No data copy — DuckDB reads parquet in place via `read_parquet`.

## Quickstart

```bash
# from this folder (OTP-Platform/backend)
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# point at your parquet directory (or copy .env.example -> .env and edit)
export DATA_DIR="/Users/gregreeves/Documents/acdoca_exports/20260429-115302 NEW 29april26"

# run
python main.py
# or:  uvicorn main:app --reload --port 8000
```

The server boots on `http://127.0.0.1:8000` and exposes interactive docs at
`/docs` (Swagger UI) and `/redoc`.

## Configuration

All via environment variables (or a `.env` file in this folder).

| Var            | Default                         | Purpose                                  |
| -------------- | ------------------------------- | ---------------------------------------- |
| `DATA_DIR`     | `~/Documents/acdoca_exports/…`  | Folder containing the 4 parquet subdirs  |
| `CORS_ORIGINS` | `http://localhost:5173,...:3000`| Allowed frontend origins (comma-sep)     |
| `HOST`         | `127.0.0.1`                     | Bind address                             |
| `PORT`         | `8000`                          | Bind port                                |

## Endpoints

All endpoints are under `/api`. Shapes mirror the existing React mock-data
contracts so the frontend swap is a one-liner per file.

| Method | Path                                       | Drives                              |
| ------ | ------------------------------------------ | ----------------------------------- |
| GET    | `/api/health`                              | Liveness + data-dir sanity check    |
| GET    | `/api/kpis`                                | Dashboard top cards                 |
| GET    | `/api/entities`                            | Dashboard, Policy, SegmentedPnL, PriceSetting, WorldMap |
| GET    | `/api/entities/{id}`                       | EntityDetail, Adjustment            |
| GET    | `/api/margins/trend?entities=1000,3300`    | Dashboard chart, EntityDetail chart |
| GET    | `/api/transactions/flows`                  | Policy                              |
| GET    | `/api/transactions/royalties`              | Royalties                           |
| GET    | `/api/invoices`                            | Invoicing                           |
| GET    | `/api/segments/pl?entity=&period=&year=`   | SegmentedPnL, DetailedPnL           |
| GET    | `/api/journal-entries?entity=&period=&limit=` | EntityDetail / Adjustment drill-down |

## How the data maps to the API

| Parquet table         | Used by                                          |
| --------------------- | ------------------------------------------------ |
| `entity_roles`        | `/api/entities` (target band, role)              |
| `segment_pl`          | `/api/entities` YTD margin, `/api/margins/trend`, `/api/segments/pl` |
| `supply_chain_flows`  | `/api/transactions/flows`, `/api/transactions/royalties`, `/api/invoices` |
| `journal_entries`     | `/api/entities` last-posted date, `/api/journal-entries` |

## Status / variance rule

Implemented in `compute_status()`:

- **in-range**: `OM_LOW_PCT ≤ ytd_margin ≤ OM_HIGH_PCT`
- **watch**: outside the band but within ±1.5 × band-width
- **out-of-range**: otherwise
- **financing entity** (`OM_LOW = OM_HIGH = 0`): 1pt tolerance for in-range,
  3pt tolerance for watch

The YTD margin is **revenue-weighted**: `SUM(operating_profit) / SUM(revenue)` —
this matches how operating margin is reported in financials, and avoids the
late-period true-up entries from skewing the picture.

## Static dimension table

`dim/entity_dim.json` maps SAP company code (RBUKRS) to display name, country,
function, and lat/lng for the world map. Edit this file to rename entities or
add new ones — no code change needed.

## Notes / things this build doesn't do yet

- **Approval workflow for invoices** — synthesized from `supply_chain_flows`;
  status (Draft/Pending/Approved/Exported) is bucketed by period rather than
  driven by a real workflow store.
- **Royalty benchmark dim table** — current build derives a ±1.5pp band around
  the observed rate. Replace `_ip_category_for()` and the benchmark logic with
  a proper benchmark table when one is available.
- **Multi-currency conversion** — amounts come back in the entity's local
  currency (`HSL` column on the journal). The frontend already accepts a
  `currency` field per row; group-currency translation can be added later from
  the parallel-currency columns (`KSL`, `OSL`).
- **Authentication** — the service is open. Add an auth dependency before
  exposing beyond localhost.
