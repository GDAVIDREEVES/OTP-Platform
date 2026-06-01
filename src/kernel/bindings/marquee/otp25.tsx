import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import type { StepDef } from '@/kernel/registry/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import WorkflowPath from '@/kernel/workflow/WorkflowPath';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import { useGuidedWorkflow } from '@/kernel/workflow/useGuidedWorkflow';
import { useReference } from '@/kernel/data/useReference';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

interface BMSet {
  set_id: string; method: string; applies_to: string; pli: string;
  lower: number; median: number; upper: number; unit: string; source: string; comparables: number;
}
interface BM { sets: BMSet[] }

const STEPS: StepDef[] = [
  { key: 'select', label: 'Select set', actor: 'human' },
  { key: 'refresh', label: 'Refresh', actor: 'assistant' },
  { key: 'accept', label: 'Accept range', actor: 'human', gate: true },
];

const Kpis: FC<BindingCtx> = () => {
  const { data } = useReference<BM>('benchmarks');
  const sets = data?.sets ?? [];
  const items: KpiItem[] = [
    { key: 's', label: 'Benchmark sets', value: String(sets.length) },
    { key: 'c', label: 'Comparables', value: String(sets.reduce((s, x) => s + x.comparables, 0)) },
    { key: 'm', label: 'Methods', value: String(new Set(sets.map((s) => s.method)).size) },
  ];
  return <KpiStrip items={items} />;
};

const Sets: FC<BindingCtx> = () => {
  const { data, loading } = useReference<BM>('benchmarks');
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const sets = data?.sets ?? [];
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">Arm&rsquo;s-length ranges and royalty comparables that back rate-setting (OTP-3) and adjustments (OTP-16).</Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Applies to</TableCell><TableCell>Method</TableCell><TableCell align="right">Lower</TableCell>
            <TableCell align="right">Median</TableCell><TableCell align="right">Upper</TableCell><TableCell align="right">n</TableCell><TableCell>Source</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sets.map((s) => (
            <TableRow key={s.set_id} hover>
              <TableCell sx={{ fontWeight: 700 }}>{s.applies_to}</TableCell>
              <TableCell><Chip size="small" label={s.method} variant="outlined" /></TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{s.lower}{s.unit}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{s.median}{s.unit}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{s.upper}{s.unit}</TableCell>
              <TableCell align="right">{s.comparables}</TableCell>
              <TableCell><Typography variant="caption" sx={{ color: 'text.secondary' }}>{s.source}</Typography></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
};

const Wizard: FC<BindingCtx> = () => {
  const navigate = useNavigate();
  const { data } = useReference<BM>('benchmarks');
  const sets = data?.sets ?? [];
  const g = useGuidedWorkflow('OTP-25', 'OTP25-refresh', STEPS);
  const setId = String(g.wf.payload.setId || '');
  const set = sets.find((s) => s.set_id === setId);
  const prepared = !!g.wf.payload.prepared;

  if (g.submitted) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        <Alert icon={<CheckCircleIcon />} severity="success">Benchmarking range for <b>{set?.applies_to}</b> accepted and submitted for review.</Alert>
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" onClick={() => navigate(`/evidence/${encodeURIComponent('OTP25-refresh')}`)}>Evidence packet</Button>
          <Button variant="outlined" onClick={() => navigate('/review')}>Open review queue</Button>
        </Stack>
      </Stack>
    );
  }
  if (!g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const key = STEPS[g.wf.stepIndex]?.key;
  const canContinue = key === 'select' ? !!set : key === 'refresh' ? prepared : true;

  const renderStep = (step: StepDef) => {
    if (step.key === 'select') {
      return (
        <Stack spacing={1}>
          <Typography variant="body2">Choose the benchmarking set to refresh.</Typography>
          {sets.map((s) => (
            <Box
              key={s.set_id}
              onClick={() => g.wf.patchPayload({ setId: s.set_id })}
              sx={{ p: 1.25, border: '1px solid', borderColor: s.set_id === setId ? '#2563EB' : 'divider', borderRadius: 1.5, cursor: 'pointer', bgcolor: s.set_id === setId ? '#EFF6FF' : 'transparent' }}
            >
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{s.applies_to}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{s.method} · {s.lower}–{s.upper}{s.unit} (median {s.median}{s.unit}) · n={s.comparables} · {s.source}</Typography>
            </Box>
          ))}
        </Stack>
      );
    }
    if (step.key === 'refresh') {
      return prepared ? (
        <AgenticHandoffMarker summary={String(g.wf.payload.rbSummary || '')} />
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2">The Research Brain refreshes the comparable set and confirms the interquartile range. You accept it.</Typography>
          <Box>
            <Button variant="contained" disabled={g.preparing} startIcon={g.preparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void g.prepare({ summary: `Refreshed the comparable set for ${set?.applies_to}; interquartile range confirmed at ${set?.lower}–${set?.upper}${set?.unit} (median ${set?.median}${set?.unit}), n=${set?.comparables}. Accept and submit is yours.` })}>
              {g.preparing ? 'Refreshing…' : 'Refresh comparables'}
            </Button>
          </Box>
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <Typography variant="body2">
          Accept the refreshed range for <b>{set?.applies_to}</b>: <b>{set?.lower}–{set?.upper}{set?.unit}</b> (median {set?.median}{set?.unit}). Submitting routes it to review.
        </Typography>
      </Stack>
    );
  };

  return (
    <WorkflowPath steps={STEPS} stepIndex={g.wf.stepIndex} setStepIndex={g.wf.setStepIndex} canContinue={canContinue}
      onComplete={() => void g.submit()} completing={g.submitting} renderStep={renderStep} lastSavedAt={g.wf.lastSavedAt} />
  );
};

export const otp25: ProcessBinding = { kpis: Kpis, tabs: { overview: Wizard, inputs: Sets } };
