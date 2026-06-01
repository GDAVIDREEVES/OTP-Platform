import type { FC } from 'react';
import { Alert, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { useEntities, useInvoices } from '@/shared/providers/DataProvider';
import { formatCurrency } from '@/shared/utils/format';
import type { Entity } from '@/shared/types/entity';
import KpiStrip from '@/kernel/shell/KpiStrip';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

const STATUS_COLOR: Record<string, string> = {
  'Pending Approval': '#D97706',
  Approved: '#16A34A',
  Exported: '#2563EB',
  Draft: '#64748B',
  Rejected: '#DC2626',
  Reversed: '#64748B',
};

const nameOf = (entities: Entity[], code: string) => entities.find((e) => e.id === code)?.name ?? code;
const useBatch = () => {
  const invoices = useInvoices();
  const royalty = invoices.filter((i) => /royalt/i.test(i.type));
  return royalty.length ? royalty : invoices;
};

const Kpis: FC<BindingCtx> = () => {
  const batch = useBatch();
  const total = batch.reduce((s, i) => s + i.amount, 0);
  const pending = batch.filter((i) => i.status === 'Pending Approval').length;
  const posted = batch.filter((i) => i.status === 'Approved' || i.status === 'Exported').length;
  const items: KpiItem[] = [
    { key: 'n', label: 'Charges in batch', value: String(batch.length) },
    { key: 'v', label: 'Batch value', value: formatCurrency(total, 'USD', true) },
    { key: 'p', label: 'Pending approval', value: String(pending), tone: pending ? 'watch' : 'ok' },
    { key: 'd', label: 'Posted', value: String(posted), tone: 'ok' },
  ];
  return <KpiStrip items={items} />;
};

const Batch: FC<BindingCtx> = () => {
  const batch = useBatch();
  const entities = useEntities();
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Generate → stage → review → post. Each line is drillable to its postings, exceptions surface in
        the batch rather than being buried, and posting routes through maker-checker before it commits.
      </Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Invoice</TableCell>
            <TableCell>Date</TableCell>
            <TableCell>Payor → Payee</TableCell>
            <TableCell>Type</TableCell>
            <TableCell align="right">Amount</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {batch.slice(0, 50).map((i) => (
            <TableRow key={i.id} hover>
              <TableCell>{i.id}</TableCell>
              <TableCell>{i.date}</TableCell>
              <TableCell>{nameOf(entities, i.payor)} → {nameOf(entities, i.payee)}</TableCell>
              <TableCell>{i.type}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatCurrency(i.amount, i.currency || 'USD')}
              </TableCell>
              <TableCell>
                <Chip size="small" label={i.status} sx={{ bgcolor: STATUS_COLOR[i.status] || '#64748B', color: 'white', fontWeight: 700, height: 22 }} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
};

export const otp9: ProcessBinding = { kpis: Kpis, tabs: { overview: Batch, outputs: Batch } };
