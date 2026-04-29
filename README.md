# OTP Platform

> Operational Transfer Pricing — a financial-compliance and monitoring tool that
> reads SAP S/4HANA universal-journal exports, computes intercompany margins
> against arm's-length policy bands, and lets a tax team propose, approve, and
> book year-end adjustments with a full audit trail.

The platform shows a multinational's intercompany position at a glance:
which legal entities are inside their target operating-margin band, which are
on watch, which are out of range, and what year-end adjustment would bring an
out-of-range entity back inside its band.

---

## What it does

| Page | Purpose |
| --- | --- |
| **Dashboard** | KPI strip (total IC volume, entities by status, pending actions, APA/challenged chains), interactive world map of legal entities, sortable summary table, trend chart, and a live alerts rail driven by the worst-variance entities. |
| **Entity Detail** | Per-entity drill-down: target band, YTD margin, monthly trend, supply-chain flow breakdown, and recent journal entries. |
| **Adjustment** | Three-step wizard (Select method → Review & confirm → Submitted) for proposing a year-end IC adjustment. Supports adjust-to-median, adjust-to-upper-quartile, or custom target. Posts to the write store with a full audit trail. |
| **Segmented P&L / Detailed P&L** | A live, editable P&L matrix that re-computes subtotals, gross profit, operating profit, and operating margin as you type. Three hierarchy modes — Country / Entity / Function — with per-scope edit history. |
| **Price Setting** | Berry-ratio analysis, country/product variance charts, and a current-vs-proposed markup comparison table. |
| **Policy** | Per-flow policy overrides (TP method, reviewer, notes) with country/method filters. |
| **Royalties** | Royalty register with benchmark range, jurisdiction notes, and APA / challenged flags. |
| **Invoicing** | Invoice list with status workflow (Pending → Approved → Exported / Rejected / Reversed) and bulk actions. |
| **Research Brain** | An in-app side-panel AI assistant scoped to the current entity / flow / method, accessible from a FAB on every page. |
| **Reports / Settings / Onboarding / Login** | Standard support pages. |

Every read screen respects a global **period filter** (Q1–Q4 or full year, plus a
year selector populated from the data). A single refresh button re-fetches all
bootstrap data from the backend.

---

## Architecture

```
┌──────────────────┐                ┌────────────────────┐                ┌────────────────┐
│  React frontend  │  HTTP /api/*   │  FastAPI backend   │  DuckDB        │  Parquet files │
│  (Vite, MUI)     │ ──────────────▶│  (uvicorn, port    │  read_parquet  │  on local FS   │
│  port 5173       │                │  8000, layered)    │ ──────────────▶│  (DATA_DIR)    │
└──────────────────┘                └────────────────────┘                └────────────────┘
        │                                     │
        │                                     │  reads/writes
        │                                     ▼
        │                           ┌─────────────────────┐
        └──────────────────────────▶│  overrides.json     │
              same HTTP endpoints   │  (adjustments,      │
                                    │   policy overrides, │
                                    │   app settings)     │
                                    └─────────────────────┘
```

- **Frontend** is a single-page React 18 app served by Vite. State lives in a
  React Context (`DataProvider`) that bootstraps eight datasets in parallel and
  re-fetches whenever the period filter changes. Every page is code-split into
  its own lazy chunk.
- **Backend** is a FastAPI service that queries four parquet datasets through
  in-memory DuckDB (`read_parquet` — no copy, no staging) and persists editable
  state (submitted adjustments, policy overrides, app settings) in a JSON file
  that's written atomically.
- **Data** comes from a directory of SAP S/4HANA universal-journal exports
  (`entity_roles/`, `segment_pl/`, `supply_chain_flows/`, `journal_entries/`).
  The path is configured via `DATA_DIR`.

---

## Tech stack

**Frontend** — React 18, TypeScript 5.5 (strict), Vite 5, MUI 5, Tailwind 3,
Recharts, react-simple-maps, React Router 6, React Context for state. No
external state library, no fetch library — a thin `getJSON` / `sendJSON`
wrapper over `fetch`.

**Backend** — Python 3.13, FastAPI 0.115, uvicorn 0.30, DuckDB 1.1, Pydantic v2
(via FastAPI), python-dotenv. No ORM — DuckDB executes parameterised SQL
directly against parquet.

