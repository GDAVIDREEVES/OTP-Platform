# Dashboard Tab Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Status↔Flows toggle to the dashboard map (undirected intercompany-flow arcs from the actuals, with entity filtering), and fix + extend the Entity Operating Margin Trends chart (render the real entities, real year, multi-select by entity and TP function).

**Architecture:** One new read-only backend endpoint aggregates intercompany value by entity-pair from the `journal`. The margin chart is a frontend-only fix (it was plotting hardcoded placeholder series keys). The map gains a mode toggle + arc layer. Reuses recharts + react-simple-maps already in the app.

**Tech Stack:** FastAPI + DuckDB (`journal` view) + pytest (backend); React 18 + MUI 5 + recharts + react-simple-maps + Vite (frontend); `npm run typecheck && npm run build` is the frontend gate.

**Spec:** `docs/superpowers/specs/2026-06-02-dashboard-improvements-design.md`

**Branch:** `demo-readiness`. Backend commands from `backend/` via `../.venv/bin/python -m pytest`; frontend from repo root.

---

## File structure
- **Create:** `backend/routers/flows.py` (one endpoint), `backend/tests/test_flows.py`.
- **Modify:** `backend/main.py` (mount router); `src/shared/api/types.ts` + `src/shared/api/client.ts` (flow type + method); `src/features/dashboard/components/MarginTrendChart.tsx` (rewrite); `src/features/dashboard/WorldMap.tsx` (toggle + arcs + filter).

---

## Task 1: Backend `/api/flows/intercompany`

**Files:** Create `backend/routers/flows.py`, `backend/tests/test_flows.py`; Modify `backend/main.py`

- [ ] **Step 1: Write the failing test** — `backend/tests/test_flows.py`:
```python
"""Intercompany flow aggregation for the dashboard map."""
from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)
ENTITIES = {"1000", "3000", "3100", "3200", "3300", "3400", "3800", "4100"}


def test_intercompany_flows_shape():
    r = client.get("/api/flows/intercompany")
    assert r.status_code == 200
    flows = r.json()
    assert isinstance(flows, list)
    for f in flows:
        assert f["from_rbukrs"] in ENTITIES and f["to_rbukrs"] in ENTITIES
        assert f["from_rbukrs"] != f["to_rbukrs"]
        assert f["amount"] >= 0
    # undirected: each entity pair appears at most once
    pairs = {frozenset((f["from_rbukrs"], f["to_rbukrs"])) for f in flows}
    assert len(pairs) == len(flows)
```

- [ ] **Step 2: Run, expect FAILURE**

Run: `cd backend && ../.venv/bin/python -m pytest tests/test_flows.py -q`
Expected: FAIL — 404 (router not mounted).

- [ ] **Step 3: Create `backend/routers/flows.py`**
```python
"""Intercompany transaction flows for the dashboard map — actual IC value by
entity pair, aggregated from the ACDOCA journal (RASSC = affiliated counterparty)."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from db import q
from period_filter import PeriodFilter

router = APIRouter()
_DIM = Path(__file__).parent.parent / "dim" / "entity_dim.json"


@lru_cache(maxsize=1)
def _entity_ids() -> list[str]:
    return [e["rbukrs"] for e in json.loads(_DIM.read_text(encoding="utf-8"))["entities"]]


@router.get("/api/flows/intercompany")
def intercompany_flows(year: int | None = None, periodFrom: str | None = None, periodTo: str | None = None):
    """Undirected entity-pair IC value: [{from_rbukrs, to_rbukrs, amount}], desc by amount."""
    ids = _entity_ids()
    if not ids:
        return []
    pf = PeriodFilter(year=year, period_from=periodFrom, period_to=periodTo)
    pf_clause, pf_params = pf.where()
    ph = ",".join("?" for _ in ids)
    try:
        rows = q(
            f"SELECT RBUKRS, RASSC, SUM(HSL) AS amount FROM journal "
            f"WHERE RASSC IS NOT NULL AND RASSC <> RBUKRS "
            f"AND RASSC IN ({ph}) AND RBUKRS IN ({ph}) {pf_clause} "
            f"GROUP BY RBUKRS, RASSC",
            list(ids) + list(ids) + pf_params,
        )
    except Exception:
        return []
    agg: dict[frozenset, float] = {}
    for r in rows:
        pair = frozenset((str(r["RBUKRS"]), str(r["RASSC"])))
        agg[pair] = agg.get(pair, 0.0) + abs(float(r["amount"] or 0))
    out: list[dict[str, Any]] = []
    for pair, amount in agg.items():
        a, b = sorted(list(pair))
        out.append({"from_rbukrs": a, "to_rbukrs": b, "amount": round(amount, 2)})
    out.sort(key=lambda f: f["amount"], reverse=True)
    return out
```
NOTE: `PeriodFilter.where()` returns a fragment that begins with `AND …` (or `''`), matching how `routers/margins.py` appends it after a `WHERE`. The query above already has a `WHERE`, so appending `{pf_clause}` is correct.

