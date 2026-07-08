import type { FC } from 'react';
import { Alert, Box, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { formatCurrency, formatNumber } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';
import KpiStrip from '@/kernel/shell/KpiStrip';
import { useReference } from '@/kernel/data/useReference';
import Term from '@/shared/components/Term';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

interface CbcrRow {
  rbukrs: string;
  jurisdiction: string;
  revenue_related: number;
  revenue_unrelated: number;
  profit_before_tax: number;
  tax_paid: number;
  tax_accrued: number;
  employees: number;
  tangible_assets: number;
}
interface Cbcr { rows: CbcrRow[]; year: number }

const revenue = (r: CbcrRow): number => r.revenue_related + r.revenue_unrelated;

/** ETR for a single jurisdiction (income tax accrued / profit before tax).
 *  Returns null where there is no positive profit to measure against. */
const etr = (r: CbcrRow): number | null =>
  r.profit_before_tax > 0 ? (r.tax_accrued / r.profit_before_tax) * 100 : null;

/** Derived BEPS-13 risk flags per jurisdiction. Each predicate is a
 *  documented red-flag pattern reviewers look for in a Table 1 read. */
const MATERIAL_PROFIT = 10_000_000; // floor below which "no substance" isn't worth flagging

const profitWithoutSubstance = (r: CbcrRow): boolean =>
  r.profit_before_tax >= MATERIAL_PROFIT && r.employees < 25 && r.tangible_assets < r.profit_before_tax * 0.1;

const paidNeqAccrued = (r: CbcrRow): boolean => {
  const base = Math.max(Math.abs(r.tax_accrued), 1);
  return Math.abs(r.tax_paid - r.tax_accrued) / base >= 0.2;
};

const lowEtr = (r: CbcrRow): boolean => {
  const e = etr(r);
  return e != null && e < 10;
};

const isFlagged = (r: CbcrRow): boolean =>
  profitWithoutSubstance(r) || paidNeqAccrued(r) || lowEtr(r);

const Kpis: FC<BindingCtx> = () => {
  const { data } = useReference<Cbcr>('cbcr');
  const rows = data?.rows ?? [];
  const totalRevenue = rows.reduce((s, r) => s + revenue(r), 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit_before_tax, 0);
  const totalTax = rows.reduce((s, r) => s + r.tax_accrued, 0);
  const groupEtr = totalProfit > 0 ? (totalTax / totalProfit) * 100 : 0;
  const flagged = rows.filter(isFlagged).length;
  const items: KpiItem[] = [
    { key: 'j', label: 'Jurisdictions', value: String(rows.length), provenance: 'cbcr · Table 1' },
    { key: 'rev', label: 'Total revenue', value: formatCurrency(totalRevenue, 'USD', true) },
    { key: 'etr', label: 'Group ETR', value: `${groupEtr.toFixed(1)}%`, tone: groupEtr < 10 ? 'risk' : groupEtr < 15 ? 'watch' : 'ok', hint: 'Σ tax accrued / Σ profit' },
    { key: 'flag', label: 'Flagged jurisdictions', value: String(flagged), tone: flagged > 0 ? 'risk' : 'ok', hint: 'substance / paid≠accrued / low ETR' },
  ];
  return <KpiStrip items={items} />;
};

const FlagChip: FC<{ label: string }> = ({ label }) => (
  <Chip
    size="small"
    label={label}
    sx={{ bgcolor: '#FEF2F2', color: tokens.risk, border: `1px solid ${tokens.risk}`, fontWeight: 700, height: 20, mr: 0.5, mb: 0.5 }}
  />
);

const Rows: FC<BindingCtx> = () => {
  const { data, loading } = useReference<Cbcr>('cbcr');
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const rows = [...(data?.rows ?? [])].sort((a, b) => revenue(b) - revenue(a));
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        <Term k="CbCR">Country-by-Country Report</Term> (BEPS Action 13) Table 1, per tax jurisdiction. Validation
        chips surface the red-flag patterns a reviewer checks before filing: material profit booked without
        substance (people / tangible assets), income tax paid that materially diverges from the amount accrued,
        and an effective rate below 10%. Figures are reported from the CbCR seed.
      </Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Jurisdiction</TableCell>
            <TableCell align="right">Rev. unrelated</TableCell>
            <TableCell align="right">Rev. related</TableCell>
            <TableCell align="right">Total revenue</TableCell>
            <TableCell align="right">Profit before tax</TableCell>
            <TableCell align="right">Tax paid</TableCell>
            <TableCell align="right">Tax accrued</TableCell>
            <TableCell align="right">Employees</TableCell>
            <TableCell align="right">Tangible assets</TableCell>
            <TableCell align="right">ETR</TableCell>
            <TableCell>Validation</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => {
            const e = etr(r);
            const flagged = isFlagged(r);
            const low = lowEtr(r);
            return (
              <TableRow key={r.rbukrs} hover sx={flagged ? { bgcolor: '#FEF2F2' } : undefined}>
                <TableCell sx={{ fontWeight: 700 }}>{r.jurisdiction}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.revenue_unrelated, 'USD', true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.revenue_related, 'USD', true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatCurrency(revenue(r), 'USD', true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.profit_before_tax, 'USD', true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.tax_paid, 'USD', true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.tax_accrued, 'USD', true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumber(r.employees)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.tangible_assets, 'USD', true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: low ? tokens.risk : 'inherit' }}>
                  {e == null ? '—' : `${e.toFixed(1)}%`}
                </TableCell>
                <TableCell sx={{ maxWidth: 220 }}>
                  {profitWithoutSubstance(r) && <FlagChip label="profit without substance" />}
                  {paidNeqAccrued(r) && <FlagChip label="paid≠accrued" />}
                  {low && <FlagChip label="low ETR" />}
                  {!flagged && <span style={{ color: tokens.ok }}>✓</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Stack>
  );
};

export const otp34: ProcessBinding = { kpis: Kpis, tabs: { overview: Rows } };
