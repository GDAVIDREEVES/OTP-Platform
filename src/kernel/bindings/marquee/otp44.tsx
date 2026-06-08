import { useEffect, useState } from 'react';
import type { FC } from 'react';
import {
  Alert, Box, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import KpiStrip from '@/kernel/shell/KpiStrip';
import type { ProfitSplitKey, ProfitSplitModel } from '@/shared/api/types';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

const KEY_LABEL: Record<ProfitSplitKey, string> = { opex_rd: 'R&D', sga: 'SG&A' };
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Alive-guarded fetch of the reconciled profit-split model (live from segment_pl). */
function useProfitSplit(key: ProfitSplitKey) {
  const [model, setModel] = useState<ProfitSplitModel | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .profitSplit({ key })
      .then((m) => alive && setModel(m))
      .catch(() => alive && setModel(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [key]);
  return { model, loading };
}

const Kpis: FC<BindingCtx> = () => {
  const { model } = useProfitSplit('opex_rd');
  const items: KpiItem[] = [
    { key: 'combined', label: 'Combined residual profit', value: model ? formatCurrency(model.combined_profit, 'USD', true) : '—', provenance: 'segment_pl · operating_profit' },
    { key: 'parties', label: 'Non-routine parties', value: model ? String(model.participants.length) : '—' },
    { key: 'key', label: 'Default key', value: model ? KEY_LABEL[model.default_key] : '—', hint: 'R&D value-driver' },
  ];
  return <KpiStrip items={items} />;
};

const SplitTable: FC<{ model: ProfitSplitModel }> = ({ model }) => (
  <Table size="small">
    <TableHead>
      <TableRow>
        <TableCell>Participant</TableCell>
        <TableCell align="right">Key value</TableCell>
        <TableCell align="right">Residual share</TableCell>
        <TableCell align="right">Allocated profit</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {model.participants.map((p) => (
        <TableRow key={p.rbukrs} hover>
          <TableCell sx={{ fontWeight: 700 }}>{p.name}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(p.key_value, 'USD', true)}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{pct(p.residual_share)}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(p.allocated_profit, 'USD', true)}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

const Workpaper: FC<BindingCtx> = () => {
  const [key, setKey] = useState<ProfitSplitKey>('opex_rd');
  const { model, loading } = useProfitSplit(key);
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.participants.length) {
    return <Alert severity="info" variant="outlined">No profit-split participants for the period.</Alert>;
  }
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Residual profit-split design: the {formatCurrency(model.combined_profit, 'USD', true)} combined operating profit of
        the non-routine parties is allocated by a value-driver key. Each participant&rsquo;s share is its key value over the
        group total. Figures are live from segment_pl.
      </Alert>
      <Box>
        <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.secondary' }}>Allocation key</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={key}
          onChange={(_, v) => v && setKey(v as ProfitSplitKey)}
        >
          {model.keys.map((k) => (
            <ToggleButton key={k} value={k}>{KEY_LABEL[k]}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>
      <SplitTable model={model} />
    </Stack>
  );
};

export const otp44: ProcessBinding = { kpis: Kpis, tabs: { overview: Workpaper, calculation: Workpaper } };
