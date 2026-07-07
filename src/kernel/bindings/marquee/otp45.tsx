import type { FC } from 'react';
import { Alert, Box, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { formatCurrency } from '@/shared/utils/format';
import KpiStrip from '@/kernel/shell/KpiStrip';
import { useReference } from '@/kernel/data/useReference';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

interface Reserve {
  reserve_id: string; issue: string; entity_rbukrs: string; jurisdiction: string;
  gross_reserve: number; currency: string; basis: string; status: string; year: number;
}
interface UTP { reserves: Reserve[] }

const STATUS_COLOR: Record<string, string> = {
  Open: '#D97706',
  'Under audit': '#DC2626',
  'APA pending': '#2563EB',
  Released: '#16A34A',
};

const Kpis: FC<BindingCtx> = () => {
  const { data } = useReference<UTP>('utp_reserve');
  const r = data?.reserves ?? [];
  const total = r.reduce((s, x) => s + x.gross_reserve, 0);
  const open = r.filter((x) => x.status !== 'Released').length;
  const items: KpiItem[] = [
    { key: 't', label: 'Gross reserve (USD-equiv.)', value: formatCurrency(total, 'USD', true), tone: 'risk' },
    { key: 'o', label: 'Open positions', value: String(open), tone: open ? 'watch' : 'ok' },
    { key: 'n', label: 'Issues tracked', value: String(r.length) },
  ];
  return <KpiStrip items={items} />;
};

const Reserves: FC<BindingCtx> = ({ def }) => {
  const { data, loading } = useReference<UTP>('utp_reserve');
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const reserves = data?.reserves ?? [];
  const isProvision = def.id === 'OTP-48';
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        {isProvision
          ? 'These UTP reserves flow into the quarterly/year-end tax provision — operational TP meets the financial statements, traceable to the adjustments and positions that built them.'
          : 'Uncertain tax positions on TP, recognised on a more-likely-than-not basis. Each is traceable to the underlying adjustment, benchmarking, and audit trail.'}
      </Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Issue</TableCell>
            <TableCell>Jurisdiction</TableCell>
            <TableCell align="right">Gross reserve</TableCell>
            <TableCell>Basis</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {reserves.map((r) => (
            <TableRow key={r.reserve_id} hover>
              <TableCell sx={{ fontWeight: 700 }}>{r.issue}</TableCell>
              <TableCell>{r.jurisdiction}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatCurrency(r.gross_reserve, r.currency)}</TableCell>
              <TableCell>{r.basis}</TableCell>
              <TableCell><Chip size="small" label={r.status} sx={{ bgcolor: STATUS_COLOR[r.status] || '#64748B', color: 'white', fontWeight: 700, height: 22 }} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
};

export const otp45: ProcessBinding = { kpis: Kpis, tabs: { overview: Reserves } };