- [ ] **Step 4: Mount it in `backend/main.py`** — add `flows` to the `from routers import (...)` line and add `flows.router,` to the `include_router` loop (next to `margins.router`).

- [ ] **Step 5: Run the test, expect PASS** + full suite
Run: `cd backend && ../.venv/bin/python -m pytest tests/test_flows.py -q && ../.venv/bin/python -m pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add backend/routers/flows.py backend/main.py backend/tests/test_flows.py
git commit -m "feat(dash): /api/flows/intercompany — IC value by entity pair"
```

---

## Task 2: Margin chart — real entities, real year, multi-select

**Files:** Modify `src/features/dashboard/components/MarginTrendChart.tsx`

- [ ] **Step 1: Replace `MarginTrendChart.tsx` ENTIRELY** with the dynamic version (it currently hardcodes `dataKey="IE-002"` etc. + "FY2025" + `domain={[0,35]}` which also clips negative margins):
```tsx
import { useEffect, useMemo, useState } from 'react';
import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip as ReTooltip, XAxis, YAxis,
} from 'recharts';
import type { MonthlyMarginRow } from '@/shared/types/transaction';
import type { MdEntityRow } from '@/shared/api/types';
import { useEntities, usePeriod } from '@/shared/providers/DataProvider';
import { api } from '@/shared/api/client';

interface MarginTrendChartProps {
  data: MonthlyMarginRow[];
}

const PALETTE = ['#DC2626', '#F97316', '#D97706', '#16A34A', '#2563EB', '#7C3AED', '#0891B2', '#DB2777'];

export default function MarginTrendChart({ data }: MarginTrendChartProps) {
  const entities = useEntities();
  const period = usePeriod();
  const [fnRows, setFnRows] = useState<MdEntityRow[]>([]);
  const [selEntities, setSelEntities] = useState<Set<string>>(new Set());
  const [selFns, setSelFns] = useState<Set<string>>(new Set());

  useEffect(() => { api.mdEntities().then(setFnRows).catch(() => setFnRows([])); }, []);

  const nameOf = useMemo(() => {
    const m = new Map(entities.map((e) => [e.id, e.name] as const));
    return (id: string) => m.get(id) ?? id;
  }, [entities]);

  const fnOf = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of fnRows) {
      if (!m.has(r.rbukrs)) m.set(r.rbukrs, new Set());
      m.get(r.rbukrs)!.add(r.tp_function_label);
    }
    return m;
  }, [fnRows]);

  const allKeys = useMemo(() => {
    const s = new Set<string>();
    for (const row of data) for (const k of Object.keys(row)) if (k !== 'month') s.add(k);
    return Array.from(s);
  }, [data]);

  const allFunctions = useMemo(() => {
    const s = new Set<string>();
    for (const set of fnOf.values()) for (const f of set) s.add(f);
    return Array.from(s).sort();
  }, [fnOf]);

  const visibleKeys = useMemo(() => {
    if (selEntities.size === 0 && selFns.size === 0) return allKeys;
    return allKeys.filter(
      (k) => selEntities.has(k) || Array.from(fnOf.get(k) ?? []).some((f) => selFns.has(f)),
    );
  }, [allKeys, selEntities, selFns, fnOf]);

  const toggle = (set: Set<string>, v: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v); else n.add(v);
    setter(n);
  };

  return (
    <Paper sx={{ p: 2.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Entity Operating Margin Trends</Typography>
          <Typography variant="caption" sx={{ color: '#64748B' }}>FY{period.year} — by month</Typography>
        </Box>
      </Stack>

      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
        {allKeys.map((k) => (
          <Chip key={k} size="small" label={nameOf(k)}
            variant={selEntities.has(k) ? 'filled' : 'outlined'}
            color={selEntities.has(k) ? 'primary' : 'default'}
            onClick={() => toggle(selEntities, k, setSelEntities)} />
        ))}
        {allFunctions.map((f) => (
          <Chip key={f} size="small" label={f} sx={{ fontStyle: 'italic' }}
            variant={selFns.has(f) ? 'filled' : 'outlined'}
            color={selFns.has(f) ? 'secondary' : 'default'}
            onClick={() => toggle(selFns, f, setSelFns)} />
        ))}
      </Stack>

      <Box sx={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 10, right: 24, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="month" stroke="#64748B" fontSize={12} />
            <YAxis stroke="#64748B" fontSize={12} domain={['auto', 'auto']} tickFormatter={(v) => `${v}%`} />
            <ReTooltip formatter={(v: number | string) => `${v}%`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={4} stroke="#16A34A" strokeDasharray="4 4" label={{ value: 'Target Floor (4%)', position: 'insideLeft', fontSize: 11, fill: '#16A34A' }} />
            <ReferenceLine y={7} stroke="#2563EB" strokeDasharray="4 4" label={{ value: 'Target Ceiling (7%)', position: 'insideLeft', fontSize: 11, fill: '#2563EB' }} />
            {visibleKeys.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} name={nameOf(k)}
                stroke={PALETTE[i % PALETTE.length]} strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
}
```
Key fixes: dynamic `<Line>` per real RBUKRS key from the data; legend by entity name; `FY{period.year}` instead of "FY2025"; `domain={['auto','auto']}` so negative margins aren't clipped; entity + function chips (functions from `api.mdEntities()`), union filter, default all.

