import { useEffect, useState } from 'react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';
import type { ProfitSplitModel } from '@/shared/api/types';
import type { StepDef } from '@/kernel/registry/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import WorkflowPath from '@/kernel/workflow/WorkflowPath';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import { useGuidedWorkflow } from '@/kernel/workflow/useGuidedWorkflow';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

const signedCurrency = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatCurrency(Math.abs(v), 'USD', true)}`;

/** Alive-guarded fetch of the reconciled profit-split model (default R&D key, live from segment_pl). */
function useProfitSplit() {
  const [model, setModel] = useState<ProfitSplitModel | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .profitSplit()
      .then((m) => alive && setModel(m))
      .catch(() => alive && setModel(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  return { model, loading };
}

const STEPS: StepDef[] = [
  { key: 'compute', label: 'Compute', actor: 'assistant' },
  { key: 'stage', label: 'Stage invoices', actor: 'human' },
  { key: 'post', label: 'Post', actor: 'human', gate: true },
];

// A positive true-up means the party is allocated more residual than its own
// operating profit — it receives a balancing invoice; negative parties pay.
const receivable = (m: ProfitSplitModel | null) => (m?.participants ?? []).reduce((s, p) => s + (p.true_up > 0 ? p.true_up : 0), 0);
const receivers = (m: ProfitSplitModel | null) => (m?.participants ?? []).filter((p) => p.true_up > 0).length;
const payers = (m: ProfitSplitModel | null) => (m?.participants ?? []).filter((p) => p.true_up < 0).length;

const Kpis: FC<BindingCtx> = () => {
  const { model } = useProfitSplit();
  const items: KpiItem[] = [
    { key: 'combined', label: 'Combined profit', value: model ? formatCurrency(model.combined_profit, 'USD', true) : '—', provenance: 'segment_pl · operating_profit' },
    { key: 'bal', label: 'Balancing invoices', value: model ? formatCurrency(receivable(model), 'USD', true) : '—' },
    { key: 'recv', label: 'Receivers', value: String(receivers(model)), tone: receivers(model) ? 'watch' : 'ok' },
    { key: 'pay', label: 'Payers', value: String(payers(model)) },
  ];
  return <KpiStrip items={items} />;
};

const TrueUpTable: FC<{ model: ProfitSplitModel }> = ({ model }) => (
  <Table size="small">
    <TableHead>
      <TableRow>
        <TableCell>Participant</TableCell>
        <TableCell align="right">Allocated (PSM)</TableCell>
        <TableCell align="right">Actual (operating profit)</TableCell>
        <TableCell align="right">Balancing true-up</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {model.participants.map((p) => (
        <TableRow key={p.rbukrs} hover>
          <TableCell sx={{ fontWeight: 700 }}>{p.name}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(p.allocated_profit, 'USD', true)}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(p.operating_profit, 'USD', true)}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: p.true_up > 0 ? tokens.ok : p.true_up < 0 ? tokens.risk : 'inherit' }}>
            {signedCurrency(p.true_up)}
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

const Outputs: FC<BindingCtx> = () => {
  const { model, loading } = useProfitSplit();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.participants.length) {
    return <Alert severity="info" variant="outlined">No profit-split participants for the period.</Alert>;
  }
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        PSM invoicing: each party&rsquo;s allocated residual (R&amp;D key) vs its actual operating profit. A positive true-up is
        received via a balancing invoice (green); negative is paid (red). Figures are live from segment_pl.
      </Alert>
      <TrueUpTable model={model} />
    </Stack>
  );
};

const Wizard: FC<BindingCtx> = () => {
  const navigate = useNavigate();
  const { model, loading } = useProfitSplit();
  const g = useGuidedWorkflow('OTP-12', 'OTP12-psm-true-up', STEPS);
  const prepared = !!g.wf.payload.prepared;

  if (g.submitted) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        <Alert icon={<CheckCircleIcon />} severity="success">PSM balancing invoices posted for review.</Alert>
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" onClick={() => navigate(`/evidence/${encodeURIComponent('OTP12-psm-true-up')}`)}>Evidence packet</Button>
          <Button variant="outlined" onClick={() => navigate('/review')}>Open review queue</Button>
        </Stack>
      </Stack>
    );
  }

  if (loading || !g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.participants.length) {
    return <Alert severity="info" variant="outlined">No profit-split participants for the period.</Alert>;
  }

  const bal = receivable(model);
  const key = STEPS[g.wf.stepIndex]?.key;
  const canContinue = key === 'compute' ? prepared : true;

  const renderStep = (step: StepDef) => {
    if (step.key === 'compute') {
      return prepared ? (
        <AgenticHandoffMarker summary={String(g.wf.payload.rbSummary || '')} />
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2">
            The Research Brain runs the profit-split (R&amp;D key) over segment_pl, allocates the
            {' '}{formatCurrency(model.combined_profit, 'USD', true)} combined residual, and stages a balancing invoice per party
            (allocated vs actual). You review and post.
          </Typography>
          <Box>
            <Button
              variant="contained"
              disabled={g.preparing}
              startIcon={g.preparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void g.prepare({ summary: `Computed PSM allocation for ${model.participants.length} non-routine parties from segment_pl (R&D key): combined residual ${formatCurrency(model.combined_profit, 'USD', true)}, ${receivers(model)} receive / ${payers(model)} pay, balancing invoices ${formatCurrency(bal, 'USD', true)}. Review and post are yours.` })}
            >
              {g.preparing ? 'Computing…' : 'Compute balancing invoices'}
            </Button>
          </Box>
        </Stack>
      );
    }
    if (step.key === 'stage') {
      return (
        <Stack spacing={2}>
          <Alert severity="info" variant="outlined">
            {model.participants.length} staged invoice lines · balancing invoices {formatCurrency(bal, 'USD', true)} ({receivers(model)} receive / {payers(model)} pay). Figures are live from segment_pl.
          </Alert>
          <TrueUpTable model={model} />
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <Typography variant="body2">
          Post the PSM balancing-invoice batch across <b>{model.participants.length}</b> parties (gross {formatCurrency(bal, 'USD', true)}) for {model.year}.
          A reviewer signs off before it commits.
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

export const otp12: ProcessBinding = { kpis: Kpis, tabs: { overview: Wizard, outputs: Outputs } };
