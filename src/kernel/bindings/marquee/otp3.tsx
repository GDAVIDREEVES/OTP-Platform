import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useEntities, useRoyalties } from '@/shared/providers/DataProvider';
import { formatCurrency } from '@/shared/utils/format';
import type { Entity } from '@/shared/types/entity';
import type { StepDef } from '@/kernel/registry/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import WorkflowPath from '@/kernel/workflow/WorkflowPath';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import { useGuidedWorkflow } from '@/kernel/workflow/useGuidedWorkflow';
import { useReference } from '@/kernel/data/useReference';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

const nameOf = (entities: Entity[], code: string) => entities.find((e) => e.id === code)?.name ?? code;

const STEPS: StepDef[] = [
  { key: 'prepare', label: 'Prepare', actor: 'assistant' },
  { key: 'setRate', label: 'Set rate', actor: 'human' },
  { key: 'review', label: 'Review & submit', actor: 'human', gate: true },
];

interface BMSet { set_id: string; lower: number; median: number; upper: number; unit: string }
interface BM { sets: BMSet[] }

const Kpis: FC<BindingCtx> = () => {
  const r = useRoyalties();
  const within = r.filter((x) => x.withinBenchmark).length;
  const items: KpiItem[] = [
    { key: 'n', label: 'Royalty arrangements', value: String(r.length) },
    { key: 'w', label: 'Within benchmark', value: `${within}/${r.length}`, tone: within === r.length ? 'ok' : 'watch' },
    { key: 'f', label: 'YTD royalty fees', value: formatCurrency(r.reduce((s, x) => s + (x.ytdFees || 0), 0), 'USD', true) },
  ];
  return <KpiStrip items={items} />;
};

const Rates: FC<BindingCtx> = () => {
  const r = useRoyalties();
  const entities = useEntities();
  const navigate = useNavigate();
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Rates carry forward from prior year and policy — change what moved. The arm&rsquo;s-length range and
        a read on defensibility are shown inline.
      </Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>IP</TableCell><TableCell>Licensor → Licensee</TableCell><TableCell align="right">Rate</TableCell>
            <TableCell>Base</TableCell><TableCell>Benchmark range</TableCell><TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {r.map((x) => (
            <TableRow key={x.id} hover>
              <TableCell>{x.ipCategory}</TableCell>
              <TableCell>{nameOf(entities, x.licensor)} → {nameOf(entities, x.licensee)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{x.rate}%</TableCell>
              <TableCell>{x.base}</TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <span>{x.benchmarkRange}</span>
                  <ProvenanceChip source="benchmark" tooltip="Backed by OTP-25 benchmarking set" onClick={() => navigate('/process/OTP-25/overview')} />
                </Stack>
              </TableCell>
              <TableCell>
                <Chip size="small" label={x.withinBenchmark ? 'In range' : 'Review'} sx={{ bgcolor: x.withinBenchmark ? '#16A34A' : '#D97706', color: 'white', fontWeight: 700, height: 22 }} />
              </TableCell>
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
  const bm = (data?.sets ?? []).find((s) => s.set_id === 'BM-ROY-API');
  const lower = bm?.lower ?? 4, median = bm?.median ?? 6, upper = bm?.upper ?? 8;
  const g = useGuidedWorkflow('OTP-3', 'OTP3-royalty-API', STEPS);
  const rate = Number(g.wf.payload.rate ?? median);
  const inRange = rate >= lower && rate <= upper;
  const rationale = String(g.wf.payload.rationale || '');
  const prepared = !!g.wf.payload.prepared;

  if (g.submitted) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        <Alert icon={<CheckCircleIcon />} severity="success">Royalty rate <b>{rate}%</b> submitted for review.</Alert>
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" onClick={() => navigate(`/evidence/${encodeURIComponent('OTP3-royalty-API')}`)}>Evidence packet</Button>
          <Button variant="outlined" onClick={() => navigate('/review')}>Open review queue</Button>
        </Stack>
      </Stack>
    );
  }

  if (!g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const key = STEPS[g.wf.stepIndex]?.key;
  const canContinue = key === 'prepare' ? prepared : key === 'review' ? rationale.trim().length > 0 : true;

  const renderStep = (step: StepDef) => {
    if (step.key === 'prepare') {
      return prepared ? (
        <AgenticHandoffMarker summary={String(g.wf.payload.rbSummary || '')} />
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2">
            The Research Brain pulls the prior-year royalty rate and the benchmarking interquartile range,
            then hands the rate decision to you.
          </Typography>
          <Box>
            <Button
              variant="contained"
              disabled={g.preparing}
              startIcon={g.preparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void g.prepare({ summary: `Pulled the prior-year royalty rate and the benchmarking IQR (${lower}–${upper}%, median ${median}%) for the API license. Steps 2–3 — your decision, review, and submit — are yours.` })}
            >
              {g.preparing ? 'Preparing…' : 'Run Research Brain preparation'}
            </Button>
          </Box>
        </Stack>
      );
    }
    if (step.key === 'setRate') {
      return (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2">Arm&rsquo;s-length range <b>{lower}–{upper}%</b> (median {median}%)</Typography>
            <ProvenanceChip source="OTP-25 benchmarking" tooltip="Backed by the benchmarking set" onClick={() => navigate('/process/OTP-25/overview')} />
          </Stack>
          <TextField label="Royalty rate (%)" type="number" size="small" value={rate} onChange={(e) => g.wf.patchPayload({ rate: Number(e.target.value) })} sx={{ maxWidth: 220 }} />
          <Alert severity={inRange ? 'success' : 'warning'} variant="outlined" sx={{ maxWidth: 560 }}>
            {inRange ? `In range — defensible against the ${lower}–${upper}% IQR.` : `Outside the ${lower}–${upper}% range — expect scrutiny; document the basis.`}
          </Alert>
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <Typography variant="body2">Set the API royalty rate to <b>{rate}%</b> ({inRange ? 'in range' : 'out of range'}). Submitting routes it to maker-checker review.</Typography>
        <TextField label="Rationale (required for sign-off)" multiline minRows={2} value={rationale} onChange={(e) => g.wf.patchPayload({ rationale: e.target.value })} sx={{ maxWidth: 620 }} />
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

export const otp3: ProcessBinding = { kpis: Kpis, tabs: { overview: Wizard, inputs: Rates } };
