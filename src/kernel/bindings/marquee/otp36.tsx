import { useEffect, useState } from 'react';
import type { FC } from 'react';
import {
  Alert, Box, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';
import KpiStrip from '@/kernel/shell/KpiStrip';
import type { BeatModel } from '@/shared/api/types';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

/** Alive-guarded fetch of the BEAT model (related-party base live from journal). */
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
  const pct = model?.base_erosion_pct ?? 0;
  const met = model?.threshold_met ?? false;
  const items: KpiItem[] = [
    {
      key: 'be',
      label: 'Base-erosion %',
      value: model ? `${pct.toFixed(2)}%` : '—',
      tone: met ? 'risk' : 'ok',
      provenance: 'journal · RASSC',
      hint: 'base-eroding / total deductions',
    },
    {
      key: 'th',
      label: '3% threshold',
      value: met ? 'Met — applicable taxpayer' : 'Below',
      tone: met ? 'watch' : 'ok',
    },
    {
      key: 'bep',
      label: 'Base-eroding payments',
      value: model ? formatCurrency(model.base_eroding_payments, 'USD', true) : '—',
      hint: 'royalties + services + interest (COGS excepted)',
    },
    {
      key: 'mti',
      label: 'Modified taxable income',
      value: model ? formatCurrency(model.modified_taxable_income, 'USD', true) : '—',
    },
  ];
  return <KpiStrip items={items} />;
};

const Row: FC<{ label: string; value: string; bold?: boolean; tone?: string }> = ({ label, value, bold, tone }) => (
  <TableRow hover>
    <TableCell sx={{ fontWeight: bold ? 700 : 400 }}>{label}</TableCell>
    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: bold ? 700 : 400, color: tone ?? 'inherit' }}>
      {value}
    </TableCell>
  </TableRow>
);

const Computation: FC<BindingCtx> = () => {
  const { model, loading } = useBeat();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model) return <Alert severity="info" variant="outlined">No BEAT data for the period.</Alert>;
  const met = model.threshold_met;
  return (
    <Stack spacing={2}>
      <Alert severity={met ? 'warning' : 'info'} variant="outlined">
        BEAT (IRC §59A) tests the US payer ({model.us_payer_name}). Base-eroding payments are the deductible
        related-party amounts — royalties, services and interest — with the cost-of-goods-sold exception removed.
        The base-erosion percentage is base-eroding payments over total deductions, against the {model.threshold_pct}% threshold.
        The related-party base is live from the journal (RASSC postings); the account→payment-type classification is an
        assumed mapping.
      </Alert>

      <Box>
        <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.secondary', fontWeight: 700 }}>
          Base-erosion percentage test
        </Typography>
        <Table size="small">
          <TableBody>
            <Row label="Related-party deductions (journal RASSC)" value={formatCurrency(model.related_party_deductions, 'USD', true)} />
            <Row label="Less: COGS exception §59A(d)(1)" value={`(${formatCurrency(model.cogs_excluded, 'USD', true)})`} />
            <Row label="Base-eroding payments" value={formatCurrency(model.base_eroding_payments, 'USD', true)} bold />
            <Row label="Total deductions" value={formatCurrency(model.total_deductions, 'USD', true)} />
            <TableRow hover>
              <TableCell sx={{ fontWeight: 700 }}>Base-erosion percentage</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: met ? tokens.risk : tokens.ok }}>
                {model.base_erosion_pct.toFixed(2)}%
                <Chip
                  size="small"
                  label={met ? `≥ ${model.threshold_pct}% — applicable` : `< ${model.threshold_pct}%`}
                  sx={{ ml: 1, height: 20, fontWeight: 700, bgcolor: met ? '#FEF2F2' : '#F0FDF4', color: met ? tokens.risk : tokens.ok }}
                />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Box>

      <Box>
        <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.secondary', fontWeight: 700 }}>
          Related-party deductions by payment type
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Payment type</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell>Treatment</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {model.payment_types.map((p) => (
              <TableRow key={p.type} hover>
                <TableCell sx={{ fontWeight: 700 }}>{p.label}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(p.amount, 'USD', true)}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={p.base_eroding ? 'base-eroding' : 'excepted (COGS)'}
                    sx={{ height: 20, fontWeight: 700, bgcolor: p.base_eroding ? '#FEF2F2' : '#F0FDF4', color: p.base_eroding ? tokens.risk : tokens.ok }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>

      <Box>
        <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.secondary', fontWeight: 700 }}>
          Modified taxable income (MTI) build-up
        </Typography>
        <Table size="small">
          <TableBody>
            <Row label="Gross receipts (segment_pl revenue)" value={formatCurrency(model.gross_receipts, 'USD', true)} />
            <Row label="Less: total deductions" value={`(${formatCurrency(model.total_deductions, 'USD', true)})`} />
            <Row label="Regular taxable income" value={formatCurrency(model.regular_taxable_income, 'USD', true)} bold />
            <Row label="Add back: base-eroding tax benefits" value={formatCurrency(model.base_eroding_payments, 'USD', true)} />
            <Row label="Modified taxable income" value={formatCurrency(model.modified_taxable_income, 'USD', true)} bold />
            <Row
              label={`BEAT base (MTI × ${model.beat_rate_pct}%)`}
              value={formatCurrency(model.beat_base_tax, 'USD', true)}
              bold
              tone={met ? tokens.risk : undefined}
            />
          </TableBody>
        </Table>
      </Box>
    </Stack>
  );
};

export const otp36: ProcessBinding = { kpis: Kpis, tabs: { overview: Computation, calculation: Computation } };
