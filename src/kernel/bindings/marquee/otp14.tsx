import { useEffect, useState } from 'react';
import type { FC } from 'react';
import SubmitSuccess from '@/kernel/shell/SubmitSuccess';
import {
  Alert, Box, Button, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';
import type { TreasuryModel } from '@/shared/api/types';
import type { StepDef } from '@/kernel/registry/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import WorkflowPath from '@/kernel/workflow/WorkflowPath';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import { useGuidedWorkflow } from '@/kernel/workflow/useGuidedWorkflow';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

const signedCurrency = (v: number, ccy: string) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatCurrency(Math.abs(v), ccy, true)}`;

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
    <b>Fabricated data.</b> The cash-pool positions are illustrative — there is no pool source in the warehouse.
    Participant balances net to ~0 by construction; interest is balance × spread. Confirm the ~$50M pool scale.
  </Alert>
);

const STEPS: StepDef[] = [
  { key: 'compute', label: 'Compute', actor: 'assistant' },
  { key: 'stage', label: 'Stage settlement', actor: 'human' },
  { key: 'post', label: 'Post', actor: 'human', gate: true },
];

const depositors = (m: TreasuryModel | null) => (m?.cash_pool.participants ?? []).filter((p) => p.position === 'deposit').length;
const borrowers = (m: TreasuryModel | null) => (m?.cash_pool.participants ?? []).filter((p) => p.position === 'borrow').length;

const Kpis: FC<BindingCtx> = () => {
  const { model } = useTreasury();
  const cp = model?.cash_pool;
  const items: KpiItem[] = [
    { key: 'h', label: 'Pool header', value: cp ? cp.header_name : '—', provenance: 'header 3400' },
    { key: 'i', label: 'Net interest', value: model ? formatCurrency(model.totals.pool_interest, model?.cash_pool.currency ?? 'EUR', true) : '—' },
    { key: 'net', label: 'Net position', value: cp ? formatCurrency(cp.net_position, cp.currency, true) : '—', tone: cp && Math.abs(cp.net_position) < 1 ? 'ok' : 'watch' },
    { key: 'seats', label: 'Depositors / borrowers', value: `${depositors(model)} / ${borrowers(model)}` },
  ];
  return <KpiStrip items={items} />;
};

const SettlementTable: FC<{ model: TreasuryModel }> = ({ model }) => {
  const ccy = model.cash_pool.currency;
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Participant</TableCell>
          <TableCell align="right">Pool balance</TableCell>
          <TableCell>Position</TableCell>
          <TableCell align="right">Spread</TableCell>
          <TableCell align="right">Interest settlement</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {model.cash_pool.participants.map((p) => (
          <TableRow key={p.rbukrs} hover>
            <TableCell sx={{ fontWeight: 700 }}>{p.name}</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{signedCurrency(p.balance, ccy)}</TableCell>
            <TableCell sx={{ textTransform: 'capitalize' }}>{p.position}</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{p.spread}%</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: p.position === 'deposit' ? tokens.ok : tokens.risk }}>
              {signedCurrency(p.position === 'deposit' ? p.annual_interest : -p.annual_interest, ccy)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const Outputs: FC<BindingCtx> = () => {
  const { model, loading } = useTreasury();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.cash_pool.participants.length) return <Alert severity="info" variant="outlined">No cash-pool participants for the period.</Alert>;
  const cp = model.cash_pool;
  return (
    <Stack spacing={2}>
      <FabricatedNote />
      <Alert severity="info" variant="outlined">
        Cash-pool interest settlement: depositors earn the {cp.deposit_spread}% deposit spread (green), borrowers pay the
        {' '}{cp.borrow_spread}% borrow spread (red). Balances net to {formatCurrency(cp.net_position, cp.currency, true)} by construction.
      </Alert>
      <SettlementTable model={model} />
    </Stack>
  );
};

const Wizard: FC<BindingCtx> = () => {
  const { model, loading } = useTreasury();
  const g = useGuidedWorkflow('OTP-14', 'OTP14-pool-settlement', STEPS);
  const prepared = !!g.wf.payload.prepared;

  if (g.submitted) {
    return (
      <SubmitSuccess
        message="Cash-pool interest settlement batch posted for review."
        recordRef="OTP14-pool-settlement"
        processId="OTP-14"
      />
    );
  }

  if (loading || !g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.cash_pool.participants.length) return <Alert severity="info" variant="outlined">No cash-pool participants for the period.</Alert>;

  const cp = model.cash_pool;
  const interest = model.totals.pool_interest;
  const n = cp.participants.length;
  const key = STEPS[g.wf.stepIndex]?.key;
  const canContinue = key === 'compute' ? prepared : true;

  const renderStep = (step: StepDef) => {
    if (step.key === 'compute') {
      return prepared ? (
        <AgenticHandoffMarker summary={String(g.wf.payload.rbSummary || '')} />
      ) : (
        <Stack spacing={2}>
          <FabricatedNote />
          <Typography variant="body2">
            The Research Brain computes each participant's interest from its pool balance and the deposit/borrow spread,
            then stages the net settlement against the {cp.header_name} header. You review and post.
          </Typography>
          <Box>
            <Button
              variant="contained"
              disabled={g.preparing}
              startIcon={g.preparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void g.prepare({ summary: `Computed cash-pool interest for ${n} participants (${depositors(model)} depositors / ${borrowers(model)} borrowers); balances net to ${formatCurrency(cp.net_position, cp.currency, true)}, net interest ${formatCurrency(interest, cp.currency, true)}. Review and post are yours.` })}
            >
              {g.preparing ? 'Computing…' : 'Compute pool settlement'}
            </Button>
          </Box>
        </Stack>
      );
    }
    if (step.key === 'stage') {
      return (
        <Stack spacing={2}>
          <Alert severity="info" variant="outlined">
            {n} staged settlements · net interest {formatCurrency(interest, cp.currency, true)} ({depositors(model)} earn / {borrowers(model)} pay). Balances net to {formatCurrency(cp.net_position, cp.currency, true)}.
          </Alert>
          <SettlementTable model={model} />
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <Typography variant="body2">
          Post the cash-pool settlement of <b>{n}</b> participants (net interest {formatCurrency(interest, cp.currency, true)}) against the {cp.header_name} header.
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

export const otp14: ProcessBinding = { kpis: Kpis, tabs: { overview: Wizard, outputs: Outputs } };
