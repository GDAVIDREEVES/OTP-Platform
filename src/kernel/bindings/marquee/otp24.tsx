import { useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import { useEntities, usePeriod } from '@/shared/providers/DataProvider';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import { statusColor, statusLabel } from '@/shared/utils/status';
import type { Entity } from '@/shared/types/entity';
import type { ForecastParty } from '@/shared/api/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import DrillDrawer from '@/kernel/data/DrillDrawer';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

// Latest-Estimate forecast workpaper (OTP-24). Extends the OTP-21 segmented-grid
// shape: instead of just YTD segmented actuals, each row is the full-year
// Latest Estimate — Actuals-to-date + Forecast-remainder (run-rate) = LE — with
// the full-year margin tested against the entity's arm's-length band and an
// early-warning status. LE is DERIVED from real segment_pl actuals via run-rate
// (no seeded budget); every number traces to GET /api/forecast.

const RANK: Record<string, number> = { 'out-of-range': 0, watch: 1, 'no-data': 2, 'in-range': 3 };
const exceptionsFirst = (ps: ForecastParty[]) =>
  [...ps].sort((a, b) => RANK[a.status] - RANK[b.status] || Math.abs(b.variance ?? 0) - Math.abs(a.variance ?? 0));

const fmtMargin = (m: number | null) => (m == null ? '—' : `${m.toFixed(2)}%`);
const fmtVar = (v: number | null) => (v == null || v === 0 ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}pp`);

function useForecast() {
  const period = usePeriod();
  const [parties, setParties] = useState<ForecastParty[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .forecast(period.year)
      .then((m) => alive && setParties(m.parties))
      .catch(() => alive && setParties([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [period.year]);
  return { parties, loading };
}

const ccyOf = (entities: Entity[], code: string) => entities.find((e) => e.id === code)?.currency ?? 'USD';

const Kpis: FC<BindingCtx> = () => {
  const { parties } = useForecast();
  const leRevenue = parties.reduce((s, p) => s + p.latestEstimate.revenue, 0);
  const leProfit = parties.reduce((s, p) => s + p.latestEstimate.operating_profit, 0);
  const margin = leRevenue ? (leProfit / leRevenue) * 100 : 0;
  const projectedOut = parties.filter((p) => p.status === 'out-of-range').length;
  const projectedWatch = parties.filter((p) => p.status === 'watch').length;
  const items: KpiItem[] = [
    { key: 'le', label: 'Latest-Estimate revenue', value: formatCurrency(leRevenue, 'USD', true), provenance: 'segment_pl · run-rate' },
    { key: 'lm', label: 'LE blended margin', value: `${margin.toFixed(1)}%` },
    { key: 'out', label: 'Projected out of range', value: String(projectedOut), tone: projectedOut > 0 ? 'risk' : 'ok', hint: 'full-year LE beyond band' },
    { key: 'watch', label: 'Projected on watch', value: String(projectedWatch), tone: projectedWatch > 0 ? 'watch' : 'ok', hint: 'approaching tolerance' },
  ];
  return <KpiStrip items={items} />;
};

const Overview: FC<BindingCtx> = () => {
  const { parties, loading } = useForecast();
  const flagged = useMemo(() => exceptionsFirst(parties.filter((p) => p.status === 'out-of-range' || p.status === 'watch')), [parties]);
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }
  return (
    <Stack spacing={2} sx={{ maxWidth: 860 }}>
      <Typography variant="body1">
        The Latest Estimate is built from the monthly <b>segment_pl actuals</b> — actuals-to-date
        plus a <b>run-rate</b> projection of the remaining months — not a separate budget. Each
        tested party&apos;s full-year LE margin is tested against its arm&apos;s-length band so
        deviations are caught before year-end. <b>{flagged.filter((p) => p.status === 'out-of-range').length}</b>{' '}
        parties are projected out of range and <b>{flagged.filter((p) => p.status === 'watch').length}</b> on watch.
      </Typography>
      {flagged.length > 0 ? (
        <Box>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>Early warnings (projected full-year)</Typography>
          {flagged.map((p) => (
            <Stack key={p.rbukrs} direction="row" alignItems="center" spacing={1.5} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Chip size="small" label={statusLabel[p.status]} sx={{ bgcolor: statusColor[p.status], color: 'white', fontWeight: 700 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {p.name}{' '}
                  <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>
                    · {p.country} · {p.function}
                  </Typography>
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Full-year LE margin {fmtMargin(p.fullYearMargin)} vs target {p.targetMarginLabel} · {fmtVar(p.variance)}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Box>
      ) : (
        <Alert severity="success" variant="outlined">
          Every tested party&apos;s projected full-year margin lands within its arm&apos;s-length range.
        </Alert>
      )}
    </Stack>
  );
};

const Grid: FC<BindingCtx> = () => {
  const { parties, loading } = useForecast();
  const entities = useEntities();
  const sorted = useMemo(() => exceptionsFirst(parties), [parties]);
  const [drill, setDrill] = useState<ForecastParty | null>(null);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Status</TableCell>
            <TableCell>Entity</TableCell>
            <TableCell align="right">Actuals-to-date</TableCell>
            <TableCell align="right">Forecast-remainder</TableCell>
            <TableCell align="right">Latest Estimate</TableCell>
            <TableCell align="right">Full-year margin</TableCell>
            <TableCell>Target band</TableCell>
            <TableCell align="right">Variance</TableCell>
            <TableCell align="right">Source</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((p) => {
            const ccy = ccyOf(entities, p.rbukrs);
            return (
              <TableRow key={p.rbukrs} hover>
                <TableCell>
                  <Chip size="small" label={statusLabel[p.status]} sx={{ bgcolor: statusColor[p.status], color: 'white', fontWeight: 700, height: 22 }} />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{p.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {p.function} · {p.monthsPosted}/{p.monthsPosted + p.monthsRemaining} mo actual
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(p.actuals.revenue, ccy, true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>
                  {p.monthsRemaining > 0 ? `+ ${formatCurrency(p.forecastRemainder.revenue, ccy, true)}` : '—'}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatCurrency(p.latestEstimate.revenue, ccy, true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMargin(p.fullYearMargin)}</TableCell>
                <TableCell>{p.targetMarginLabel}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: p.variance ? statusColor['out-of-range'] : 'inherit', fontWeight: p.variance ? 700 : 400 }}>
                  {fmtVar(p.variance)}
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Drill to ACDOCA postings" arrow>
                    <IconButton size="small" onClick={() => setDrill(p)} aria-label={`Drill ${p.name}`}>
                      <TravelExploreIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <DrillDrawer open={!!drill} onClose={() => setDrill(null)} entityId={drill?.rbukrs} entityName={drill?.name} />
    </Box>
  );
};

export const otp24: ProcessBinding = {
  kpis: Kpis,
  tabs: { overview: Overview, calculation: Grid, outputs: Grid },
};
