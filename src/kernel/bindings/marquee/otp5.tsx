import { useEffect, useState } from 'react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import type { CsaModel } from '@/shared/api/types';
import type { StepDef } from '@/kernel/registry/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import WorkflowPath from '@/kernel/workflow/WorkflowPath';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import { useGuidedWorkflow } from '@/kernel/workflow/useGuidedWorkflow';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

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
  { key: 'prepare', label: 'Prepare', actor: 'assistant' },
  { key: 'review', label: 'Review shares', actor: 'human' },
  { key: 'set', label: 'Set & submit', actor: 'human', gate: true },
];

const Kpis: FC<BindingCtx> = () => {
  const { model } = useCsa();
  const participants = model?.participants ?? [];
  const topRab = participants.reduce((m, p) => Math.max(m, p.rab_share), 0);
  const pctOutstanding = participants.reduce((s, p) => s + p.pct_buyin, 0);
  const items: KpiItem[] = [
    { key: 'pool', label: 'Cost pool', value: model ? formatCurrency(model.pool, 'USD', true) : '—', provenance: 'segment_pl · opex_rd' },
    { key: 'n', label: 'Participants', value: String(participants.length) },
    { key: 'rab', label: 'Top RAB share', value: model ? pct(topRab) : '—' },
    { key: 'pct', label: 'PCT outstanding', value: model ? formatCurrency(pctOutstanding, 'USD', true) : '—' },
  ];
  return <KpiStrip items={items} />;
};

const ShareTable: FC<{ model: CsaModel }> = ({ model }) => (
  <Table size="small">
    <TableHead>
      <TableRow>
        <TableCell>Participant</TableCell>
        <TableCell align="right">Projected sales</TableCell>
        <TableCell align="right">RAB share</TableCell>
        <TableCell align="right">Target contribution</TableCell>
        <TableCell align="right">PCT buy-in</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {model.participants.map((p) => (
        <TableRow key={p.rbukrs} hover>
          <TableCell sx={{ fontWeight: 700 }}>{p.name}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(p.projected_sales, 'USD', true)}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{pct(p.rab_share)}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(p.target_contribution, 'USD', true)}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(p.pct_buyin, 'USD', true)}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

const Shares: FC<BindingCtx> = () => {
  const { model, loading } = useCsa();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.participants.length) {
    return <Alert severity="info" variant="outlined">No CSA participants for the period.</Alert>;
  }
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        RAB shares are projected-sales weighted (g={pct(model.growth)}); PCT buy-ins value the platform at
        {' '}{model.pct_mult}× the pool. Figures are live from segment_pl — they reconcile with OTP-21 segmented financials.
      </Alert>
      <ShareTable model={model} />
    </Stack>
  );
};

const Wizard: FC<BindingCtx> = () => {
  const navigate = useNavigate();
  const { model, loading } = useCsa();
  const g = useGuidedWorkflow('OTP-5', 'OTP5-csa-rab-pct', STEPS);
  const prepared = !!g.wf.payload.prepared;
  const topRab = (model?.participants ?? []).reduce((m, p) => Math.max(m, p.rab_share), 0);
  const pctOutstanding = (model?.participants ?? []).reduce((s, p) => s + p.pct_buyin, 0);

  if (g.submitted) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        <Alert icon={<CheckCircleIcon />} severity="success">CSA RAB shares & PCT buy-ins submitted for review.</Alert>
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" onClick={() => navigate(`/evidence/${encodeURIComponent('OTP5-csa-rab-pct')}`)}>Evidence packet</Button>
          <Button variant="outlined" onClick={() => navigate('/review')}>Open review queue</Button>
        </Stack>
      </Stack>
    );
  }

  if (loading || !g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.participants.length) {
    return <Alert severity="info" variant="outlined">No CSA participants for the period.</Alert>;
  }

  const key = STEPS[g.wf.stepIndex]?.key;
  const canContinue = key === 'prepare' ? prepared : true;

  const renderStep = (step: StepDef) => {
    if (step.key === 'prepare') {
      return prepared ? (
        <AgenticHandoffMarker summary={String(g.wf.payload.rbSummary || '')} />
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2">
            The Research Brain pulls each participant&rsquo;s projected sales from segment_pl, computes RAB shares
            and the {model.pct_mult}× PCT buy-ins, then hands the setting decision to you.
          </Typography>
          <Box>
            <Button
              variant="contained"
              disabled={g.preparing}
              startIcon={g.preparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void g.prepare({ summary: `Computed RAB shares from projected sales for ${model.participants.length} participants (pool ${formatCurrency(model.pool, 'USD', true)}, top share ${pct(topRab)}); PCT buy-ins total ${formatCurrency(pctOutstanding, 'USD', true)}. Review and submit are yours.` })}
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
          <Alert severity="info" variant="outlined">
            {model.participants.length} participants · pool {formatCurrency(model.pool, 'USD', true)} · PCT outstanding {formatCurrency(pctOutstanding, 'USD', true)}. Shares are live from segment_pl.
          </Alert>
          <ShareTable model={model} />
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <Typography variant="body2">
          Set the CSA RAB shares (top {pct(topRab)}) and {model.pct_mult}× PCT buy-ins ({formatCurrency(pctOutstanding, 'USD', true)}) for {model.year}.
          Submitting routes them to maker-checker review.
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

export const otp5: ProcessBinding = { kpis: Kpis, tabs: { overview: Wizard, inputs: Shares } };
