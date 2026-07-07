import { useState } from 'react';
import type { FC } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import SubmitSuccess from '@/kernel/shell/SubmitSuccess';
import { useEntities, useEntity, useToast } from '@/shared/providers/DataProvider';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useRefreshSignals } from '@/shared/providers/WorkSignalsProvider';
import { useReviewHandoff } from '@/kernel/review/ReviewHandoff';
import { api } from '@/shared/api/client';
import { statusColor, statusLabel } from '@/shared/utils/status';
import { formatCurrency } from '@/shared/utils/format';
import type { Entity } from '@/shared/types/entity';
import type { StepDef } from '@/kernel/registry/types';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import BasisBadge from '@/shared/components/BasisBadge';
import { useWorkflowState } from '@/kernel/workflow/useWorkflowState';
import WorkflowPath from '@/kernel/workflow/WorkflowPath';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';

const STEPS: StepDef[] = [
  { key: 'prepare', label: 'Prepare', actor: 'assistant', description: 'Research Brain pulls postings, applies policy, quantifies the gap' },
  { key: 'quantify', label: 'Quantify', actor: 'human', description: 'Choose the adjustment basis' },
  { key: 'review', label: 'Review & post', actor: 'human', gate: true, description: 'Confirm, capture rationale, submit for review' },
];

const pct = (n: number) => `${n.toFixed(2)}%`;

interface Calc {
  median: number;
  actual: number;
  revenue: number;
  ccy: string;
  amtMedian: number;
  amtEdge: number;
}
function calcFor(e: Entity): Calc {
  const median = (e.targetMarginLow + e.targetMarginHigh) / 2;
  const actual = e.actualMargin ?? 0;
  const revenue = e.ytdVolume;
  return {
    median,
    actual,
    revenue,
    ccy: e.currency || 'USD',
    amtMedian: ((median - actual) / 100) * revenue,
    amtEdge: e.variance ? (-e.variance / 100) * revenue : 0,
  };
}

// ---------------- KPI strip ----------------

const Kpis: FC<BindingCtx> = () => {
  const [sp] = useSearchParams();
  const entity = useEntity(sp.get('entity') || undefined);
  if (!entity) return null;
  const c = calcFor(entity);
  const items: KpiItem[] = [
    { key: 'm', label: 'Current margin', value: pct(c.actual), tone: entity.status === 'out-of-range' ? 'risk' : entity.status === 'watch' ? 'watch' : 'ok' },
    { key: 't', label: 'Target band', value: entity.targetMarginLabel },
    { key: 'g', label: 'Gap to range', value: entity.variance ? `${entity.variance > 0 ? '+' : ''}${entity.variance.toFixed(1)}pp` : '—', tone: 'watch' },
    { key: 'a', label: 'To median', value: formatCurrency(c.amtMedian, c.ccy, true), hint: 'profit adjustment' },
  ];
  return <KpiStrip items={items} />;
};

// ---------------- entity picker (no entity selected) ----------------

function Picker() {
  const navigate = useNavigate();
  const flagged = useEntities().filter((e) => e.status === 'out-of-range' || e.status === 'watch');
  return (
    <Stack spacing={2} sx={{ maxWidth: 760 }}>
      <Alert severity="info" variant="outlined">
        Pick a flagged tested party to start an in-period adjustment, or arrive here from a flag in
        OTP-20 monitoring (the gap to range is carried over).
      </Alert>
      {flagged.map((e) => (
        <Stack key={e.id} direction="row" alignItems="center" spacing={1.5} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Chip size="small" label={statusLabel[e.status]} sx={{ bgcolor: statusColor[e.status], color: 'white', fontWeight: 700 }} />
          <Typography variant="body2" sx={{ flex: 1, fontWeight: 700 }}>
            {e.name}{' '}
            <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>
              · {pct(e.actualMargin ?? 0)} vs {e.targetMarginLabel}
            </Typography>
          </Typography>
          <Button size="small" variant="outlined" onClick={() => navigate(`/process/OTP-16/overview?entity=${e.id}`)}>
            Start adjustment
          </Button>
        </Stack>
      ))}
    </Stack>
  );
};

// ---------------- the guided adjustment ----------------