**Tooling** — npm, ESLint 8, TypeScript compiler, Vite build with manual vendor
chunking (React / MUI / charts in their own bundles). A single `scripts/dev.sh`
boots both services with prefixed logs.

---

## Project layout

```
OTP-Platform/
├── scripts/
│   └── dev.sh                  # one-command local dev (uvicorn + Vite)
│
├── src/                        # frontend, feature-based
│   ├── App.tsx                 # providers + Router
│   ├── main.tsx                # React entry
│   ├── shared/                 # cross-feature infrastructure
│   │   ├── api/                # client.ts (fetch wrapper) + types.ts
│   │   ├── providers/          # DataProvider (global state + period + toast)
│   │   ├── hooks/              # on-demand + mutation hooks
│   │   ├── types/              # entity, transaction, period, toast types
│   │   ├── utils/              # format, status, period helpers
│   │   ├── theme/              # MUI theme
│   │   └── components/layout/  # AppShell (sidebar, header, period filter)
│   └── features/               # one folder per page
│       ├── dashboard/          # DashboardPage + KpiCard / EntityTable / MarginTrendChart / AlertsRail
│       ├── adjustment/         # AdjustmentPage + MethodSelectionStep / ReviewStep / SubmittedStep
│       ├── pnl/                # SegmentedPnL + DetailedPnL (HierarchyControls / PnLGrid / PnLGridCells)
│       ├── pricing/            # PriceSetting + ProductPricing (KpiCard / MonthlyBerryChart / VarianceRow / MarkupComparisonTable)
│       ├── entities/           # EntityDetailPage
│       ├── invoicing/          # InvoicingPage
│       ├── royalties/          # RoyaltiesPage
│       ├── policy/             # PolicyPage
│       ├── reports/            # ReportsPage
│       ├── settings/           # SettingsPage
│       ├── research-brain/     # AI side-panel: Page + Panel + Conversation + Fab + Context
│       ├── auth/               # LoginPage
│       └── onboarding/         # OnboardingPage
│
├── backend/                    # FastAPI, layered
│   ├── main.py                 # app bootstrap + lifespan + router includes (~70 lines)
│   ├── config.py               # env vars, DATA_DIR, parquet glob patterns
│   ├── constants.py            # ENTITY_DIM, currency, role/material labels
│   ├── db.py                   # DuckDB connection + q() helper
│   ├── period_filter.py        # period-clause builder for SQL
│   ├── routers/                # one file per resource (health, entities, kpis,
│   │                           #   margins, transactions, invoices, pnl,
│   │                           #   adjustments, overrides, settings, berry,
│   │                           #   journal_entries, years)
│   ├── services/               # status.py (compute_status, fmt_pct_band),
│   │                           #   labels.py (pretty_method, etc.),
│   │                           #   entities.py (list_entities core SQL)
│   ├── schemas/                # Pydantic input models for write endpoints
│   ├── persistence/            # overrides.py + overrides.json (atomic writes,
│   │                           #   thread-safe; was store.py)
│   ├── dim/entity_dim.json     # SAP company-code → display lookup
│   ├── tests/test_health.py    # smoke
│   └── requirements.txt
│
├── package.json                # npm scripts (dev, build, lint, typecheck, preview)
├── vite.config.ts              # vendor chunking + @/* path alias
├── tsconfig.json               # @/* → src/* alias, strict mode
└── .gitignore
```

A `@/*` path alias resolves to `src/*` so imports look like
`@/shared/providers/DataProvider` instead of `../../../shared/providers/DataProvider`.

---

## Run locally

```bash
./scripts/dev.sh
```

Output:

```
[api] INFO:     Uvicorn running on http://127.0.0.1:8000
[web]   ➜  Local:   http://localhost:5173/

  API: http://127.0.0.1:8000
  Web: http://127.0.0.1:5173
  Ctrl-C to stop both.
```

Both services run as children of the script with `[api]` / `[web]` log
prefixes. A single Ctrl-C tears them both down cleanly.

### First-time setup

