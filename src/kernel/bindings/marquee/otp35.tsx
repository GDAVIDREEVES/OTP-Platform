import type { FC } from 'react';
import { Alert, Box, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { formatCurrency } from '@/shared/utils/format';
import KpiStrip from '@/kernel/shell/KpiStrip';
import { useReference } from '@/kernel/data/useReference';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

interface P2Row {
  rbukrs: string; jurisdiction: string; globe_income: number; covered_taxes: number;
  etr: number; sbie: number; top_up_tax: number;
}
interface P2 { rows: P2Row[]; year: number }

const Kpis: FC<BindingCtx> = () => {
  const { data } = useReference<P2>('pillar_two');
  const rows = data?.rows ?? [];
  const topup = rows.reduce((s, r) => s + r.top_up_tax, 0);
  const below = rows.filter((r) => r.etr < 15).length;
  const items: KpiItem[] = [
    { key: 't', label: 'GloBE top-up tax', value: formatCurrency(topup, 'USD', true), tone: topup > 0 ? 'risk' : 'ok', provenance: 'pillar_two · CbCR' },
    { key: 'b', label: 'Below 15% ETR', value: String(below), tone: below ? 'watch' : 'ok' },
    { key: 'j', label: 'Jurisdictions', value: String(rows.length) },
  ];
  return <KpiStrip items={items} />;
};

const Rows: FC<BindingCtx> = () => {
  const { data, loading } = useReference<P2>('pillar_two');
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const rows = [...(data?.rows ?? [])].sort((a, b) => a.etr - b.etr);
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Jurisdictional GloBE ETR against the 15% minimum. Where the effective rate falls short, a top-up
        tax arises on the GloBE income above the substance-based carve-out (SBIE). Data extracts from CbCR.
      </Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Jurisdiction</TableCell>
            <TableCell align="right">GloBE income</TableCell>
            <TableCell align="right">Covered taxes</TableCell>
            <TableCell align="right">ETR</TableCell>
            <TableCell align="right">SBIE</TableCell>
            <TableCell align="right">Top-up tax</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => {
            const low = r.etr < 15;
            return (
              <TableRow key={r.rbukrs} hover sx={low ? { bgcolor: '#FEF2F2' } : undefined}>
                <TableCell sx={{ fontWeight: 700 }}>{r.jurisdiction}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.globe_income, 'USD', true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.covered_taxes, 'USD', true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: low ? '#DC2626' : 'inherit' }}>{r.etr.toFixed(1)}%</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.sbie, 'USD', true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: low ? 700 : 400 }}>{r.top_up_tax ? formatCurrency(r.top_up_tax, 'USD', true) : '—'}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Stack>
  );
};

export const otp35: ProcessBinding = { kpis: Kpis, tabs: { overview: Rows } };