- [ ] **Step 2: Verify** — `npm run typecheck && npm run build` → both PASS.

- [ ] **Step 3: Commit**
```bash
git add src/features/dashboard/components/MarginTrendChart.tsx
git commit -m "fix(dash): margin chart renders real entities + entity/function multi-select"
```

---

## Task 3: Flow type + client method

**Files:** Modify `src/shared/api/types.ts`, `src/shared/api/client.ts`

- [ ] **Step 1: Add the type to `src/shared/api/types.ts`** (append):
```ts
export interface IntercompanyFlow {
  from_rbukrs: string;
  to_rbukrs: string;
  amount: number;
}
```

- [ ] **Step 2: Add the client method** in `src/shared/api/client.ts` — add `IntercompanyFlow` to the type import from `./types`, then add to the `api` object (next to `flows`):
```ts
  flowsIntercompany: () => getJSON<IntercompanyFlow[]>('/api/flows/intercompany'),
```

- [ ] **Step 3: Verify** — `npm run typecheck` → PASS. (No commit yet; committed with Task 4 so the tree stays green — `WorldMap` will consume this.)

---

## Task 4: Map Status↔Flows toggle + arcs + entity filter

**Files:** Modify `src/features/dashboard/WorldMap.tsx`

- [ ] **Step 1: Replace `WorldMap.tsx` ENTIRELY** with the version below (adds the `Line` import, a `FlowArcs` sub-component, a Status/Flows toggle, an entity chip filter, and an arc hover tooltip; Status mode is unchanged behaviour):
```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Chip, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { ComposableMap, Geographies, Geography, Line, Marker, ZoomableGroup } from 'react-simple-maps';
import type { Entity } from '@/shared/types/entity';
import type { IntercompanyFlow } from '@/shared/api/types';
import { statusColor, statusLabel } from '@/shared/utils/status';
import { useEntities } from '@/shared/providers/DataProvider';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

interface HoverState { e: Entity; x: number; y: number; }
interface FlowHover { label: string; x: number; y: number; }

function FlowArcs({
  flows, byId, selected, onHover, onLeave,
}: {
  flows: IntercompanyFlow[];
  byId: Map<string, Entity>;
  selected: Set<string>;
  onHover: (label: string, ev: React.MouseEvent) => void;
  onLeave: () => void;
}) {
  const max = Math.max(1, ...flows.map((f) => f.amount));
  return (
    <>
      {flows.map((f) => {
        const a = byId.get(f.from_rbukrs);
        const b = byId.get(f.to_rbukrs);
        if (!a || !b) return null;
        if (selected.size > 0 && !selected.has(f.from_rbukrs) && !selected.has(f.to_rbukrs)) return null;
        const w = 1.5 + (f.amount / max) * 4.5;
        const label = `${a.name} → ${b.name} · ${formatCurrency(f.amount, 'USD', true)}`;
        return (
          <Line
            key={`${f.from_rbukrs}-${f.to_rbukrs}`}
            from={[a.lng, a.lat]}
            to={[b.lng, b.lat]}
            stroke="#2563EB"
            strokeWidth={w}
            strokeOpacity={0.45}
            strokeLinecap="round"
            onMouseEnter={(ev: React.MouseEvent) => onHover(label, ev)}
            onMouseLeave={onLeave}
            style={{ cursor: 'pointer' }}
          />
        );
      })}
    </>
  );
}

export default function WorldMap({ onEntityClick }: { onEntityClick?: (e: Entity) => void }) {
  const entities = useEntities();
  const [hover, setHover] = useState<HoverState | null>(null);
  const [flowHover, setFlowHover] = useState<FlowHover | null>(null);
  const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<'status' | 'flows'>('status');
  const [flows, setFlows] = useState<IntercompanyFlow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (mode === 'flows' && flows.length === 0) {
      api.flowsIntercompany().then(setFlows).catch(() => setFlows([]));
    }
  }, [mode, flows.length]);

  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e] as const)), [entities]);

  const relPos = (event: React.MouseEvent) => {
    const rect = containerRef?.getBoundingClientRect();
    return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: 0, y: 0 };
  };
  const handleMouseMove = (e: Entity) => (event: React.MouseEvent) => {
    if (!containerRef) return;
    setHover({ e, ...relPos(event) });
  };
  const toggleEntity = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Paper sx={{ p: 2.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Global Entity Map</Typography>
          <Typography variant="caption" sx={{ color: '#64748B' }}>
            {mode === 'status'
              ? `${entities.length} entities across ${new Set(entities.map((e) => e.countryCode)).size} countries • Hover a dot for details`
              : `Intercompany flows • ${flows.length} pairs • select entities to focus`}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
            <ToggleButton value="status">Status</ToggleButton>
            <ToggleButton value="flows">Flows</ToggleButton>
          </ToggleButtonGroup>
          {mode === 'status' && (['in-range', 'watch', 'out-of-range', 'no-data'] as const).map((s) => (
            <Stack key={s} direction="row" alignItems="center" spacing={0.5}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: statusColor[s] }} />
              <Typography variant="caption" sx={{ color: '#475569', fontWeight: 500 }}>{statusLabel[s]}</Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>

      {mode === 'flows' && (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
          {entities.map((e) => (
            <Chip key={e.id} size="small" label={e.name}
              variant={selected.has(e.id) ? 'filled' : 'outlined'}
              color={selected.has(e.id) ? 'primary' : 'default'}
              onClick={() => toggleEntity(e.id)} />
          ))}
        </Stack>
      )}

      <Box ref={setContainerRef} sx={{ position: 'relative', width: '100%', bgcolor: '#F8FAFC', borderRadius: 1.5, overflow: 'hidden', border: '1px solid #EEF2F7' }}>
        <ComposableMap projection="geoEqualEarth" projectionConfig={{ scale: 165, center: [10, 20] }} width={980} height={460} style={{ width: '100%', height: 'auto', display: 'block' }}>
          <ZoomableGroup zoom={1} minZoom={1} maxZoom={4} center={[10, 20]}>
            <Geographies geography={GEO_URL}>
              {({ geographies }) => geographies.map((geo) => (
                <Geography key={geo.rsmKey} geography={geo} style={{
                  default: { fill: '#E2E8F0', stroke: '#CBD5E1', strokeWidth: 0.5, outline: 'none' },
                  hover: { fill: '#CBD5E1', stroke: '#94A3B8', strokeWidth: 0.5, outline: 'none' },
                  pressed: { fill: '#CBD5E1', outline: 'none' },
                }} />
              ))}
            </Geographies>

            {mode === 'flows' && (
              <FlowArcs flows={flows} byId={byId} selected={selected}
                onHover={(label, ev) => setFlowHover({ label, ...relPos(ev) })}
                onLeave={() => setFlowHover(null)} />
            )}

            {entities.map((e) => {
              const color = statusColor[e.status];
              const dim = mode === 'flows';
              return (
                <Marker key={e.id} coordinates={[e.lng, e.lat]}
                  onMouseEnter={mode === 'status' ? handleMouseMove(e) : undefined}
                  onMouseMove={mode === 'status' ? handleMouseMove(e) : undefined}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onEntityClick?.(e)}
                  style={{ default: { cursor: onEntityClick ? 'pointer' : 'default', outline: 'none' }, hover: { outline: 'none' }, pressed: { outline: 'none' } }}>
                  <circle r={10} fill={color} fillOpacity={dim ? 0.08 : 0.18} />
                  <circle r={5.5} fill={color} stroke="#ffffff" strokeWidth={1.5} fillOpacity={dim ? 0.55 : 1}>
                    <title>{e.id} — {e.name}</title>
                  </circle>
                </Marker>
              );
            })}
          </ZoomableGroup>
        </ComposableMap>

        {hover && containerRef && mode === 'status' && (
          <Box sx={{ position: 'absolute', left: Math.min(Math.max(hover.x, 130), containerRef.clientWidth - 130), top: Math.max(hover.y - 14, 10), transform: 'translate(-50%, -100%)', bgcolor: 'white', border: '1px solid #E2E8F0', borderRadius: 1.5, boxShadow: '0 10px 25px rgba(15,23,42,0.14)', p: 1.25, minWidth: 230, pointerEvents: 'none', zIndex: 2 }}>
            <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>{hover.e.id} • {hover.e.country}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>{hover.e.name}</Typography>
            <Typography variant="caption" sx={{ display: 'block', color: '#475569' }}>Function: {hover.e.function}</Typography>
            {hover.e.actualMargin !== null && (
              <Typography variant="caption" sx={{ display: 'block', color: '#475569' }}>Margin: <b>{hover.e.actualMargin}%</b> vs. target {hover.e.targetMarginLabel}</Typography>
            )}
            <Box sx={{ mt: 0.75, display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.25, borderRadius: 0.75, bgcolor: `${statusColor[hover.e.status]}15` }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: statusColor[hover.e.status] }} />
              <Typography variant="caption" sx={{ color: statusColor[hover.e.status], fontWeight: 700 }}>{statusLabel[hover.e.status]}</Typography>
            </Box>
          </Box>
        )}

        {flowHover && containerRef && mode === 'flows' && (
          <Box sx={{ position: 'absolute', left: Math.min(Math.max(flowHover.x, 120), containerRef.clientWidth - 120), top: Math.max(flowHover.y - 14, 10), transform: 'translate(-50%, -100%)', bgcolor: 'white', border: '1px solid #E2E8F0', borderRadius: 1.5, boxShadow: '0 10px 25px rgba(15,23,42,0.14)', px: 1.25, py: 0.75, pointerEvents: 'none', zIndex: 2 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: '#334155' }}>{flowHover.label}</Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
}
```
Notes: `react-simple-maps` exports `Line` (great-circle connector between two `[lng,lat]` points) and forwards DOM mouse handlers, so the arc hover uses a `flowHover` state (robust, typesafe) rather than an SVG `<title>` child. `formatCurrency(amount, 'USD', true)` is the existing compact formatter (`@/shared/utils/format`). Status mode is byte-for-byte the prior behaviour.

