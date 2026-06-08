import { useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';
import type { StewardshipModel } from '@/shared/api/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

/** Alive-guarded fetch of the stewardship model (cost base live from segment_pl,
 *  candidate lines from the fabricated register). Mirrors otp21's `useSegments`. */
function useStewardship() {
  const [model, setModel] = useState<StewardshipModel | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .stewardship()
      .then((m) => alive && setModel(m))
      .catch(() => alive && setModel(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  return { model, loading };
}

/** Roll up the excluded total + adjusted cost base from the *current* (locally
 *  toggled) classification, so the figures track the user's edits live. */
function rollup(model: StewardshipModel, excludedFlags: Record<string, boolean>) {
  const excluded = model.lines
    .filter((ln) => excludedFlags[ln.id])
    .reduce((s, ln) => s + ln.amount, 0);
  return { excluded, adjusted: model.cost_base - excluded };
}

const Kpis: FC<BindingCtx> = () => {
  const { model } = useStewardship();
  const excludedFlags = useMemo(
    () => Object.fromEntries((model?.lines ?? []).map((ln) => [ln.id, ln.stewardship])),
    [model],
  );
  const { excluded, adjusted } = model ? rollup(model, excludedFlags) : { excluded: 0, adjusted: 0 };
  const items: KpiItem[] = [
    { key: 'base', label: 'Parent cost base', value: model ? formatCurrency(model.cost_base, 'USD', true) : '—', provenance: 'segment_pl · opex_ga (1000 + 3100)' },
    { key: 'excl', label: 'Stewardship excluded', value: model ? formatCurrency(excluded, 'USD', true) : '—', tone: 'watch', hint: 'shareholder costs removed' },
    { key: 'adj', label: 'Adjusted cost base', value: model ? formatCurrency(adjusted, 'USD', true) : '—', hint: 'chargeable base after exclusion' },
  ];
  return <KpiStrip items={items} />;
};

const Register: FC<BindingCtx> = () => {
  const { model, loading } = useStewardship();
  // Local classification: seeded from the server default; toggled in-session.
  const [excludedFlags, setExcludedFlags] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (model) setExcludedFlags(Object.fromEntries(model.lines.map((ln) => [ln.id, ln.stewardship])));
  }, [model]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!model || !model.lines.length) {
    return <Alert severity="info" variant="outlined">No candidate cost lines for the period.</Alert>;
  }

  const { excluded, adjusted } = rollup(model, excludedFlags);
  const toggle = (id: string) => setExcludedFlags((f) => ({ ...f, [id]: !f[id] }));

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Shareholder/stewardship review of the parent cost base. The{' '}
        <b>{formatCurrency(model.cost_base, 'USD', true)}</b> base is live from segment_pl (parent
        G&amp;A). Each candidate line below is screened under OECD TPG 7.9&ndash;7.10 — toggle a line
        as a shareholder/stewardship cost to <b>exclude</b> it from the chargeable base. Adjusted base
        updates as you classify.
      </Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Cost line</TableCell>
            <TableCell>Entity</TableCell>
            <TableCell>Category</TableCell>
            <TableCell align="right">Amount</TableCell>
            <TableCell align="center">Shareholder / exclude</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {model.lines.map((ln) => {
            const excl = !!excludedFlags[ln.id];
            return (
              <TableRow key={ln.id} hover>
                <TableCell sx={{ fontWeight: 700 }}>
                  {ln.description}
                  <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontWeight: 400 }}>
                    {ln.rationale}
                  </Typography>
                </TableCell>
                <TableCell>{ln.name}</TableCell>
                <TableCell>{ln.category}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: excl ? tokens.watch : 'inherit', fontWeight: 700 }}>
                  {formatCurrency(ln.amount, ln.currency, true)}
                </TableCell>
                <TableCell align="center">
                  <Tooltip title={excl ? 'Excluded from the cost base' : 'Kept in the cost base'} arrow>
                    <Switch
                      size="small"
                      checked={excl}
                      onChange={() => toggle(ln.id)}
                      inputProps={{ 'aria-label': `Classify ${ln.description} as stewardship` }}
                    />
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow>
            <TableCell colSpan={3} sx={{ fontWeight: 700 }}>
              Excluded total
              <Chip size="small" label={`${model.lines.filter((l) => excludedFlags[l.id]).length} lines`} sx={{ ml: 1, height: 20 }} />
            </TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: tokens.watch }}>
              {formatCurrency(excluded, 'USD', true)}
            </TableCell>
            <TableCell />
          </TableRow>
          <TableRow>
            <TableCell colSpan={3} sx={{ fontWeight: 700 }}>Adjusted (chargeable) cost base</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
              {formatCurrency(adjusted, 'USD', true)}
            </TableCell>
            <TableCell />
          </TableRow>
        </TableBody>
      </Table>
    </Stack>
  );
};

export const otp15: ProcessBinding = { kpis: Kpis, tabs: { overview: Register, calculation: Register } };
