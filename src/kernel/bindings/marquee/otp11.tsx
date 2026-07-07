import { useEffect, useState } from 'react';
import type { FC } from 'react';
import SubmitSuccess from '@/kernel/shell/SubmitSuccess';
import {
  Alert, Box, Button, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';
import type { CsaModel } from '@/shared/api/types';
import type { StepDef } from '@/kernel/registry/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import WorkflowPath from '@/kernel/workflow/WorkflowPath';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import { useGuidedWorkflow } from '@/kernel/workflow/useGuidedWorkflow';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

const signedCurrency = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatCurrency(Math.abs(v), 'USD', true)}`;

/** Alive-guarded fetch of the reconciled CSA model (live from segment_pl). */
function useCsa() {
  const [model, setModel] = useState<CsaModel | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .csa()
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
  { key: 'stage', label: 'Stage batch', actor: 'human' },
  { key: 'post', label: 'Post', actor: 'human', gate: true },
];

const netPayable = (m: CsaModel | null) => (m?.participants ?? []).reduce((s, p) => s + (p.true_up > 0 ? p.true_up : 0), 0);
const payers = (m: CsaModel | null) => (m?.participants ?? []).filter((p) => p.true_up > 0).length;
const receivers = (m: CsaModel | null) => (m?.participants ?? []).filter((p) => p.true_up < 0).length;

const Kpis: FC<BindingCtx> = () => {
  const { model } = useCsa();
  const items: KpiItem[] = [
    { key: 'pool', label: 'Cost pool', value: model ? formatCurrency(model.pool, 'USD', true) : '—', provenance: 'segment_pl · opex_rd' },
    { key: 'net', label: 'Net true-up payable', value: model ? formatCurrency(netPayable(model), 'USD', true) : '—' },
    { key: 'payers', label: 'Payers', value: String(payers(model)), tone: payers(model) ? 'watch' : 'ok' },
    { key: 'recv', label: 'Receivers', value: String(receivers(model)) },
  ];
  return <KpiStrip items={items} />;
};

const TrueUpTable: FC<{ model: CsaModel }> = ({ model }) => (
  <Table size="small">
    <TableHead>
      <TableRow>
        <TableCell>Participant</TableCell>
        <TableCell align="right">Target contribution</TableCell>
        <TableCell align="right">Actual (opex R&amp;D)</TableCell>
        <TableCell align="right">True-up</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {model.participants.map((p) => (
        <TableRow key={p.rbukrs} hover>
          <TableCell sx={{ fontWeight: 700 }}>{p.name}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(p.target_contribution, 'USD', true)}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(p.opex_rd, 'USD', true)}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: p.true_up > 0 ? tokens.risk : p.true_up < 0 ? tokens.ok : 'inherit' }}>
            {signedCurrency(p.true_up)}
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

const Outputs: FC<BindingCtx> = () => {
  const { model, loading } = useCsa();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.participants.length) {
    return <Alert severity="info" variant="outlined">No CSA participants for the period.</Alert>;
  }
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        In-period true-up: each participant&rsquo;s target share of the {formatCurrency(model.pool, 'USD', true)} pool vs its actual R&amp;D
        contribution. A positive true-up is owed (red); negative is received (green). Figures are live from segment_pl.
      </Alert>
      <TrueUpTable model={model} />
    </Stack>
  );
};

const Wizard: FC<BindingCtx> = () => {
  const { model, loading } = useCsa();
  const g = useGuidedWorkflow('OTP-11', 'OTP11-csa-true-up', STEPS);
  const prepared = !!g.wf.payload.prepared;

  if (g.submitted) {
    return (
      <SubmitSuccess
        message="CSA true-up batch posted for review."
        recordRef="OTP11-csa-true-up"
        processId="OTP-11"
      />
    );
  }

  if (loading || !g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.participants.length) {
    return <Alert severity="info" variant="outlined">No CSA participants for the period.</Alert>;
  }

  const net = netPayable(model);
  const key = STEPS[g.wf.stepIndex]?.key;
  const canContinue = key === 'compute' ? prepared : true;

  const renderStep = (step: StepDef) => {
    if (step.key === 'compute') {
      return prepared ? (
        <AgenticHandoffMarker summary={String(g.wf.payload.rbSummary || '')} />
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2">
            The Research Brain computes each participant&rsquo;s target vs actual R&amp;D contribution from segment_pl and
            stages the per-participant true-ups. You review and post.
          </Typography>
          <Box>
            <Button
              variant="contained"
              disabled={g.preparing}
              startIcon={g.preparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void g.prepare({ summary: `Computed CSA true-ups for ${model.participants.length} participants from segment_pl: ${payers(model)} payers / ${receivers(model)} receivers, net payable ${formatCurrency(net, 'USD', true)}. Review and post are yours.` })}
            >
              {g.preparing ? 'Computing…' : 'Compute true-up batch'}
            </Button>
          </Box>
        </Stack>
      );
    }
    if (step.key === 'stage') {
      return (
        <Stack spacing={2}>
          <Alert severity="info" variant="outlined">
            {model.participants.length} staged lines · net true-up payable {formatCurrency(net, 'USD', true)} ({payers(model)} owe / {receivers(model)} receive). Figures are live from segment_pl.
          </Alert>
          <TrueUpTable model={model} />
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <Typography variant="body2">
          Post the CSA true-up batch of <b>{model.participants.length}</b> participants (net payable {formatCurrency(net, 'USD', true)}) for {model.year}.
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

export const otp11: ProcessBinding = { kpis: Kpis, tabs: { overview: Wizard, outputs: Outputs } };
