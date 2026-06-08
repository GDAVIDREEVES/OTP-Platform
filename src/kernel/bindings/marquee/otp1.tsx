import { useEffect, useState } from 'react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
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

/** OTP-1 sets beginning-of-year goods prices; OTP-2 reuses this binding to
 *  reset them in-period. The framing differs (BOY vs reset) but both set the
 *  same goods cost-plus / resale markups, live from /api/transactions/pricing. */
const isReset = (def: BindingCtx['def']) => def.id === 'OTP-2';

/** Alive-guarded fetch of the settable goods price rows (FG/SEMI/RAW), tested
 *  against the limited-risk-distributor (BM-LRD) and toll-manufacturer (BM-TOLL)
 *  bands. */
function useGoodsPricing() {
  const [rows, setRows] = useState<PricingRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .pricing()
      .then((all) => alive && setRows(all.filter((r) => r.transactionType === 'goods')))
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
  { key: 'review', label: 'Review prices', actor: 'human' },
  { key: 'set', label: 'Set & submit', actor: 'human', gate: true },
];

const totalPrice = (rows: PricingRow[]) => rows.reduce((s, r) => s + r.totalLegalPrice, 0);
const outOfBand = (rows: PricingRow[]) => rows.filter((r) => !r.withinBenchmark).length;
const bandIds = (rows: PricingRow[]) => Array.from(new Set(rows.map((r) => r.benchmarkId))).join(' / ');

const Kpis: FC<BindingCtx> = ({ def }) => {
  const { rows } = useGoodsPricing();
  const list = rows ?? [];
  const items: KpiItem[] = [
    { key: 'n', label: isReset(def) ? 'Prices to reset' : 'Goods prices', value: String(list.length) },
    { key: 'v', label: 'Legal price (YTD)', value: list.length ? formatCurrency(totalPrice(list), 'USD', true) : '—', provenance: 'supply_chain · TOTAL_LEGAL_PRICE' },
    { key: 'b', label: 'Benchmarks', value: list.length ? bandIds(list) : '—', hint: 'BM-LRD · BM-TOLL' },
    { key: 'o', label: 'Outside band', value: String(outOfBand(list)), tone: outOfBand(list) ? 'risk' : 'ok' },
  ];
  return <KpiStrip items={items} />;
};

const PriceTable: FC<{ rows: PricingRow[] }> = ({ rows }) => (
  <Table size="small">
    <TableHead>
      <TableRow>
        <TableCell>Material</TableCell>
        <TableCell>Entity pair</TableCell>
        <TableCell align="right">Standard cost</TableCell>
        <TableCell align="right">Markup</TableCell>
        <TableCell align="right">Legal price</TableCell>
        <TableCell>Method</TableCell>
        <TableCell align="right">Benchmark</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {rows.map((r) => (
        <TableRow key={r.id} hover>
          <TableCell sx={{ fontWeight: 700 }}>{r.matnr || r.chainId}</TableCell>
          <TableCell sx={{ color: 'text.secondary' }}>{r.seller} → {r.buyer}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.standardCost, 'USD')}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{pct(r.markupRate)}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.totalLegalPrice, 'USD', true)}</TableCell>
          <TableCell>{r.tpMethod}</TableCell>
          <TableCell align="right">
            <Chip
              size="small"
              label={r.withinBenchmark ? r.benchmarkId : 'Out of range'}
              sx={{ bgcolor: r.withinBenchmark ? '#16A34A' : '#DC2626', color: 'white', fontWeight: 700 }}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

const Review: FC<BindingCtx> = () => {
  const { rows, loading } = useGoodsPricing();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!rows || !rows.length) return <Alert severity="info" variant="outlined">No goods price rows for the period.</Alert>;
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Goods markups (cost-plus / resale) are computed live from supply_chain and tested against the
        limited-risk distributor (BM-LRD) and toll-manufacturer (BM-TOLL) bands per the TP method on each chain.
      </Alert>
      <PriceTable rows={rows} />
    </Stack>
  );
};

const Wizard: FC<BindingCtx> = ({ def }) => {
  const navigate = useNavigate();
  const reset = isReset(def);
  const { rows, loading } = useGoodsPricing();
  const recordRef = reset ? 'OTP2-goods-reset' : 'OTP1-goods-boy';
  const g = useGuidedWorkflow(def.id, recordRef, STEPS);
  const prepared = !!g.wf.payload.prepared;
  const list = rows ?? [];
  const flagged = outOfBand(list);
  const noun = reset ? 'in-period price reset' : 'beginning-of-year goods prices';

  if (g.submitted) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        <Alert icon={<CheckCircleIcon />} severity="success">
          {reset ? 'In-period goods price reset' : 'Beginning-of-year goods prices'} submitted for review.
        </Alert>
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" onClick={() => navigate(`/evidence/${encodeURIComponent(recordRef)}`)}>Evidence packet</Button>
          <Button variant="outlined" onClick={() => navigate('/review')}>Open review queue</Button>
        </Stack>
      </Stack>
    );
  }

  if (loading || !g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!list.length) return <Alert severity="info" variant="outlined">No goods price rows for the period.</Alert>;

  const key = STEPS[g.wf.stepIndex]?.key;
  const canContinue = key === 'prepare' ? prepared : true;

  const renderStep = (step: StepDef) => {
    if (step.key === 'prepare') {
      return prepared ? (
        <AgenticHandoffMarker summary={String(g.wf.payload.rbSummary || '')} />
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2">
            The Research Brain pulls each goods chain from supply_chain, recomputes the cost-plus / resale
            markup and resulting legal price, and tests each against its benchmarking band
            {reset ? ' to flag where in-period drift has pushed a price outside the range' : ''} — then
            hands the {noun} decision to you.
          </Typography>
          <Box>
            <Button
              variant="contained"
              disabled={g.preparing}
              startIcon={g.preparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void g.prepare({ summary: `Recomputed ${noun} for ${list.length} goods chains (legal price ${formatCurrency(totalPrice(list), 'USD', true)}) against ${bandIds(list)}; ${flagged} outside the band. Review and submit are yours.` })}
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
            {list.length} goods chains · legal price {formatCurrency(totalPrice(list), 'USD', true)} · {flagged} outside band ({bandIds(list)}). Prices are live from supply_chain.
          </Alert>
          <PriceTable rows={list} />
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <Typography variant="body2">
          {reset
            ? `Reset the ${list.length} goods prices that have drifted in-period back into their benchmarking bands (${bandIds(list)}).`
            : `Set the beginning-of-year prices for ${list.length} goods chains against their benchmarking bands (${bandIds(list)}).`}
          {' '}Submitting routes them to maker-checker review.
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

export const otp1: ProcessBinding = { kpis: Kpis, tabs: { overview: Wizard, inputs: Review } };
