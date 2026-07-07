import { useEffect, useState } from 'react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import SubmitSuccess from '@/kernel/shell/SubmitSuccess';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import type { TreasuryModel } from '@/shared/api/types';
import type { StepDef } from '@/kernel/registry/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import WorkflowPath from '@/kernel/workflow/WorkflowPath';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import { useGuidedWorkflow } from '@/kernel/workflow/useGuidedWorkflow';
import { useBenchmarkRefreshed, BenchmarkRefreshedChip } from '@/kernel/workflow/benchmarkRefresh';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

/** Alive-guarded fetch of the treasury model (loan register + cash pool). */
function useTreasury() {
  const [model, setModel] = useState<TreasuryModel | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .treasury()
      .then((m) => alive && setModel(m))
      .catch(() => alive && setModel(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  return { model, loading };
}

const FabricatedNote: FC = () => (
  <Alert severity="warning" variant="outlined">
    <b>Fabricated data.</b> The IC loan register and cash-pool positions are illustrative — there is no loan/pool
    source in the warehouse. Magnitudes (~$150M loan principal, ~$50M pool) are sized to be credible for the group
    and every rate sits inside the BM-FIN band. Confirm the scale before relying on these figures.
  </Alert>
);

const STEPS: StepDef[] = [
  { key: 'prepare', label: 'Prepare', actor: 'assistant' },
  { key: 'setRates', label: 'Set spreads', actor: 'human' },
  { key: 'review', label: 'Review & submit', actor: 'human', gate: true },
];

const Kpis: FC<BindingCtx> = () => {
  const { model } = useTreasury();
  const within = model?.totals.loans_within_benchmark ?? 0;
  const n = model?.loans.length ?? 0;
  const items: KpiItem[] = [
    { key: 'n', label: 'IC loans priced', value: String(n) },
    { key: 'w', label: 'Within BM-FIN', value: `${within}/${n}`, tone: n > 0 && within === n ? 'ok' : 'watch' },
    { key: 'p', label: 'Total principal', value: model ? formatCurrency(model.totals.loan_principal, 'USD', true) : '—' },
    { key: 'band', label: 'BM-FIN band', value: model ? `${model.benchmark.lower}–${model.benchmark.upper}%` : '—', provenance: 'BM-FIN · CUP' },
  ];
  return <KpiStrip items={items} />;
};

const RateTable: FC<{ model: TreasuryModel }> = ({ model }) => {
  const navigate = useNavigate();
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Loan</TableCell><TableCell>Borrower</TableCell><TableCell align="right">Principal</TableCell>
          <TableCell>Rating</TableCell><TableCell align="right">Base</TableCell><TableCell align="right">Spread</TableCell>
          <TableCell align="right">All-in</TableCell><TableCell>BM-FIN</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {model.loans.map((ln) => (
          <TableRow key={ln.loan_id} hover>
            <TableCell>{ln.loan_id}</TableCell>
            <TableCell>{ln.borrower_name}</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(ln.principal, ln.currency, true)}</TableCell>
            <TableCell><Chip size="small" label={ln.credit_rating} sx={{ height: 22, fontWeight: 700 }} /></TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{ln.base_rate}%</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>+{ln.credit_spread}%</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{ln.all_in_rate}%</TableCell>
            <TableCell>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Chip size="small" label={ln.within_benchmark ? 'In range' : 'Review'} sx={{ bgcolor: ln.within_benchmark ? '#16A34A' : '#D97706', color: 'white', fontWeight: 700, height: 22 }} />
                <ProvenanceChip source="benchmark" tooltip="Backed by the BM-FIN benchmarking set" onClick={() => navigate('/process/OTP-25/overview')} />
              </Stack>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const Rates: FC<BindingCtx> = () => {
  const { model, loading } = useTreasury();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.loans.length) return <Alert severity="info" variant="outlined">No IC loans to price.</Alert>;
  return (
    <Stack spacing={2}>
      <FabricatedNote />
      <Alert severity="info" variant="outlined">
        Each loan's all-in rate is a risk-free base plus a rating-adjusted credit spread, anchored to the
        BM-FIN {model.benchmark.lower}–{model.benchmark.upper}% CUP band (median {model.benchmark.median}%).
      </Alert>
      <RateTable model={model} />
    </Stack>
  );
};

const Wizard: FC<BindingCtx> = () => {
  const { model, loading } = useTreasury();
  const g = useGuidedWorkflow('OTP-6', 'OTP6-ic-rate-setting', STEPS);
  const benchmarkRefreshed = useBenchmarkRefreshed('OTP6-ic-rate-setting');
  const prepared = !!g.wf.payload.prepared;

  if (g.submitted) {
    return (
      <SubmitSuccess
        message="IC loan / cash-pool rates submitted for review."
        recordRef="OTP6-ic-rate-setting"
        processId="OTP-6"
      />
    );
  }

  if (loading || !g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.loans.length) return <Alert severity="info" variant="outlined">No IC loans to price.</Alert>;

  const within = model.totals.loans_within_benchmark;
  const n = model.loans.length;
  const key = STEPS[g.wf.stepIndex]?.key;
  const canContinue = key === 'prepare' ? prepared : true;

  const renderStep = (step: StepDef) => {
    if (step.key === 'prepare') {
      return prepared ? (
        <AgenticHandoffMarker summary={String(g.wf.payload.rbSummary || '')} />
      ) : (
        <Stack spacing={2}>
          <FabricatedNote />
          <Typography variant="body2">
            The Research Brain pulls each borrower's credit rating, applies the rating-adjusted credit spread over the
            risk-free base, and checks the all-in rate against the BM-FIN {model.benchmark.lower}–{model.benchmark.upper}% band.
            The rate decision is yours.
          </Typography>
          <Box>
            <Button
              variant="contained"
              disabled={g.preparing}
              startIcon={g.preparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void g.prepare({ summary: `Priced ${n} IC loans (${formatCurrency(model.totals.loan_principal, 'USD', true)} principal) with rating-adjusted spreads; ${within}/${n} sit inside the BM-FIN ${model.benchmark.lower}–${model.benchmark.upper}% band. Review and submit are yours.` })}
            >
              {g.preparing ? 'Preparing…' : 'Run Research Brain preparation'}
            </Button>
          </Box>
        </Stack>
      );
    }
    if (step.key === 'setRates') {
      return (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2">BM-FIN band <b>{model.benchmark.lower}–{model.benchmark.upper}%</b> (median {model.benchmark.median}%)</Typography>
            {benchmarkRefreshed && <BenchmarkRefreshedChip wizardRoute="/process/OTP-6/overview" />}
          </Stack>
          <Alert severity={within === n ? 'success' : 'warning'} variant="outlined">
            {within === n
              ? `All ${n} loans in range — defensible against the BM-FIN ${model.benchmark.lower}–${model.benchmark.upper}% band.`
              : `${n - within} of ${n} loans outside the BM-FIN band — expect scrutiny; document the basis.`}
          </Alert>
          <RateTable model={model} />
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <Typography variant="body2">
          Set the rating-adjusted rates on <b>{n}</b> IC loans ({formatCurrency(model.totals.loan_principal, 'USD', true)} principal,
          {' '}{within}/{n} within BM-FIN). Submitting routes them to maker-checker review.
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

export const otp6: ProcessBinding = { kpis: Kpis, tabs: { overview: Wizard, inputs: Rates } };
