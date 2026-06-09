import { useEffect, useState } from 'react';
import type { FC } from 'react';
import {
  Alert, Box, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import KpiStrip from '@/kernel/shell/KpiStrip';
import type { VatModel } from '@/shared/api/types';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

/** Alive-guarded fetch of the VAT / indirect-tax model (VATable base live from
 *  supply_chain royalty + service + goods legs; standard rate matrix +
 *  recoverability flags from the vat seed). */
function useVat() {
  const [model, setModel] = useState<VatModel | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .vat()
      .then((m) => alive && setModel(m))
      .catch(() => alive && setModel(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  return { model, loading };
}

const FabricatedNote: FC = () => (
  <Alert severity="warning" variant="outlined">
    <b>Fabricated data — illustrative.</b> The standard VAT/GST rate matrix and the per-jurisdiction recoverability
    flags are a simplified, publicly checkable seed (e.g. DE 19%, FR 20%, GB 20%, NL 21%, IE 23%, CH 8.1%, IN 18%
    GST, US sales-tax-only) — verify the current rate and the registration / recovery position per entity before
    relying on these figures. The VATable base they are applied to is real (from supply_chain).
  </Alert>
);

const Kpis: FC<BindingCtx> = () => {
  const { model } = useVat();
  const t = model?.totals;
  const items: KpiItem[] = [
    { key: 'b', label: 'VATable base', value: t ? formatCurrency(t.base, 'USD', true) : '—', provenance: 'supply_chain · royalty + service + goods legs' },
    { key: 'c', label: 'VAT charged', value: t ? formatCurrency(t.vat_charged, 'USD', true) : '—', tone: 'watch' },
    { key: 'r', label: 'Recoverable input VAT', value: t ? formatCurrency(t.recoverable, 'USD', true) : '—', tone: 'ok', hint: 'reclaimable where the recipient makes taxable supplies' },
    { key: 'n', label: 'Net cost leakage', value: t ? formatCurrency(t.net_cost, 'USD', true) : '—', tone: t && t.net_cost > 0 ? 'watch' : 'ok', hint: 'non-recoverable VAT/GST falling to P&L' },
  ];
  return <KpiStrip items={items} />;
};

const Rows: FC<BindingCtx> = () => {
  const { model, loading } = useVat();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const rows = model?.rows ?? [];
  const t = model?.totals;
  if (!rows.length) {
    return <Alert severity="info" variant="outlined">No VATable IC royalty, service or goods flows for the period.</Alert>;
  }
  return (
    <Stack spacing={2}>
      <FabricatedNote />
      <Alert severity="info" variant="outlined">
        Indirect-tax (VAT/GST) impact on intercompany royalty, service and goods flows, grouped by the recipient
        jurisdiction (the place of supply / reverse-charge for cross-border B2B). VAT charged is the VATable base at
        the jurisdiction's standard rate; the recoverable portion is reclaimable input VAT where the recipient makes
        taxable supplies, so only the non-recoverable balance is a real cost leakage to P&amp;L. The VATable base is
        live from supply_chain; the standard-rate matrix is an illustrative seed.
      </Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Jurisdiction</TableCell>
            <TableCell>Regime</TableCell>
            <TableCell align="right">VATable base</TableCell>
            <TableCell align="right">Rate</TableCell>
            <TableCell align="right">VAT charged</TableCell>
            <TableCell align="right">Recoverable</TableCell>
            <TableCell align="right">Net cost</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} hover>
              <TableCell sx={{ fontWeight: 700 }}>{r.country} ({r.jurisdiction})</TableCell>
              <TableCell>
                <Chip size="small" variant="outlined" label={r.regime} />
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.base, 'USD', true)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{r.rate.toFixed(1)}%</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.vat_charged ? formatCurrency(r.vat_charged, 'USD', true) : '—'}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: '#16A34A' }}>{r.recoverable ? formatCurrency(r.recoverable, 'USD', true) : '—'}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: r.net_cost ? 700 : 400, color: r.net_cost ? '#D97706' : 'text.secondary' }}>{r.net_cost ? formatCurrency(r.net_cost, 'USD', true) : '—'}</TableCell>
            </TableRow>
          ))}
          {t && (
            <TableRow sx={{ bgcolor: '#F8FAFC' }}>
              <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
              <TableCell />
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatCurrency(t.base, 'USD', true)}</TableCell>
              <TableCell />
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatCurrency(t.vat_charged, 'USD', true)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#16A34A' }}>{formatCurrency(t.recoverable, 'USD', true)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#D97706' }}>{formatCurrency(t.net_cost, 'USD', true)}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Stack>
  );
};

export const otp19: ProcessBinding = { kpis: Kpis, tabs: { overview: Rows, calculation: Rows } };
