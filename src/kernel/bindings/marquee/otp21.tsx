import { useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
} from '@mui/material';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import { useEntities, usePeriod } from '@/shared/providers/DataProvider';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import type { Entity } from '@/shared/types/entity';
import type { SegmentPnlRow } from '@/shared/api/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import DrillDrawer from '@/kernel/data/DrillDrawer';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

interface AggRow {
  rbukrs: string;
  revenue: number;
  cogs: number;
  opex: number;
  ic: number;
  op: number;
}

function aggregate(rows: SegmentPnlRow[]): AggRow[] {
  const by = new Map<string, AggRow>();
  for (const r of rows) {
    const a = by.get(r.RBUKRS) ?? { rbukrs: r.RBUKRS, revenue: 0, cogs: 0, opex: 0, ic: 0, op: 0 };
    a.revenue += Number(r.revenue) || 0;
    a.cogs += Number(r.cogs) || 0;
    a.opex += (Number(r.opex_production) || 0) + (Number(r.opex_rd) || 0) + (Number(r.opex_sm) || 0) + (Number(r.opex_ga) || 0) + (Number(r.opex_dist) || 0);
    a.ic += Number(r.ic_charges) || 0;
    a.op += Number(r.operating_profit) || 0;
    by.set(r.RBUKRS, a);
  }
  return [...by.values()].sort((x, y) => y.revenue - x.revenue);
}

function useSegments() {
  const period = usePeriod();
  const [rows, setRows] = useState<SegmentPnlRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .segmentPnl({ year: period.year })
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [period.year]);
  return { rows, loading };
}

const nameOf = (entities: Entity[], code: string) => entities.find((e) => e.id === code)?.name ?? code;
const ccyOf = (entities: Entity[], code: string) => entities.find((e) => e.id === code)?.currency ?? 'USD';

const Kpis: FC<BindingCtx> = () => {
  const { rows } = useSegments();
  const agg = useMemo(() => aggregate(rows), [rows]);
  const revenue = agg.reduce((s, a) => s + a.revenue, 0);
  const op = agg.reduce((s, a) => s + a.op, 0);
  const margin = revenue ? (op / revenue) * 100 : 0;
  const items: KpiItem[] = [
    { key: 'r', label: 'Segmented revenue', value: formatCurrency(revenue, 'USD', true) },
    { key: 'o', label: 'Operating profit', value: formatCurrency(op, 'USD', true) },
    { key: 'm', label: 'Blended margin', value: `${margin.toFixed(1)}%` },
    { key: 'n', label: 'Tested parties', value: String(agg.length) },
  ];
  return <KpiStrip items={items} />;
};

const Grid: FC<BindingCtx> = () => {
  const navigate = useNavigate();
  const { rows, loading } = useSegments();
  const entities = useEntities();
  const agg = useMemo(() => aggregate(rows), [rows]);
  const [drill, setDrill] = useState<string | null>(null);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Alert
        severity="info"
        variant="outlined"
        sx={{ mb: 2 }}
        action={
          <Button color="inherit" size="small" onClick={() => navigate('/segmented-pnl')}>
            Open full view
          </Button>
        }
      >
        The segmented P&amp;L off ACDOCA — drill any row to its postings. For ETR
        scenario modeling and the post-charge side-by-side, use the full{' '}
        <b>Segmented P&amp;L</b> view.
      </Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Entity</TableCell>
            <TableCell align="right">Revenue</TableCell>
            <TableCell align="right">COGS</TableCell>
            <TableCell align="right">Opex</TableCell>
            <TableCell align="right">IC charges</TableCell>
            <TableCell align="right">Operating profit</TableCell>
            <TableCell align="right">Margin</TableCell>
            <TableCell align="right">Source</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {agg.map((a) => {
            const ccy = ccyOf(entities, a.rbukrs);
            const margin = a.revenue ? (a.op / a.revenue) * 100 : 0;
            return (
              <TableRow key={a.rbukrs} hover>
                <TableCell sx={{ fontWeight: 700 }}>{nameOf(entities, a.rbukrs)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(a.revenue, ccy, true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(a.cogs, ccy, true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(a.opex, ccy, true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(a.ic, ccy, true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatCurrency(a.op, ccy, true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{margin.toFixed(1)}%</TableCell>
                <TableCell align="right">
                  <Tooltip title="Drill to ACDOCA postings" arrow>
                    <IconButton size="small" onClick={() => setDrill(a.rbukrs)} aria-label={`Drill ${nameOf(entities, a.rbukrs)}`}>
                      <TravelExploreIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <DrillDrawer open={!!drill} onClose={() => setDrill(null)} entityId={drill ?? undefined} entityName={drill ? nameOf(entities, drill) : undefined} />
    </Box>
  );
};

export const otp21: ProcessBinding = { kpis: Kpis, tabs: { overview: Grid } };
