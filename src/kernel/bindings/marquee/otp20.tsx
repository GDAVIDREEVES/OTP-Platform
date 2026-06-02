import { useMemo, useState } from 'react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
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
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import { useEntities, useKpis } from '@/shared/providers/DataProvider';
import { statusColor, statusLabel } from '@/shared/utils/status';
import { formatCurrency } from '@/shared/utils/format';
import type { Entity } from '@/shared/types/entity';
import KpiStrip from '@/kernel/shell/KpiStrip';
import DrillDrawer from '@/kernel/data/DrillDrawer';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

const RANK: Record<string, number> = { 'out-of-range': 0, watch: 1, 'no-data': 2, 'in-range': 3 };
const exceptionsFirst = (es: Entity[]) =>
  [...es].sort((a, b) => RANK[a.status] - RANK[b.status] || Math.abs(b.variance ?? 0) - Math.abs(a.variance ?? 0));

const fmtMargin = (m: number | null) => (m == null ? '—' : `${m.toFixed(2)}%`);
const fmtVar = (v: number | null) => (v == null || v === 0 ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}pp`);

const Kpis: FC<BindingCtx> = () => {
  const k = useKpis();
  const items: KpiItem[] = [
    { key: 'vol', label: 'Intercompany volume', value: formatCurrency(k.totalICVolume, 'USD', true), provenance: 'supply_chain · ACDOCA' },
    { key: 'oor', label: 'Out of range', value: String(k.entitiesOutOfRange), tone: k.entitiesOutOfRange > 0 ? 'risk' : 'ok', hint: 'tested parties beyond range' },
    { key: 'watch', label: 'On watch', value: String(k.entitiesWatch), tone: k.entitiesWatch > 0 ? 'watch' : 'ok', hint: 'approaching tolerance' },
    { key: 'in', label: 'In range', value: `${k.entitiesInRange}/${k.entityCount}`, tone: 'ok', hint: 'within arm’s-length band' },
  ];
  return <KpiStrip items={items} />;
};

function FlaggedRow({ e }: { e: Entity }) {
  const navigate = useNavigate();
  return (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Chip size="small" label={statusLabel[e.status]} sx={{ bgcolor: statusColor[e.status], color: 'white', fontWeight: 700 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {e.name}{' '}
          <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>
            · {e.country} · {e.function}
          </Typography>
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Margin {fmtMargin(e.actualMargin)} vs target {e.targetMarginLabel} · {fmtVar(e.variance)}
        </Typography>
      </Box>
      <Button size="small" variant="outlined" endIcon={<TrendingFlatIcon />} onClick={() => navigate(`/process/OTP-16/overview?entity=${e.id}`)}>
        Adjust
      </Button>
    </Stack>
  );
}

const Overview: FC<BindingCtx> = () => {
  const k = useKpis();
  const flagged = useEntities().filter((e) => e.status === 'out-of-range' || e.status === 'watch');
  return (
    <Stack spacing={2} sx={{ maxWidth: 860 }}>
      <Typography variant="body1">
        <b>{k.entitiesOutOfRange}</b> tested parties are out of range and <b>{k.entitiesWatch}</b> are on
        watch, across <b>{k.entityCount}</b> monitored. This is detection only — each flag is the entry
        point to an in-period adjustment (OTP-16), pre-populated with the gap to range.
      </Typography>
      {flagged.length > 0 ? (
        <Box>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>Flagged this period</Typography>
          {exceptionsFirst(flagged).map((e) => (
            <FlaggedRow key={e.id} e={e} />
          ))}
        </Box>
      ) : (
        <Alert severity="success" variant="outlined">
          All tested parties are within their arm’s-length ranges.
        </Alert>
      )}
    </Stack>
  );
};

const Worklist: FC<BindingCtx> = () => {
  const entities = useEntities();
  const sorted = useMemo(() => exceptionsFirst(entities), [entities]);
  const [drill, setDrill] = useState<Entity | null>(null);
  return (
    <Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Status</TableCell>
            <TableCell>Entity</TableCell>
            <TableCell>Role</TableCell>
            <TableCell align="right">Margin</TableCell>
            <TableCell>Target band</TableCell>
            <TableCell align="right">Variance</TableCell>
            <TableCell align="right">IC volume</TableCell>
            <TableCell align="right">Source</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((e) => (
            <TableRow key={e.id} hover>
              <TableCell>
                <Chip size="small" label={statusLabel[e.status]} sx={{ bgcolor: statusColor[e.status], color: 'white', fontWeight: 700, height: 22 }} />
              </TableCell>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{e.name}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{e.country}</Typography>
              </TableCell>
              <TableCell>{e.function}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMargin(e.actualMargin)}</TableCell>
              <TableCell>{e.targetMarginLabel}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: e.variance ? statusColor['out-of-range'] : 'inherit', fontWeight: e.variance ? 700 : 400 }}>
                {fmtVar(e.variance)}
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(e.ytdVolume, e.currency || 'USD', true)}</TableCell>
              <TableCell align="right">
                <Tooltip title="Drill to ACDOCA postings" arrow>
                  <IconButton size="small" onClick={() => setDrill(e)} aria-label={`Drill ${e.name}`}>
                    <TravelExploreIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <DrillDrawer open={!!drill} onClose={() => setDrill(null)} entityId={drill?.id} entityName={drill?.name} />
    </Box>
  );
};

export const otp20: ProcessBinding = {
  kpis: Kpis,
  tabs: { overview: Overview, worklist: Worklist },
};