function Adjustment({ entityId }: { entityId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const user = useSessionUser();
  const refreshSignals = useRefreshSignals();
  const { notifySubmitted } = useReviewHandoff();
  const entity = useEntity(entityId);
  const recordRef = `OTP16-${entityId}`;
  const wf = useWorkflowState('OTP-16', recordRef, user.id, STEPS);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);

  if (!entity) {
    return (
      <Alert severity="warning" action={<Button onClick={() => navigate('/process/OTP-16/overview')}>Pick entity</Button>}>
        Entity {entityId} not found.
      </Alert>
    );
  }

  const c = calcFor(entity);
  const mode = (wf.payload.mode as string) || 'median';
  const customAmount = Number(wf.payload.customAmount ?? c.amtMedian);
  const amount = mode === 'median' ? c.amtMedian : mode === 'edge' ? c.amtEdge : customAmount;
  const resultMargin = c.actual + (amount / c.revenue) * 100;
  const rationale = String(wf.payload.rationale || '');
  const prepared = !!wf.payload.prepared;

  if (submitted) {
    return (
      <SubmitSuccess
        message={
          <>
            Adjustment <b>{submitted}</b> submitted for review. It now awaits a second set of eyes — a
            maker can&rsquo;t approve their own work.
          </>
        }
        recordRef={`adj:${submitted}`}
        processId="OTP-16"
        backTo={{ label: 'Back to monitoring', path: '/process/OTP-20/worklist' }}
      />
    );
  }

  const runPrepare = async () => {
    setPreparing(true);
    try {
      const res = await api.researchBrainPrepare({ process_id: 'OTP-16', record_ref: recordRef, entity_id: entityId });
      const patch: Record<string, unknown> = { prepared: true, rbSummary: res.summary };
      if (res.draftPatch) {
        patch.mode = res.draftPatch.mode; // the AI chose the basis…
        patch.aiAmount = res.draftPatch.amount; // …and computed the amount from real postings
      }
      wf.patchPayload(patch);
    } catch (e) {
      toast.show(`Prep failed: ${String(e)}`, 'error');
    } finally {
      setPreparing(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const adj = await api.submitAdjustment({
        entityId,
        entityName: entity.name,
        amount,
        currency: c.ccy,
        mode: mode === 'edge' ? 'custom' : (mode as 'median' | 'upper' | 'custom'),
        targetMargin: c.median,
        actualMargin: c.actual,
        submittedBy: user.id,
        notes: rationale,
      });
      await api.enqueueReview({ process_id: 'OTP-16', record_ref: `adj:${adj.id}`, maker: user.id });
      await wf.clearDraft();
      setSubmitted(adj.id);
      void refreshSignals(); // bell badge / home Command Center / My work
      notifySubmitted({
        recordRef: `adj:${adj.id}`,
        processId: 'OTP-16',
        label: `Adjustment ${adj.id} — ${entity.name}`,
      });
    } catch (e) {
      toast.show(`Submit failed: ${String(e)}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const canContinue =
    STEPS[wf.stepIndex]?.key === 'prepare' ? prepared : STEPS[wf.stepIndex]?.key === 'review' ? rationale.trim().length > 0 : true;

  const renderStep = (step: StepDef) => {
    if (step.key === 'prepare') {
      return prepared ? (
        <AgenticHandoffMarker summary={String(wf.payload.rbSummary || '')} />
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2">
            The Research Brain will agentically pull {entity.name}&rsquo;s SAP/ACDOCA postings, apply TP
            policy, rebuild the segmented P&L, and quantify the gap to range — the mechanical, low-judgment
            preparation. You then decide, review, and post.
          </Typography>
          <Box>
            <Button variant="contained" onClick={() => void runPrepare()} disabled={preparing} startIcon={preparing ? <CircularProgress size={16} color="inherit" /> : undefined}>
              {preparing ? 'Preparing…' : 'Run Research Brain preparation'}
            </Button>
          </Box>
        </Stack>
      );
    }
    if (step.key === 'quantify') {
      return (
        <Stack spacing={2}>
          <Typography variant="body2">
            {entity.name} is at <b>{pct(c.actual)}</b> against a target of <b>{entity.targetMarginLabel}</b>
            {entity.variance ? <> — <b>{entity.variance > 0 ? '+' : ''}{entity.variance.toFixed(1)}pp</b> outside the band.</> : '.'}
          </Typography>
          <Box>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>Adjustment basis</Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={mode}
              onChange={(_, v) => v && wf.patchPayload({ mode: v })}
              sx={{ display: 'block', mt: 0.5 }}
            >
              <ToggleButton value="median">To median ({pct(c.median)})</ToggleButton>
              <ToggleButton value="edge">To nearest edge</ToggleButton>
              <ToggleButton value="custom">Custom</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          {mode === 'custom' && (
            <TextField
              label={`Adjustment amount (${c.ccy})`}
              type="number"
              size="small"
              value={customAmount}
              onChange={(e) => wf.patchPayload({ customAmount: Number(e.target.value) })}
              sx={{ maxWidth: 280 }}
            />
          )}
          <Alert severity="info" variant="outlined" sx={{ maxWidth: 520 }}>
            Profit adjustment <b>{formatCurrency(amount, c.ccy)}</b> moves the margin to <b>{pct(resultMargin)}</b>.
          </Alert>
        </Stack>
      );
    }
    // review (gate)
    return (
      <Stack spacing={2}>
        <Stack direction="row" spacing={3}>
          <Box>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>Before</Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, color: statusColor[entity.status] }}>{pct(c.actual)}</Typography>
          </Box>
          <Box>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>After</Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, color: statusColor['in-range'] }}>{pct(resultMargin)}</Typography>
          </Box>
          <Box>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>Adjustment</Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(amount, c.ccy)}</Typography>
          </Box>
        </Stack>
        <TextField
          label="Rationale (required for sign-off)"
          multiline
          minRows={2}
          value={rationale}
          onChange={(e) => wf.patchPayload({ rationale: e.target.value })}
          placeholder="e.g. True-up to the median of the benchmarking range per the IC services agreement."
          sx={{ maxWidth: 620 }}
        />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Submitting routes this to the maker-checker queue. The rationale is captured at the point of
          action and travels with the record.
        </Typography>
      </Stack>
    );
  };

  if (!wf.loaded) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <WorkflowPath
      steps={STEPS}
      stepIndex={wf.stepIndex}
      setStepIndex={wf.setStepIndex}
      canContinue={canContinue}
      onComplete={() => void submit()}
      completing={submitting}
      renderStep={renderStep}
      lastSavedAt={wf.lastSavedAt}
    />
  );
}

const Overview: FC<BindingCtx> = () => {
  const [sp] = useSearchParams();
  const entityId = sp.get('entity') || undefined;
  return (
    <Stack spacing={2}>
      {/* The margins driving this adjustment decision — say which P&L basis they're on. */}
      <Box>
        <BasisBadge />
      </Box>
      {entityId ? <Adjustment entityId={entityId} /> : <Picker />}
    </Stack>
  );
};

export const otp16: ProcessBinding = {
  kpis: Kpis,
  tabs: { overview: Overview },
};