- [ ] **Step 2: Verify** — `npm run typecheck && npm run build` → both PASS (Task 3's type/method are now consumed).

- [ ] **Step 3: Commit** (type + client + map together)
```bash
git add src/shared/api/types.ts src/shared/api/client.ts src/features/dashboard/WorldMap.tsx
git commit -m "feat(dash): map Status/Flows toggle with IC arcs + entity filter"
```

- [ ] **Step 4: Manual end-to-end check.** Restart the backend on the new code (`lsof -ti tcp:8000 | xargs kill -9; cd backend && ../.venv/bin/python -m state.migrate --reset && nohup ../.venv/bin/uvicorn --app-dir "$PWD" main:app --port 8000 >/tmp/otp_api.log 2>&1 & disown`), open `http://localhost:5173/dashboard`:
  - **Margin chart** shows one line per real entity (e.g. "Germany Manufacturing Co."), header reads FY2026; clicking entity chips and function chips filters the lines.
  - **Map** has a Status/Flows toggle; Flows mode dims the dots and draws weighted arcs; entity chips filter the arcs; hovering an arc shows `From → To · value`.

---

## Self-review (completed by the plan author)

**Spec coverage:** map Status↔Flows toggle (Task 4) ✓; undirected arcs from journal RASSC actuals (Tasks 1, 4) ✓; arc width ∝ value + hover From→To·value (Task 4) ✓; entity multi-select on arcs (Task 4) ✓; margin chart fix — dynamic real-entity lines, real year, no clipping (Task 2) ✓; all entities default (Task 2) ✓; multi-select by entity + TP function from master data (Task 2) ✓; new `/api/flows/intercompany` (Task 1) ✓; client type/method (Task 3) ✓; tests (Task 1 backend; frontend build + manual) ✓.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** backend returns `{from_rbukrs,to_rbukrs,amount}` ↔ `IntercompanyFlow` (Task 3) ↔ consumed by `FlowArcs`/`WorldMap` (Task 4). `MonthlyMarginRow` keys (RBUKRS) drive the margin `<Line dataKey>`; `MdEntityRow.rbukrs`/`tp_function_label` drive the function chips; `Entity.id`=RBUKRS/`lat`/`lng`/`name` drive arcs + legend; `usePeriod().year` is a `number`. `Line` import added to the react-simple-maps import.

**Note:** `intercompany_flows` is read-only and returns `[]` if the journal lacks IC postings; the shape test is tolerant of an empty list. The arc count mirrors the matrix's detection (~20 pairs) — undirected halves the visual density and the entity filter focuses it.
