# OTP Platform — Dashboard tab improvements (design spec)

- **Date:** 2026-06-02
- **Status:** Approved design (pre-implementation)
- **Branch context:** `demo-readiness` (Phases 0–5 + Master Data + Home/MD improvements)

## Context

The legacy Dashboard (`/dashboard`, `src/features/dashboard/`) has two widgets that
need work:

1. **Global Entity Map** (`WorldMap.tsx`) — shows the 8 entities as status-coloured
   dots on a geo map. The user wants a **toggle** to a second **transaction-flow**
   view: arcs of intercompany flow between entities, with **multi-entity selection**.
2. **Entity Operating Margin Trends** (`MarginTrendChart.tsx`) — **currently broken**:
   it hardcodes `<Line dataKey="IE-002">` / `"UK-001"` / `"MX-002"` / `"US-003"`
   (placeholder codes that don't exist in the data) and a literal "FY2025", so the
   lines plot nothing. The real endpoint `GET /api/margins/trend` returns wide rows
   keyed by **RBUKRS** (`1000`, `3000`, …). The user wants **all entities** shown,
   with **multi-select by entity and by TP function**.

## Decisions (settled in brainstorming)

- **Flow view = arcs on the same geo map** (toggle Status ↔ Flows), not a separate
  diagram.
- **Flow data = actual IC flows by entity-pair from the ACDOCA `journal`** (RASSC),
  the same scan the matrix uses.
- **Arcs are undirected** — one arc per entity pair, sized by magnitude.
- **Margin chart defaults to all entities visible**; the entity/function chips
  filter down.

## Goals / Non-goals

**Goals**
- Map toggles to a flow view; arcs reflect real intercompany value; filter by entity.
- Margin chart shows the real entities (fixing the empty-chart bug) and filters by
  entity + TP function.

**Non-goals (YAGNI)**
- Directed/animated arcs, arc routing around geography (simple great-circle/curve).
- Planned-vs-actual flow overlay (actual only this round).
- A new charting library (reuse recharts + react-simple-maps already in the app).

## A. Map — Status ↔ Flows toggle

### Backend
- New `backend/routers/flows.py`, `GET /api/flows/intercompany` (accepts the standard
  `PeriodFilter` params), mounted in `main.py`. Aggregates IC postings:
  ```sql
  SELECT RBUKRS, RASSC, SUM(HSL) AS amount FROM journal
  WHERE RASSC IS NOT NULL AND RASSC <> RBUKRS
    AND RASSC IN (<entities>) AND RBUKRS IN (<entities>)
  GROUP BY RBUKRS, RASSC
  ```
  Entity set = the 8 RBUKRS from `dim/entity_dim.json`. Collapse to **undirected**
  pairs (frozenset), summing both legs' magnitudes (`abs`), and return
  `[{ "from_rbukrs": str, "to_rbukrs": str, "amount": float }]` sorted by amount desc.
  (Read-only; returns `[]` if the journal has no IC postings.)

### Frontend (`WorldMap.tsx`)
- Add `mode: 'status' | 'flows'` state + a segmented toggle in the card header.
- **Status mode** = current behaviour, unchanged.
- **Flows mode:**
  - Fetch `api.flowsIntercompany()` once (on first switch); map each flow's
    `from_rbukrs`/`to_rbukrs` to entity coordinates via `useEntities()` (entities carry
    `id`=RBUKRS, `lat`, `lng`).
  - Render the entity dots **dimmed** (anchors) + a curved `<Line>` (react-simple-maps)
    per flow between the two coordinates; `strokeWidth` scaled to `amount` (min..max →
    1.5..6 px), semi-transparent; hover/title shows `FromName → ToName · $value`.
  - **Multi-entity selection:** a chip row (all 8 entities) above the map. Selected set
    empty → show all arcs; non-empty → show only arcs where `from`∈sel or `to`∈sel.
- Factor the arc rendering into a small `FlowArcs` sub-component (props: `flows`,
  `entities`, `selected`) so `WorldMap` stays readable.

## B. Margin trends — real, all-entity, multi-select

### Frontend (`MarginTrendChart.tsx`) — rewrite the static lines
- Derive the series keys from the data: `keys = Object.keys(rows[0]).filter(k => k !== 'month')`
  (these are RBUKRS). Render one `<Line dataKey={key}>` per key, colour from an 8-colour
  palette, `name` = entity display name (via `useEntities()` id→name; fall back to the key).
- Replace the hardcoded "FY2025" caption with the active year (from `usePeriod()` /
  the data context); keep the 4% / 7% reference lines.
- Default: all entity lines visible.

### Multi-select control (entity + function)
- Above the chart, two chip groups:
  - **Entity** chips — every entity (id + name).
  - **Function** chips — the distinct TP functions, from `api.mdEntities()`
    (`tp_function_code`/`tp_function_label`); build a `rbukrs → Set<functionLabel>` map.
- Visible entities = (selected entity ids) ∪ (entities whose function set intersects the
  selected functions). If nothing selected → **all** entities. Only visible entities get
  a `<Line>`; the legend reflects the visible set.
- State lives in `MarginTrendChart` (or a tiny `useMarginFilter` hook).

### Data flow
- `MarginTrendChart` receives `data` (as today, from `/api/margins/trend`) and
  additionally reads `useEntities()` (names) + `api.mdEntities()` (functions). No backend
  change for the margin chart — it was purely a frontend rendering bug + a new filter.

## Components & boundaries
- `routers/flows.py` (new, ~25 lines) — one read-only endpoint.
- `src/shared/api/{client,types}.ts` — `flowsIntercompany()` + `IntercompanyFlow` type.
- `WorldMap.tsx` — mode toggle + entity multi-select; new `FlowArcs` sub-component (same file or a sibling).
- `MarginTrendChart.tsx` — dynamic lines + the entity/function multi-select.

## Testing
- Backend: `test_flows.py` — `/api/flows/intercompany` returns undirected entity-pair
  aggregates from the journal (count ≥ 0; amounts ≥ 0; `from`/`to` are valid RBUKRS;
  no self-pairs). Deterministic shape assertions (tolerant of empty journal).
- Frontend: `npm run typecheck` + `npm run build`. In-browser: margin chart renders one
  line per real entity (no longer empty); the entity + function chips filter the lines;
  the map toggles Status↔Flows and arcs render; entity chips filter arcs.

## Phasing (each independently demoable & committed)
- **D-1** Backend `/api/flows/intercompany` + client method/type. *Verify:* test + curl.
- **D-2** Margin chart fix (dynamic lines, real year) + entity/function multi-select.
  *Verify:* build; chart shows real entity lines; chips filter.
- **D-3** Map Status/Flows toggle + `FlowArcs` + entity multi-select. *Verify:* build;
  in-browser toggle + arcs + filter.

## Critical files
- **Create:** `backend/routers/flows.py`; `backend/tests/test_flows.py`.
- **Modify:** `backend/main.py` (mount router); `src/shared/api/client.ts` + `types.ts`;
  `src/features/dashboard/WorldMap.tsx`; `src/features/dashboard/components/MarginTrendChart.tsx`.
- **Reuse:** `db.q` over the `journal` view, `dim/entity_dim.json`, `useEntities`,
  `usePeriod`, `api.mdEntities` (entity→function), recharts, react-simple-maps.

## Risks & mitigations
- **Arc density** (~20 pairs) → undirected halves it; multi-entity select focuses it;
  width-by-value makes the material flows dominant.
- **Entity coords** for arcs come from `entity_dim` lat/lng (already used by the dots).
- **Margin year mismatch** → drive the label + query from the active period rather than a
  literal, so the chart and data agree.
