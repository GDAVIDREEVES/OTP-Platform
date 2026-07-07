import { useEffect, useState } from 'react';
import type { FC } from 'react';
import SubmitSuccess from '@/kernel/shell/SubmitSuccess';
import {
  Alert, Box, Button, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import type { PricingRow } from '@/shared/api/types';
import type { StepDef } from '@/kernel/registry/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import WorkflowPath from '@/kernel/workflow/WorkflowPath';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import { useGuidedWorkflow } from '@/kernel/workflow/useGuidedWorkflow';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

const pct = (x: number) => `${x.toFixed(2)}%`;

/** Alive-guarded fetch of the settable price rows, narrowed to SERVICE rows
 *  (OTP-4 sets intra-group service cost-plus markups against BM-SVC). All
 *  figures are live from /api/transactions/pricing. */
function useServicePricing() {
  const [rows, setRows] = useState<PricingRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .pricing()
      .then((all) => alive && setRows(all.filter((r) => r.transactionType === 'service')))
      .catch(() => alive && setRows(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  return { rows, loading };
}

const STEPS: StepDef[] = [
  { key: 'prepare', label: 'Prepare', actor: 'assistant' },
  { key: 'review', label: 'Review markups', actor: 'human' },
  { key: 'set', label: 'Set & submit', actor: 'human', gate: true },
];

const totalPrice = (rows: PricingRow[]) => rows.reduce((s, r) => s + r.totalLegalPrice, 0);
const outOfBand = (rows: PricingRow[]) => rows.filter((r) => !r.withinBenchmark).length;

const Kpis: FC<BindingCtx> = () => {
  const { rows } = useServicePricing();
  const list = rows ?? [];
  const band = list[0]?.benchmarkRange ?? '—';
  const items: KpiItem[] = [
    { key: 'n', label: 'Service charges', value: String(list.length) },
    { key: 'v', label: 'Legal price (YTD)', value: list.length ? formatCurrency(totalPrice(list), 'USD', true) : '—', provenance: 'supply_chain · TOTAL_LEGAL_PRICE' },
    { key: 'b', label: 'BM-SVC band', value: band, hint: 'net cost-plus' },
    { key: 'o', label: 'Outside band', value: String(outOfBand(list)), tone: outOfBand(list) ? 'risk' : 'ok' },
  ];
  return <KpiStrip items={items} />;
};

const PriceTable: FC<{ rows: PricingRow[] }> = ({ rows }) => (
  <Table size="small">
    <TableHead>
      <TableRow>
        <TableCell>Service charge</TableCell>
        <TableCell>Entity pair</TableCell>
        <TableCell align="right">Standard cost</TableCell>
        <TableCell align="right">Markup</TableCell>
        <TableCell align="right">Legal price</TableCell>
        <TableCell>Method</TableCell>
        <TableCell align="right">vs BM-SVC</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {rows.map((r) => (
        <TableRow key={r.id} hover>
          <TableCell sx={{ fontWeight: 700 }}>{r.chainId}</TableCell>
          <TableCell sx={{ color: 'text.secondary' }}>{r.seller} → {r.buyer}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.standardCost, 'USD')}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{pct(r.markupRate)}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.totalLegalPrice, 'USD', true)}</TableCell>
          <TableCell>{r.tpMethod}</TableCell>
          <TableCell align="right">
            <Chip
              size="small"
              label={r.withinBenchmark ? `${r.benchmarkRange}` : 'Out of range'}
              sx={{ bgcolor: r.withinBenchmark ? '#16A34A' : '#DC2626', color: 'white', fontWeight: 700 }}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

const Review: FC<BindingCtx> = () => {
  const { rows, loading } = useServicePricing();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!rows || !rows.length) return <Alert severity="info" variant="outlined">No intra-group service charges for the period.</Alert>;
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Cost-plus markups are computed live from supply_chain (standard cost × markup → legal price) and
        tested against the {rows[0].benchmarkLabel} band ({rows[0].benchmarkRange}, median {pct(rows[0].benchmarkMedian)}).
      </Alert>
      <PriceTable rows={rows} />
    </Stack>
  );
};

const Wizard: FC<BindingCtx> = () => {
  const { rows, loading } = useServicePricing();
  const g = useGuidedWorkflow('OTP-4', 'OTP4-service-cost-plus', STEPS);
  const prepared = !!g.wf.payload.prepared;
  const list = rows ?? [];
  const flagged = outOfBand(list);

  if (g.submitted) {
    return (
      <SubmitSuccess
        message="Service cost-plus markups submitted for review."
        recordRef="OTP4-service-cost-plus"
        processId="OTP-4"
      />
    );
  }

  if (loading || !g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!list.length) return <Alert severity="info" variant="outlined">No intra-group service charges for the period.</Alert>;

  const key = STEPS[g.wf.stepIndex]?.key;
  const canContinue = key === 'prepare' ? prepared : true;

  const renderStep = (step: StepDef) => {
    if (step.key === 'prepare') {
      return prepared ? (
        <AgenticHandoffMarker summary={String(g.wf.payload.rbSummary || '')} />
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2">
            The Research Brain pulls each intra-group service charge from supply_chain, recomputes the
            net cost-plus markup, and tests it against the {list[0].benchmarkLabel} band — then hands the
            setting decision to you.
          </Typography>
          <Box>
            <Button
              variant="contained"
              disabled={g.preparing}
              startIcon={g.preparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void g.prepare({ summary: `Recomputed cost-plus markups for ${list.length} service charges (legal price ${formatCurrency(totalPrice(list), 'USD', true)}) against ${list[0].benchmarkLabel} (${list[0].benchmarkRange}); ${flagged} outside the band. Review and submit are yours.` })}
            >
              {g.preparing ? 'Preparing…' : 'Run Research Brain preparation'}
            </Button>
          </Box>
        </Stack>
      );
    }
    if (step.key === 'review') {
      return (
        <Stack spacing={2}>
          <Alert severity={flagged ? 'warning' : 'info'} variant="outlined">
            {list.length} service charges · legal price {formatCurrency(totalPrice(list), 'USD', true)} · {flagged} outside the {list[0].benchmarkRange} band. Markups are live from supply_chain.
          </Alert>
          <PriceTable rows={list} />
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <Typography variant="body2">
          Set the cost-plus markups for {list.length} intra-group service charges against
          {' '}{list[0].benchmarkLabel} (median {pct(list[0].benchmarkMedian)}). Submitting routes them to
          maker-checker review.
        </Typography>
      </Stack>
    );
  };

  return (
    <WorkflowPath
      steps={STEPS}
      stepIndex={g.wf.stepIndex}
      setStepIndex={g.wf.setStepIndex}
      canContinue={canContinue}
      onComplete={() => void g.submit()}
      completing={g.submitting}
      renderStep={renderStep}
      lastSavedAt={g.wf.lastSavedAt}
    />
  );
};

export const otp4: ProcessBinding = { kpis: Kpis, tabs: { overview: Wizard, inputs: Review } };
