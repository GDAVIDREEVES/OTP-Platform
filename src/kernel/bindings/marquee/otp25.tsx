import type { FC } from 'react';
import { Alert, Box, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import KpiStrip from '@/kernel/shell/KpiStrip';
import { useReference } from '@/kernel/data/useReference';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

interface BMSet {
  set_id: string; method: string; applies_to: string; pli: string;
  lower: number; median: number; upper: number; unit: string; source: string; comparables: number;
}
interface BM { sets: BMSet[] }

const Kpis: FC<BindingCtx> = () => {
  const { data } = useReference<BM>('benchmarks');
  const sets = data?.sets ?? [];
  const items: KpiItem[] = [
    { key: 's', label: 'Benchmark sets', value: String(sets.length) },
    { key: 'c', label: 'Comparables', value: String(sets.reduce((s, x) => s + x.comparables, 0)) },
    { key: 'm', label: 'Methods', value: String(new Set(sets.map((s) => s.method)).size) },
  ];
  return <KpiStrip items={items} />;
};

const Sets: FC<BindingCtx> = () => {
  const { data, loading } = useReference<BM>('benchmarks');
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const sets = data?.sets ?? [];
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Arm&rsquo;s-length ranges and royalty comparables that back rate-setting (OTP-3) and adjustments
        (OTP-16). The interquartile range and median drive the inline defensibility read.
      </Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Applies to</TableCell>
            <TableCell>Method</TableCell>
            <TableCell>PLI</TableCell>
            <TableCell align="right">Lower</TableCell>
            <TableCell align="right">Median</TableCell>
            <TableCell align="right">Upper</TableCell>
            <TableCell align="right">n</TableCell>
            <TableCell>Source</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sets.map((s) => (
            <TableRow key={s.set_id} hover>
              <TableCell sx={{ fontWeight: 700 }}>{s.applies_to}</TableCell>
              <TableCell><Chip size="small" label={s.method} variant="outlined" /></TableCell>
              <TableCell>{s.pli}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{s.lower}{s.unit}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{s.median}{s.unit}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{s.upper}{s.unit}</TableCell>
              <TableCell align="right">{s.comparables}</TableCell>
              <TableCell><Typography variant="caption" sx={{ color: 'text.secondary' }}>{s.source}</Typography></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
};

export const otp25: ProcessBinding = { kpis: Kpis, tabs: { overview: Sets } };
