import { useEffect, useState } from 'react';
import type { FC } from 'react';
import SubmitSuccess from '@/kernel/shell/SubmitSuccess';
import {
  Alert, Box, Button, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import type { TreasuryModel } from '@/shared/api/types';
import type { StepDef } from '@/kernel/registry/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import WorkflowPath from '@/kernel/workflow/WorkflowPath';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import { useGuidedWorkflow } from '@/kernel/workflow/useGuidedWorkflow';
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
    <b>Fabricated data.</b> The IC loan register is illustrative — there is no loan source in the warehouse.
    Interest is computed as principal × all-in rate; confirm the ~$150M principal scale before relying on the accrual.
  </Alert>
);

const STEPS: StepDef[] = [
  { key: 'generate', label: 'Accrue', actor: 'assistant' },
  { key: 'review', label: 'Review batch', actor: 'human' },
  { key: 'post', label: 'Post', actor: 'human', gate: true },
];

const Kpis: FC<BindingCtx> = () => {
  const { model } = useTreasury();
  const items: KpiItem[] = [
    { key: 'n', label: 'Loan accruals', value: String(model?.loans.length ?? 0) },
    { key: 'i', label: 'Annual interest', value: model ? formatCurrency(model.totals.loan_interest, 'USD', true) : '—' },
    { key: 'p', label: 'On principal', value: model ? formatCurrency(model.totals.loan_principal, 'USD', true) : '—' },
    { key: 'lender', label: 'Lender', value: model ? model.lender_name : '—', provenance: 'header 3400' },
  ];
  return <KpiStrip items={items} />;
};

const AccrualTable: FC<{ model: TreasuryModel }> = ({ model }) => (
  <Table size="small">
    <TableHead>
      <TableRow>
        <TableCell>Invoice</TableCell><TableCell>Lender → Borrower</TableCell>
        <TableCell align="right">Principal</TableCell><TableCell align="right">Rate</TableCell>
        <TableCell align="right">Annual interest</TableCell><TableCell>Status</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {model.loans.map((ln) => (
        <TableRow key={ln.loan_id} hover>
          <TableCell>{`INT-${ln.loan_id}`}</TableCell>
          <TableCell>{model.lender_name} → {ln.borrower_name}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(ln.principal, ln.currency, true)}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{ln.all_in_rate}%</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatCurrency(ln.annual_interest, ln.currency, true)}</TableCell>
          <TableCell><Chip size="small" label="Pending Approval" sx={{ bgcolor: '#D97706', color: 'white', fontWeight: 700, height: 22 }} /></TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

const Outputs: FC<BindingCtx> = () => {
  const { model, loading } = useTreasury();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.loans.length) return <Alert severity="info" variant="outlined">No loan accruals for the period.</Alert>;
  return (
    <Stack spacing={2}>
      <FabricatedNote />
      <Alert severity="info" variant="outlined">The staged IC loan interest accrual & invoice batch. Each line is principal × all-in rate from the lender (3400) to the borrower.</Alert>
      <AccrualTable model={model} />
    </Stack>
  );
};

const Wizard: FC<BindingCtx> = () => {
  const { model, loading } = useTreasury();
  const g = useGuidedWorkflow('OTP-13', 'OTP13-loan-accrual', STEPS);
  const prepared = !!g.wf.payload.prepared;

  if (g.submitted) {
    return (
      <SubmitSuccess
        message="Loan interest accrual batch posted for review."
        recordRef="OTP13-loan-accrual"
        processId="OTP-13"
      />
    );
  }
  if (loading || !g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.loans.length) return <Alert severity="info" variant="outlined">No loan accruals for the period.</Alert>;

  const n = model.loans.length;
  const interest = model.totals.loan_interest;
  const key = STEPS[g.wf.stepIndex]?.key;
  const canContinue = key === 'generate' ? prepared : true;

  const renderStep = (step: StepDef) => {
    if (step.key === 'generate') {
      return prepared ? (
        <AgenticHandoffMarker summary={String(g.wf.payload.rbSummary || '')} />
      ) : (
        <Stack spacing={2}>
          <FabricatedNote />
          <Typography variant="body2">The Research Brain accrues each loan's interest (principal × all-in rate) and stages the invoices from the lender (3400) to each borrower. You review and post.</Typography>
          <Box>
            <Button variant="contained" disabled={g.preparing} startIcon={g.preparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void g.prepare({ summary: `Accrued interest on ${n} IC loans (${formatCurrency(model.totals.loan_principal, 'USD', true)} principal) — annual interest ${formatCurrency(interest, 'USD', true)}, invoiced from ${model.lender_name}. Review and post are yours.` })}>
              {g.preparing ? 'Accruing…' : 'Accrue & stage batch'}
            </Button>
          </Box>
        </Stack>
      );
    }
    if (step.key === 'review') {
      return (
        <Stack spacing={2}>
          <Alert severity="info" variant="outlined">{n} staged accruals · annual interest {formatCurrency(interest, 'USD', true)}. Each line is principal × all-in rate.</Alert>
          <AccrualTable model={model} />
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <Typography variant="body2">Post the batch of <b>{n}</b> loan interest accruals ({formatCurrency(interest, 'USD', true)}) for approval. A reviewer signs off before it commits.</Typography>
      </Stack>
    );
  };

  return (
    <WorkflowPath steps={STEPS} stepIndex={g.wf.stepIndex} setStepIndex={g.wf.setStepIndex} canContinue={canContinue}
      onComplete={() => void g.submit()} completing={g.submitting} renderStep={renderStep} lastSavedAt={g.wf.lastSavedAt} />
  );
};

export const otp13: ProcessBinding = { kpis: Kpis, tabs: { overview: Wizard, outputs: Outputs } };
