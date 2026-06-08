import { useEffect, useState } from 'react';
import type { FC } from 'react';
import {
  Alert, Box, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import KpiStrip from '@/kernel/shell/KpiStrip';
import type { WhtModel } from '@/shared/api/types';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

/** Alive-guarded fetch of the WHT corridor model (withholdable base live from
 *  supply_chain, treaty/statutory rates from the wht_treaty seed). */
function useWht() {
  const [model, setModel] = useState<WhtModel | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .wht()
      .then((m) => alive && setModel(m))
      .catch(() => alive && setModel(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  return { model, loading };
}

const Kpis: FC<BindingCtx> = () => {
  const { model } = useWht();
  const t = model?.totals;
  const items: KpiItem[] = [
    { key: 'g', label: 'Withholdable base', value: t ? formatCurrency(t.gross, 'USD', true) : '—', provenance: 'supply_chain · royalty + service legs' },
    { key: 'd', label: 'Treaty WHT due', value: t ? formatCurrency(t.wht_due, 'USD', true) : '—', tone: t && t.wht_due > 0 ? 'watch' : 'ok' },
    { key: 's', label: 'Treaty saving vs statutory', value: t ? formatCurrency(t.treaty_saving, 'USD', true) : '—', tone: 'ok', hint: 'reduced treaty rate relief' },
  ];
  return <KpiStrip items={items} />;
};

const Rows: FC<BindingCtx> = () => {
  const { model, loading } = useWht();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const rows = model?.rows ?? [];
  const t = model?.totals;
  if (!rows.length) {
    return <Alert severity="info" variant="outlined">No withholdable IC royalty or service payments for the period.</Alert>;
  }
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Withholding tax on intercompany royalty &amp; service payments. The source (payer) country withholds at the
        reduced treaty rate where a tax treaty or EU directive applies, with the statutory rate as the fallback. The
        withholdable base is live from supply_chain; the bilateral treaty-rate matrix is an illustrative,
        OECD-model-aligned seed.
      </Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Corridor</TableCell>
            <TableCell>Payment</TableCell>
            <TableCell align="right">Gross payment</TableCell>
            <TableCell align="right">Treaty rate</TableCell>
            <TableCell align="right">Statutory rate</TableCell>
            <TableCell align="right">WHT due</TableCell>
            <TableCell align="right">Treaty saving</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} hover>
              <TableCell sx={{ fontWeight: 700 }}>{r.corridor}</TableCell>
              <TableCell>
                <Chip size="small" variant="outlined" label={r.payment_type} />
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.gross, 'USD', true)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{r.treaty_rate.toFixed(2)}%</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>{r.statutory_rate.toFixed(2)}%</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: r.wht_due ? 700 : 400 }}>{r.wht_due ? formatCurrency(r.wht_due, 'USD', true) : '—'}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: '#16A34A' }}>{r.treaty_saving ? formatCurrency(r.treaty_saving, 'USD', true) : '—'}</TableCell>
            </TableRow>
          ))}
          {t && (
            <TableRow sx={{ bgcolor: '#F8FAFC' }}>
              <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
              <TableCell />
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatCurrency(t.gross, 'USD', true)}</TableCell>
              <TableCell />
              <TableCell />
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{t.wht_due ? formatCurrency(t.wht_due, 'USD', true) : '—'}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#16A34A' }}>{formatCurrency(t.treaty_saving, 'USD', true)}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Stack>
  );
};

export const otp46: ProcessBinding = { kpis: Kpis, tabs: { overview: Rows, calculation: Rows } };
