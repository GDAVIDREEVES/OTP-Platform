import type { FC } from 'react';
import SubmitSuccess from '@/kernel/shell/SubmitSuccess';
import {
  Alert, Box, Button, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { useEntities, useInvoices } from '@/shared/providers/DataProvider';
import { formatCurrency } from '@/shared/utils/format';
import type { Entity } from '@/shared/types/entity';
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
const useBatch = () => {
  const invoices = useInvoices();
  const royalty = invoices.filter((i) => /royalt/i.test(i.type));
  return royalty.length ? royalty : invoices;
};

const STEPS: StepDef[] = [
  { key: 'generate', label: 'Generate', actor: 'assistant' },
  { key: 'review', label: 'Review batch', actor: 'human' },
  { key: 'post', label: 'Post', actor: 'human', gate: true },
];

const Kpis: FC<BindingCtx> = () => {
  const batch = useBatch();
  const total = batch.reduce((s, i) => s + i.amount, 0);
  const pending = batch.filter((i) => i.status === 'Pending Approval').length;
  const items: KpiItem[] = [
    { key: 'n', label: 'Charges in batch', value: String(batch.length) },
    { key: 'v', label: 'Batch value', value: formatCurrency(total, 'USD', true), provenance: 'supply_chain · ACDOCA' },
    { key: 'p', label: 'Pending approval', value: String(pending), tone: pending ? 'watch' : 'ok' },
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
          <TableCell>Type</TableCell><TableCell align="right">Amount</TableCell><TableCell>Status</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {batch.slice(0, 50).map((i) => (
          <TableRow key={i.id} hover>
            <TableCell>{i.id}</TableCell>
            <TableCell>{i.date}</TableCell>
            <TableCell>{nameOf(entities, i.payor)} → {nameOf(entities, i.payee)}</TableCell>
            <TableCell>{i.type}</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(i.amount, i.currency || 'USD')}</TableCell>
            <TableCell><Chip size="small" label={i.status} sx={{ bgcolor: STATUS_COLOR[i.status] || '#64748B', color: 'white', fontWeight: 700, height: 22 }} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const Outputs: FC<BindingCtx> = () => (
  <Stack spacing={2}>
    <Alert severity="info" variant="outlined">The staged royalty charge & invoice batch. Each line drills to its postings; exceptions surface here.</Alert>
    <BatchTable />
  </Stack>
);

const Wizard: FC<BindingCtx> = () => {
  const batch = useBatch();
  const total = batch.reduce((s, i) => s + i.amount, 0);
  const g = useGuidedWorkflow('OTP-9', 'OTP9-royalty-batch', STEPS);
  const prepared = !!g.wf.payload.prepared;

  if (g.submitted) {
    return (
      <SubmitSuccess
        message={<>Royalty charge batch ({batch.length} lines, {formatCurrency(total, 'USD', true)}) posted for review.</>}
        recordRef="OTP9-royalty-batch"
        processId="OTP-9"
      />
    );
  }
  if (!g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const key = STEPS[g.wf.stepIndex]?.key;
  const canContinue = key === 'generate' ? prepared : true;

  const renderStep = (step: StepDef) => {
    if (step.key === 'generate') {
      return prepared ? (
        <AgenticHandoffMarker summary={String(g.wf.payload.rbSummary || '')} />
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2">The Research Brain stages the royalty charges from the supply-chain flows and flags any exceptions. You review and post.</Typography>
          <Box>
            <Button variant="contained" disabled={g.preparing} startIcon={g.preparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void g.prepare({ summary: `Staged ${batch.length} royalty charges (${formatCurrency(total, 'USD', true)}) from the supply-chain flows; lines reconciled to postings. Review and post are yours.` })}>
              {g.preparing ? 'Generating…' : 'Generate batch'}
            </Button>
          </Box>
        </Stack>
      );
    }
    if (step.key === 'review') {
      return (
        <Stack spacing={2}>
          <Alert severity="info" variant="outlined">{batch.length} staged lines · {formatCurrency(total, 'USD', true)}. Exceptions surface in the batch rather than being buried.</Alert>
          <BatchTable />
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <Typography variant="body2">Post the batch of <b>{batch.length}</b> royalty charges ({formatCurrency(total, 'USD', true)}) for approval. A reviewer signs off before it commits.</Typography>
      </Stack>
    );
  };

  return (
    <WorkflowPath steps={STEPS} stepIndex={g.wf.stepIndex} setStepIndex={g.wf.setStepIndex} canContinue={canContinue}
      onComplete={() => void g.submit()} completing={g.submitting} renderStep={renderStep} lastSavedAt={g.wf.lastSavedAt} />
  );
};

export const otp9: ProcessBinding = { kpis: Kpis, tabs: { overview: Wizard, outputs: Outputs } };
