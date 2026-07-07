import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import SubmitSuccess from '@/kernel/shell/SubmitSuccess';
import { useEntities, useInvoices } from '@/shared/providers/DataProvider';
import { formatCurrency } from '@/shared/utils/format';
import type { Entity } from '@/shared/types/entity';
import type { Invoice } from '@/shared/types/transaction';
import type { StepDef } from '@/kernel/registry/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import WorkflowPath from '@/kernel/workflow/WorkflowPath';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import { useGuidedWorkflow } from '@/kernel/workflow/useGuidedWorkflow';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

const STATUS_COLOR: Record<string, string> = {
  'Pending Approval': '#D97706', Approved: '#16A34A', Exported: '#2563EB', Draft: '#64748B', Rejected: '#DC2626', Reversed: '#64748B',
};
const nameOf = (entities: Entity[], code: string) => entities.find((e) => e.id === code)?.name ?? code;

/** The service cost-allocation charge batch: SERVICE-type invoices synthesized
 *  from supply_chain (cost base × markup). Reuses the shared invoices provider,
 *  filtered to the SERVICE material type — never a hardcoded set. */
const useBatch = (): Invoice[] => {
  const invoices = useInvoices();
  return invoices.filter(
    (i) => i.materialType === 'SERVICE' || /concept fee|management/i.test(i.type),
  );
};

const totalsOf = (batch: Invoice[]) => {
  const total = batch.reduce((s, i) => s + i.amount, 0);
  const cost = batch.reduce((s, i) => s + (i.costBase ?? 0), 0);
  const lines = batch.reduce((s, i) => s + (i.lines ?? 0), 0);
  const payees = new Set(batch.map((i) => i.payee).filter(Boolean)).size;
  const markup = cost > 0 ? (total - cost) / cost : 0;
  return { total, cost, lines, payees, markup };
};

const STEPS: StepDef[] = [
  { key: 'generate', label: 'Generate', actor: 'assistant' },
  { key: 'review', label: 'Review batch', actor: 'human' },
  { key: 'post', label: 'Post', actor: 'human', gate: true },
];

const Kpis: FC<BindingCtx> = () => {
  const batch = useBatch();
  const { total, lines, payees, markup } = totalsOf(batch);
  const items: KpiItem[] = [
    { key: 'n', label: 'Service lines', value: String(lines || batch.length) },
    { key: 'v', label: 'Total charge', value: formatCurrency(total, 'USD', true), provenance: 'supply_chain · ACDOCA' },
    { key: 'm', label: 'Blended markup', value: `${(markup * 100).toFixed(1)}%`, provenance: 'cost-plus on STANDARD_COST' },
    { key: 'p', label: 'Payees', value: String(payees) },
  ];
  return <KpiStrip items={items} />;
};

const BatchTable: FC = () => {
  const batch = useBatch();
  const entities = useEntities();
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Invoice</TableCell><TableCell>Date</TableCell><TableCell>Payor → Payee</TableCell>
          <TableCell>Type</TableCell><TableCell align="right">Cost base</TableCell><TableCell align="right">Markup</TableCell>
          <TableCell align="right">Charge</TableCell><TableCell>Status</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {batch.slice(0, 50).map((i) => (
          <TableRow key={i.id} hover>
            <TableCell>{i.id}</TableCell>
            <TableCell>{i.date}</TableCell>
            <TableCell>{nameOf(entities, i.payor)} → {nameOf(entities, i.payee)}</TableCell>
            <TableCell>{i.type}</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{i.costBase != null ? formatCurrency(i.costBase, i.currency || 'USD') : '—'}</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{i.markup != null ? `${(i.markup * 100).toFixed(1)}%` : '—'}</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(i.amount, i.currency || 'USD')}</TableCell>
            <TableCell><Chip size="small" label={i.status} sx={{ bgcolor: STATUS_COLOR[i.status] || '#64748B', color: 'white', fontWeight: 700, height: 22 }} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const Outputs: FC<BindingCtx> = () => {
  const navigate = useNavigate();
  return (
    <Stack spacing={2}>
      {/* M7 wiring: the charge batch's engine-grade twin lives in Calc Studio. */}
      <Alert
        severity="info"
        variant="outlined"
        action={
          <Button color="inherit" size="small" onClick={() => navigate('/calc-studio/allocations')}>
            Open Allocations workbench
          </Button>
        }
      >
        These service charges are produced by the <b>allocation engine</b> — pool → benefit-test gate →
        allocate → markup → charge-out, reconciled to a zero residual with full charge-to-cost-line
        lineage.
      </Alert>
      <Alert severity="info" variant="outlined">The staged service cost-allocation charge & invoice batch. Each line carries its cost base and applied markup; exceptions surface here.</Alert>
      <BatchTable />
    </Stack>
  );
};

const Wizard: FC<BindingCtx> = () => {
  const navigate = useNavigate();
  const batch = useBatch();
  const { total, markup } = totalsOf(batch);
  const g = useGuidedWorkflow('OTP-10', 'OTP10-service-batch', STEPS);
  const prepared = !!g.wf.payload.prepared;

  if (g.submitted) {
    return (
      <SubmitSuccess
        message={<>Service charge batch ({batch.length} lines, {formatCurrency(total, 'USD', true)}) posted for review.</>}
        recordRef="OTP10-service-batch"
        processId="OTP-10"
      />
    );
  }
  if (!g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const key = STEPS[g.wf.stepIndex]?.key;
  const canContinue = key === 'generate' ? prepared : true;
  const markupPct = `${(markup * 100).toFixed(1)}%`;

  const renderStep = (step: StepDef) => {
    if (step.key === 'generate') {
      return prepared ? (
        <AgenticHandoffMarker summary={String(g.wf.payload.rbSummary || '')} />
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2">The Research Brain stages the service cost-allocation charges — cost base × markup ({markupPct} blended) — from the supply-chain flows and flags any exceptions. You review and post.</Typography>
          <Box>
            <Button variant="contained" disabled={g.preparing} startIcon={g.preparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void g.prepare({ summary: `Staged ${batch.length} service charges (${formatCurrency(total, 'USD', true)}, ${markupPct} blended markup on cost base) from the supply-chain flows; lines reconciled to postings. Review and post are yours.` })}>
              {g.preparing ? 'Generating…' : 'Generate batch'}
            </Button>
          </Box>
        </Stack>
      );
    }
    if (step.key === 'review') {
      return (
        <Stack spacing={2}>
          <Alert severity="info" variant="outlined">{batch.length} staged lines · {formatCurrency(total, 'USD', true)} · {markupPct} blended markup. Cost base and applied markup surface per line.</Alert>
          <BatchTable />
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <Typography variant="body2">Post the batch of <b>{batch.length}</b> service charges ({formatCurrency(total, 'USD', true)}, {markupPct} blended markup) for approval. A reviewer signs off before it commits.</Typography>
      </Stack>
    );
  };

  return (
    <WorkflowPath steps={STEPS} stepIndex={g.wf.stepIndex} setStepIndex={g.wf.setStepIndex} canContinue={canContinue}
      onComplete={() => void g.submit()} completing={g.submitting} renderStep={renderStep} lastSavedAt={g.wf.lastSavedAt} />
  );
};

export const otp10: ProcessBinding = { kpis: Kpis, tabs: { overview: Wizard, outputs: Outputs } };
