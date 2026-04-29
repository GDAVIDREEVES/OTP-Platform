import { useMemo, useState } from 'react';
import { Box, Grid, Stack } from '@mui/material';
import { useBerryTrend } from '@/shared/hooks/useBerryTrend';
import { useEntities } from '@/shared/providers/DataProvider';
import { formatCurrency } from '@/shared/utils/format';
import PricingKpiCard from './components/PricingKpiCard';
import MonthlyBerryChart from './components/MonthlyBerryChart';
import VarianceRow from './components/VarianceRow';
import MarkupComparisonTable from './components/MarkupComparisonTable';

export default function ProductPricing() {
  const entities = useEntities();
  // Berry analysis is most meaningful for distributors and toll mfrs; default to UK LRD
  const defaultEntity = useMemo(
    () => (entities.find((e) => e.id === '3300') ? '3300' : entities[0]?.id),
    [entities],
  );
  const [entityId, setEntityId] = useState<string>(defaultEntity ?? '3300');
  const trend = useBerryTrend({ entity: entityId });

  // YTD aggregates derived from the live monthly trend
  const totals = useMemo(() => {
    if (!trend.data || trend.data.length === 0)
      return { revenue: 0, gp: 0, opex: 0, avgBerry: 0, target: 1.2 };
    const revenue = trend.data.reduce((a, r) => a + r.revenue, 0);
    const gp = trend.data.reduce((a, r) => a + r.gp, 0);
    const opex = trend.data.reduce((a, r) => a + r.opex, 0);
    const avgBerry = opex > 0 ? gp / opex : 0;
    const target = trend.data[0].target;
    return { revenue, gp, opex, avgBerry, target };
  }, [trend.data]);

  const selectedEntity = entities.find((e) => e.id === entityId);
  const currency = selectedEntity?.currency ?? 'USD';
  const variance = totals.avgBerry - totals.target;

  return (
    <Box>
      {/* Top row: KPIs + Monthly chart */}
      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        <Grid item xs={12} md={3}>
          <Stack spacing={2}>
            <PricingKpiCard
              label="YTD Revenue"
              subtitle={`${selectedEntity?.id ?? ''} — ${currency}`}
              value={formatCurrency(totals.revenue, currency, true)}
              delta={
                trend.loading ? '…' : `${(totals.revenue / 1e6).toFixed(1)}M`
              }
            />
            <PricingKpiCard
              label="Gross Profit (rev − COGS − IC)"
              subtitle={currency}
              value={formatCurrency(totals.gp, currency, true)}
              delta={
                totals.revenue > 0
                  ? `${((totals.gp / totals.revenue) * 100).toFixed(1)}% of rev`
                  : '—'
              }
            />
            <PricingKpiCard
              label="OpEx (S,G&A)"
              subtitle={currency}
              value={formatCurrency(totals.opex, currency, true)}
              delta={
                totals.revenue > 0
                  ? `${((totals.opex / totals.revenue) * 100).toFixed(1)}% of rev`
                  : '—'
              }
            />
            <PricingKpiCard
              label="YTD Berry ratio"
              subtitle={`Target ${totals.target.toFixed(2)}`}
              value={totals.avgBerry.toFixed(2)}
              delta={
                trend.loading
                  ? '…'
                  : `${variance >= 0 ? '+' : ''}${variance.toFixed(2)} vs target`
              }
            />
          </Stack>
        </Grid>
        <Grid item xs={12} md={9}>
          <MonthlyBerryChart
            trend={trend}
            entities={entities}
            entityId={entityId}
            setEntityId={setEntityId}
            currency={currency}
            targetBerry={totals.target}
          />
        </Grid>
      </Grid>

      <VarianceRow />

      <MarkupComparisonTable />
    </Box>
  );
}