The Python venv lives at the **repo root** (`.venv/`), not inside `backend/`,
so future cross-stack tooling (e.g., generating TypeScript types from Pydantic
schemas) can share one environment.

```bash
# from the repo root
/opt/homebrew/bin/python3.13 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
npm install
```

`scripts/dev.sh` will check for both `.venv/` and `node_modules/` and bail with
a helpful error if either is missing.

### Configuration

The backend reads its settings from environment variables (or `backend/.env`):

| Var | Default | Purpose |
| --- | --- | --- |
| `DATA_DIR` | hard-coded local path | Folder containing the four parquet sub-dirs |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Allowed frontend origins |
| `HOST` | `127.0.0.1` | uvicorn bind address |
| `PORT` | `8000` | uvicorn bind port |

The frontend can override its API target with `VITE_API_BASE_URL` (defaults to
`http://127.0.0.1:8000`).

---

## Common commands

| Command | What it does |
| --- | --- |
| `./scripts/dev.sh` | Boot uvicorn + Vite together |
| `npm run dev` | Vite dev server only |
| `npm run build` | Production build → `dist/` (13 lazy route chunks + vendor chunks) |
| `npm run typecheck` | `tsc --noEmit` strict-mode check |
| `npm run lint` | ESLint over `.ts` / `.tsx` |
| `npm run preview` | Serve the production build for smoke-testing |
| `.venv/bin/pytest backend/tests` | Backend smoke tests |

---

## API surface

22 endpoints under `/api/*`. Full details in
[backend/README.md](backend/README.md). Highlights:

| Category | Endpoints |
| --- | --- |
| Health / metadata | `GET /api/health`, `GET /api/years` |
| Entities | `GET /api/entities`, `GET /api/entities/{id}`, `GET /api/entities/{id}/flows` |
| Aggregates | `GET /api/kpis`, `GET /api/margins/trend`, `GET /api/segments/pl`, `GET /api/berry` |
| Transactions | `GET /api/transactions/flows`, `GET /api/transactions/royalties`, `GET /api/invoices`, `GET /api/journal-entries` |
| Write-side | `POST/PATCH/DELETE /api/adjustments[/{id}][/reverse]`, `PUT /api/overrides/policy/{id}`, `PUT /api/settings` |

All read endpoints accept the period filter (`year`, `periodFrom`, `periodTo`).
Write endpoints use Pydantic models (see `backend/schemas/`) so payloads are
validated at the edge.

Interactive docs live at `http://127.0.0.1:8000/docs` (Swagger) and `/redoc`
when the backend is running.

---

## How status is computed

Implemented in [backend/services/status.py](backend/services/status.py):

- **in-range** — `OM_LOW_PCT ≤ ytd_margin ≤ OM_HIGH_PCT`
- **watch** — outside the band but within ±1.5 × band-width
- **out-of-range** — otherwise
- **financing entity** (`OM_LOW = OM_HIGH = 0`) — 1pt tolerance for in-range,
  3pt tolerance for watch

YTD margin is **revenue-weighted**: `SUM(operating_profit) / SUM(revenue)`.
This matches how operating margin is reported in financials and avoids the
late-period true-up entries from skewing the picture.

---

## Known limitations

- **No authentication** — the service is open. Wrap routes with an auth
  dependency before exposing beyond localhost.
- **Synthetic invoice workflow** — invoices are derived from
  `supply_chain_flows`; status is bucketed by period rather than driven by a
  real workflow store. Submitted adjustments live in `overrides.json` and *do*
  have real status transitions.
- **Royalty benchmark** — the current build derives a ±1.5pp band around the
  observed rate. Replace with a proper benchmark dim table when one is
  available.
- **Single-currency presentation** — amounts come back in the entity's local
  currency. Group-currency translation can be added from `KSL` / `OSL` later.
- **Limited test coverage** — only `tests/test_health.py` ships today.
- **DATA_DIR default is machine-specific** — hard-coded to a local path in
  `backend/config.py`. Set `DATA_DIR` (or copy `backend/.env.example`) before
  running on another machine.

---

## License & attribution

Internal project. Original UI generated from a [Magic Patterns design](https://www.magicpatterns.com/c/qfpp3mjtmbwkaixle5h9pk)
and substantially reorganised since.
