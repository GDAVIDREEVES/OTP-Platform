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
