import { useEffect, useState } from 'react';
import type { FC } from 'react';
import {
  Alert, Box, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { formatCurrency, formatNumber } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';
import KpiStrip from '@/kernel/shell/KpiStrip';
import { useReference } from '@/kernel/data/useReference';
import type { BeatModel } from '@/shared/api/types';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

/** Form 8975 (CbCR) reuses the cbcr seed exactly as OTP-34 does. */
interface CbcrRow {
  rbukrs: string;
  jurisdiction: string;
  revenue_related: number;
  revenue_unrelated: number;
  profit_before_tax: number;
  tax_accrued: number;
  employees: number;
  tangible_assets: number;
}
interface Cbcr { rows: CbcrRow[]; year: number }

/** Alive-guarded fetch of the BEAT model (Schedule M rollup is live from journal). */
function useBeat() {
  const [model, setModel] = useState<BeatModel | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .beat()
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
  const { model } = useBeat();
  const { data } = useReference<Cbcr>('cbcr');
  const cfcs = model?.schedule_m ?? [];
  const totalPaid = cfcs.reduce((s, c) => s + c.paid_to, 0);
  const items: KpiItem[] = [
    { key: 'cfc', label: 'CFCs (Form 5471/8858)', value: String(cfcs.length), provenance: 'journal · RASSC' },
    { key: 'paid', label: 'Related-party paid to CFCs', value: model ? formatCurrency(totalPaid, 'USD', true) : '—', hint: 'Schedule M' },
    { key: 'cbcr', label: 'Form 8975 jurisdictions', value: String(data?.rows?.length ?? 0), provenance: 'cbcr · Table 1' },
  ];
  return <KpiStrip items={items} />;
};

/** Form 5471/8858 Schedule M — per-CFC related-party flows + foreign P&L. */
const ScheduleM: FC<BindingCtx> = () => {
  const { model, loading } = useBeat();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const cfcs = model?.schedule_m ?? [];
  if (!cfcs.length) return <Alert severity="info" variant="outlined">No CFC counterparties for the period.</Alert>;
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Form 5471 / 8858 Schedule M inputs: each affiliate counterparty (RASSC) of the US payer with the related-party
        amounts paid to and received from it, alongside the counterparty&rsquo;s foreign P&amp;L. Amounts are live from the
        journal (RASSC postings) and segment_pl foreign P&amp;L. Form 8975 (CbCR) is on the Calculation tab.
      </Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>CFC / counterparty</TableCell>
            <TableCell align="right">Paid to (US deduction)</TableCell>
            <TableCell align="right">Received from</TableCell>
            <TableCell align="right">Foreign revenue</TableCell>
            <TableCell align="right">Foreign operating profit</TableCell>
            <TableCell align="right">Postings</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {cfcs.map((c) => (
            <TableRow key={c.rbukrs} hover>
              <TableCell sx={{ fontWeight: 700 }}>{c.name}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(c.paid_to, 'USD', true)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(c.received_from, 'USD', true)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(c.foreign_revenue, 'USD', true)}</TableCell>
              <TableCell
                align="right"
                sx={{ fontVariantNumeric: 'tabular-nums', color: c.foreign_operating_profit < 0 ? tokens.risk : 'inherit' }}
              >
                {formatCurrency(c.foreign_operating_profit, 'USD', true)}
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumber(c.postings)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
};

const revenue = (r: CbcrRow): number => r.revenue_related + r.revenue_unrelated;

/** Form 8975 (CbCR) — reused from the cbcr seed, exactly as OTP-34. */
const Form8975: FC<BindingCtx> = () => {
  const { data, loading } = useReference<Cbcr>('cbcr');
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const rows = [...(data?.rows ?? [])].sort((a, b) => revenue(b) - revenue(a));
  if (!rows.length) return <Alert severity="info" variant="outlined">No CbCR data for the period.</Alert>;
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Form 8975 (Country-by-Country Report) inputs, per tax jurisdiction — the same CbCR Table 1 dataset behind
        OTP-34. Revenue is split related vs. unrelated, with profit before tax, income tax accrued, employees and
        tangible assets.
      </Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Jurisdiction</TableCell>
            <TableCell align="right">Rev. unrelated</TableCell>
            <TableCell align="right">Rev. related</TableCell>
            <TableCell align="right">Total revenue</TableCell>
            <TableCell align="right">Profit before tax</TableCell>
            <TableCell align="right">Tax accrued</TableCell>
            <TableCell align="right">Employees</TableCell>
            <TableCell align="right">Tangible assets</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.rbukrs} hover>
              <TableCell sx={{ fontWeight: 700 }}>{r.jurisdiction}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.revenue_unrelated, 'USD', true)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.revenue_related, 'USD', true)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatCurrency(revenue(r), 'USD', true)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.profit_before_tax, 'USD', true)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.tax_accrued, 'USD', true)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumber(r.employees)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.tangible_assets, 'USD', true)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
};

const Overview: FC<BindingCtx> = (ctx) => (
  <Stack spacing={3}>
    <Box>
      <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.secondary', fontWeight: 700 }}>
        Form 5471 / 8858 — Schedule M (per-CFC related-party flows)
      </Typography>
      <ScheduleM {...ctx} />
    </Box>
  </Stack>
);

export const otp38: ProcessBinding = { kpis: Kpis, tabs: { overview: Overview, calculation: Form8975 } };
