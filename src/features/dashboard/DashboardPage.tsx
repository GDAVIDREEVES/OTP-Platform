import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Chip,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AppShell from '@/shared/components/layout/AppShell';
import BasisBadge from '@/shared/components/BasisBadge';
import WorldMap from '@/features/dashboard/WorldMap';
import { useEntities, useKpis, useMarginTrend } from '@/shared/providers/DataProvider';
import { formatCurrency } from '@/shared/utils/format';
import KpiCard from './components/KpiCard';
import EntityTable from './components/EntityTable';
import MarginTrendChart from './components/MarginTrendChart';
import AlertsRail, { buildAlerts } from './components/AlertsRail';

export default function Dashboard() {
  const navigate = useNavigate();
  const entities = useEntities();
  const kpis = useKpis();
  const monthlyMarginTrend = useMarginTrend();
  const [filterOutOfRange, setFilterOutOfRange] = useState(false);

  const tableEntities = useMemo(() => {
    const order = { 'out-of-range': 0, watch: 1, 'in-range': 2, 'no-data': 3 } as const;
    const base = [...entities].sort(
      (a, b) => order[a.status] - order[b.status],
    );
    return filterOutOfRange
      ? base.filter((e) => e.status === 'out-of-range')
      : base;
  }, [entities, filterOutOfRange]);

  const alerts = useMemo(() => buildAlerts(entities), [entities]);

  return (
    <AppShell pageTitle="Monitoring">
      <Grid container spacing={2.5}>
        {/* Main column */}
        <Grid item xs={12} lg={8}>
          {/* P&L basis for every margin/KPI on this page */}
          <Box sx={{ mb: 1.5 }}>
            <BasisBadge />
          </Box>
          {/* KPI Strip */}
          <Grid container spacing={2} sx={{ mb: 2.5 }}>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                label="Total IC Volume (YTD)"
                value={formatCurrency(kpis.totalICVolume, 'USD', true)}
                subtitle={`Across ${kpis.entityCount} entities`}
                accent="primary"
                icon={<TrendingUpIcon />}
                trend="+8.3% vs. prior year"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                label="Entities In Range"
                value={`${kpis.entitiesInRange} of ${kpis.entityCount}`}
                subtitle="Operating within arm's length policy"
                accent="success"
                icon={<CheckCircleIcon />}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                label="Entities Out of Range"
                value={String(kpis.entitiesOutOfRange)}
                subtitle="Require attention or adjustment"
                accent="error"
                icon={<ErrorIcon />}
                onClick={() => setFilterOutOfRange((v) => !v)}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                label="Pending Actions"
                value={String(kpis.openAdjustments)}
                subtitle="3 invoices awaiting approval · 4 adjustments pending review"
                accent="warning"
                icon={<AccessTimeIcon />}
                onClick={() => navigate('/invoicing')}
              />
            </Grid>
          </Grid>

          {/* Tax-controversy posture strip */}
          <Paper
            sx={{
              p: 1.5,
              mb: 2.5,
              display: 'flex',
              gap: 2,
              alignItems: 'center',
              flexWrap: 'wrap',
              borderLeft: '3px solid #2563EB',
            }}
          >
            <Typography
              variant="caption"
              sx={{
                color: '#64748B',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Tax controversy posture
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip
                label={`${kpis.flowsUnderAPA} chains under APA`}
                size="small"
                sx={{
                  bgcolor: '#EFF6FF',
                  color: '#1D4ED8',
                  fontWeight: 700,
                  border: '1px solid #BFDBFE',
                }}
              />
              <Chip
                label={`${kpis.flowsChallenged} chains challenged`}
                size="small"
                sx={{
                  bgcolor: '#FEF2F2',
                  color: '#B91C1C',
                  fontWeight: 700,
                  border: '1px solid #FECACA',
                }}
                onClick={() => navigate('/policy')}
              />
            </Stack>
            <Typography variant="caption" sx={{ color: '#64748B', ml: 'auto' }}>
              {kpis.flowsChallenged > 0
                ? 'Click "challenged" to review flows in the Policy view'
                : 'No open challenges from tax authorities'}
            </Typography>
          </Paper>

          {/* World map */}
          <Box sx={{ mb: 2.5 }}>
            <WorldMap onEntityClick={(e) => navigate(`/entities/${e.id}`)} />
          </Box>

          <EntityTable
            entities={entities}
            visible={tableEntities}
            filterOutOfRange={filterOutOfRange}
            setFilterOutOfRange={setFilterOutOfRange}
          />

          <MarginTrendChart data={monthlyMarginTrend} />
        </Grid>

        {/* Right rail: Alerts */}
        <Grid item xs={12} lg={4}>
          <AlertsRail alerts={alerts} entities={entities} />
        </Grid>
      </Grid>
    </AppShell>
  );
}
