import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import AppShell from '@/shared/components/layout/AppShell';
import { useEntities, useFlows, useKpis } from '@/shared/providers/DataProvider';
import { useProcesses } from '@/kernel/registry/useProcesses';
import { useReference } from '@/kernel/data/useReference';
import { formatCurrency } from '@/shared/utils/format';
import { statusColor, statusLabel } from '@/shared/utils/status';
import type { EntityStatus } from '@/shared/types/entity';
import KpiStrip from '@/kernel/shell/KpiStrip';
import type { KpiItem } from '@/kernel/bindings/types';

const STATUS_RANK: Record<string, number> = { 'out-of-range': 0, watch: 1, 'no-data': 2, 'in-range': 3 };

export default function ExposureDashboard() {
  const navigate = useNavigate();
  const k = useKpis();
  const entities = useEntities();
  const flows = useFlows();
  const { catalog } = useProcesses();
  const { data: p2 } = useReference<{ rows: { top_up_tax: number }[] }>('pillar_two');
  const { data: utp } = useReference<{ reserves: { gross_reserve: number }[] }>('utp_reserve');

  const topUp = (p2?.rows ?? []).reduce((s, r) => s + r.top_up_tax, 0);
  const reserve = (utp?.reserves ?? []).reduce((s, r) => s + r.gross_reserve, 0);

  const byCountry = useMemo(() => {
    const m = new Map<string, { country: string; n: number; volume: number; worst: EntityStatus }>();
    for (const e of entities) {
      const cur = m.get(e.country) ?? { country: e.country, n: 0, volume: 0, worst: 'in-range' as EntityStatus };
      cur.n += 1;
      cur.volume += e.ytdVolume;
      if (STATUS_RANK[e.status] < STATUS_RANK[cur.worst]) cur.worst = e.status;
      m.set(e.country, cur);
    }
    return [...m.values()].sort((a, b) => STATUS_RANK[a.worst] - STATUS_RANK[b.worst] || b.volume - a.volume);
  }, [entities]);

  const byType = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of flows) m.set(f.type, (m.get(f.type) ?? 0) + f.ytdVolume);
    return [...m.entries()].map(([type, volume]) => ({ type, volume })).sort((a, b) => b.volume - a.volume);
  }, [flows]);

  const top15 = (catalog?.processes ?? []).filter((p) => p.top15);

  const kpis: KpiItem[] = [
    { key: 'vol', label: 'Intercompany flow', value: formatCurrency(k.totalICVolume, 'USD', true) },
    { key: 'oor', label: 'Out of range', value: String(k.entitiesOutOfRange), tone: k.entitiesOutOfRange ? 'risk' : 'ok' },
    { key: 'adj', label: 'Open adjustments', value: String(k.openAdjustments), tone: k.openAdjustments ? 'watch' : 'ok' },
    { key: 'p2', label: 'Pillar Two top-up', value: formatCurrency(topUp, 'USD', true), tone: topUp ? 'risk' : 'ok' },
    { key: 'utp', label: 'TP reserve', value: formatCurrency(reserve, 'USD', true), tone: 'risk' },
  ];

  return (
    <AppShell pageTitle="Exposure & risk">
      <Stack spacing={3}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>Group exposure & risk</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            The group position first, then where risk concentrates. Every figure traces to the records and
            their audit trail.
          </Typography>
        </Box>

        <KpiStrip items={kpis} />

        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} alignItems="flex-start">
          <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 0, width: '100%' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>Jurisdictional risk</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Jurisdiction</TableCell>
                  <TableCell align="right">Entities</TableCell>
                  <TableCell align="right">IC volume</TableCell>
                  <TableCell>Health</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {byCountry.map((c) => (
                  <TableRow key={c.country} hover sx={{ cursor: 'pointer' }} onClick={() => navigate('/process/OTP-20/worklist')}>
                    <TableCell sx={{ fontWeight: 700 }}>{c.country}</TableCell>
                    <TableCell align="right">{c.n}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(c.volume, 'USD', true)}</TableCell>
                    <TableCell><Chip size="small" label={statusLabel[c.worst]} sx={{ bgcolor: statusColor[c.worst], color: 'white', fontWeight: 700, height: 22 }} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 0, width: '100%' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>Exposure by transaction type</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell>
                  <TableCell align="right">IC volume</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {byType.map((t) => (
                  <TableRow key={t.type} hover>
                    <TableCell sx={{ fontWeight: 700 }}>{t.type}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(t.volume, 'USD', true)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Stack>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>Top-15 pharmaceutical process health</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 1 }}>
            {top15.map((p) => (
              <Chip
                key={p.id}
                label={`${p.id} · ${p.name}`}
                onClick={() => navigate(`/process/${p.id}/overview`)}
                variant="outlined"
                sx={{ justifyContent: 'flex-start', height: 'auto', py: 0.5, '& .MuiChip-label': { whiteSpace: 'normal' } }}
              />
            ))}
          </Box>
        </Paper>

        <Box>
          <Button variant="contained" size="large" onClick={() => navigate('/reports')}>
            Generate Audit-Committee pack
          </Button>
        </Box>
      </Stack>
    </AppShell>
  );
}
