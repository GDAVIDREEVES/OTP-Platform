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
