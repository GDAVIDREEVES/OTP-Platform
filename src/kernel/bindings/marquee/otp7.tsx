import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import SubmitSuccess from '@/kernel/shell/SubmitSuccess';
import { formatCurrency } from '@/shared/utils/format';
import type { StepDef } from '@/kernel/registry/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import WorkflowPath from '@/kernel/workflow/WorkflowPath';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import { useGuidedWorkflow } from '@/kernel/workflow/useGuidedWorkflow';
import { useReference } from '@/kernel/data/useReference';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

const RECORD_REF = 'OTP7-guarantee';

interface Arrangement {
  guarantee_id: string;
  beneficiary: string;
  beneficiary_name: string;
  guaranteed_principal: number;
  currency: string;
  facility: string;
  standalone_rating: string;
  group_rating: string;
  yield_benefit_bps: number;
  guarantee_fee_bps: number;
}
interface Guarantee {
  guarantor: string;
  guarantor_name: string;
  guarantor_group_rating: string;
  benchmark_id: string;
  arrangements: Arrangement[];
}

/** Annual fee = guaranteed principal x fee (bps). Computed, never seeded. */
const annualFee = (a: Arrangement) => a.guaranteed_principal * (a.guarantee_fee_bps / 10000);
const totalPrincipal = (arr: Arrangement[]) => arr.reduce((s, a) => s + a.guaranteed_principal, 0);
const totalAnnualFee = (arr: Arrangement[]) => arr.reduce((s, a) => s + annualFee(a), 0);
/** Principal-weighted blended fee in bps. */
const blendedFeeBps = (arr: Arrangement[]) => {
  const p = totalPrincipal(arr);
  return p > 0 ? Math.round((totalAnnualFee(arr) / p) * 10000) : 0;
};

const FabricatedNote: FC = () => (
  <Alert severity="warning" variant="outlined">
    <b>Fabricated data — illustrative.</b> The financial-guarantee register and the standalone-vs-group rating uplift
    are illustrative — there is no guarantee or credit-rating source in the warehouse. Magnitudes (~$165M total
    guaranteed principal, 35–85 bps yield benefit, 20–45 bps fee) are sized to be credible for the group and the fee
    captures roughly half the yield benefit. Confirm the scale and the rating uplift before relying on these figures.
  </Alert>
);

const STEPS: StepDef[] = [
  { key: 'prepare', label: 'Prepare', actor: 'assistant' },
  { key: 'setFee', label: 'Set fees', actor: 'human' },
  { key: 'review', label: 'Review & submit', actor: 'human', gate: true },
];

function useGuarantee() {
  const { data, loading } = useReference<Guarantee>('guarantee');
  return { model: data, loading };
}

const Kpis: FC<BindingCtx> = () => {
  const { model } = useGuarantee();
  const arr = model?.arrangements ?? [];
  const items: KpiItem[] = [
    { key: 'n', label: 'Guarantees', value: String(arr.length) },
    { key: 'p', label: 'Guaranteed principal', value: model ? formatCurrency(totalPrincipal(arr), 'USD', true) : '—' },
    { key: 'bps', label: 'Blended fee', value: model ? `${blendedFeeBps(arr)} bps` : '—', provenance: 'yield-benefit · BM-FIN' },
    { key: 'fee', label: 'Annual fee', value: model ? formatCurrency(totalAnnualFee(arr), 'USD', true) : '—' },
  ];
  return <KpiStrip items={items} />;
};

const ArrangementTable: FC<{ model: Guarantee }> = ({ model }) => {
  const navigate = useNavigate();
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Guarantee</TableCell>
          <TableCell>Beneficiary</TableCell>
          <TableCell align="right">Principal</TableCell>
          <TableCell>Rating uplift</TableCell>
          <TableCell align="right">Yield benefit</TableCell>
          <TableCell align="right">Fee</TableCell>
          <TableCell align="right">Annual fee</TableCell>
          <TableCell>Benchmark</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {model.arrangements.map((a) => (
          <TableRow key={a.guarantee_id} hover>
            <TableCell>{a.guarantee_id}</TableCell>
            <TableCell>{a.beneficiary_name}</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(a.guaranteed_principal, a.currency, true)}</TableCell>
            <TableCell>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Chip size="small" label={a.standalone_rating} sx={{ height: 22, fontWeight: 700 }} />
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>→</Typography>
                <Chip size="small" label={a.group_rating} sx={{ height: 22, fontWeight: 700, bgcolor: '#EDE9FE' }} />
              </Stack>
            </TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{a.yield_benefit_bps} bps</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{a.guarantee_fee_bps} bps</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(annualFee(a), 'USD', true)}</TableCell>
            <TableCell>
              <ProvenanceChip source={model.benchmark_id} tooltip="Credit benchmark backing the rating uplift" onClick={() => navigate('/process/OTP-25/overview')} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const Arrangements: FC<BindingCtx> = () => {
  const { model, loading } = useGuarantee();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.arrangements.length) return <Alert severity="info" variant="outlined">No financial guarantees to price.</Alert>;
  return (
    <Stack spacing={2}>
      <FabricatedNote />
      <Alert severity="info" variant="outlined">
        Each fee is priced on the <b>yield-benefit</b> approach: with {model.guarantor_name}&rsquo;s explicit guarantee
        the beneficiary borrows at the group&rsquo;s {model.guarantor_group_rating} rating rather than its standalone
        rating, and the arm&rsquo;s-length fee captures roughly half of that interest saving.
      </Alert>
      <ArrangementTable model={model} />
    </Stack>
  );
};

const Wizard: FC<BindingCtx> = () => {
  const navigate = useNavigate();
  const { model, loading } = useGuarantee();
  const g = useGuidedWorkflow('OTP-7', RECORD_REF, STEPS);
  const prepared = !!g.wf.payload.prepared;

  if (g.submitted) {
    return (
      <SubmitSuccess
        message="Guarantee fees submitted for review."
        recordRef={RECORD_REF}
        processId="OTP-7"
      />
    );
  }

  if (loading || !g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.arrangements.length) return <Alert severity="info" variant="outlined">No financial guarantees to price.</Alert>;

  const arr = model.arrangements;
  const n = arr.length;
  const bps = blendedFeeBps(arr);
  const key = STEPS[g.wf.stepIndex]?.key;
  const canContinue = key === 'prepare' ? prepared : true;

  const renderStep = (step: StepDef) => {
    if (step.key === 'prepare') {
      return prepared ? (
        <AgenticHandoffMarker summary={String(g.wf.payload.rbSummary || '')} />
      ) : (
        <Stack spacing={2}>
          <FabricatedNote />
          <Typography variant="body2">
            The Research Brain pulls each beneficiary&rsquo;s standalone rating, measures the yield benefit from the
            group&rsquo;s {model.guarantor_group_rating} implicit support, and proposes a fee that captures about half
            the saving — anchored to the {model.benchmark_id} credit band. The fee decision is yours.
          </Typography>
          <Box>
            <Button
              variant="contained"
              disabled={g.preparing}
              startIcon={g.preparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void g.prepare({ summary: `Priced ${n} financial guarantees (${formatCurrency(totalPrincipal(arr), 'USD', true)} guaranteed principal) on the yield-benefit approach; blended fee ${bps} bps, annual fee ${formatCurrency(totalAnnualFee(arr), 'USD', true)}. Review and submit are yours.` })}
            >
              {g.preparing ? 'Preparing…' : 'Run Research Brain preparation'}
            </Button>
          </Box>
        </Stack>
      );
    }
    if (step.key === 'setFee') {
      return (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2">Blended fee <b>{bps} bps</b> on {formatCurrency(totalPrincipal(arr), 'USD', true)} guaranteed principal</Typography>
            <ProvenanceChip source={`${model.benchmark_id} credit`} tooltip="Backed by the OTP-25 credit benchmark" onClick={() => navigate('/process/OTP-25/overview')} />
          </Stack>
          <Alert severity="info" variant="outlined">
            Each fee sits below its yield benefit (the fee never exceeds the interest the beneficiary saves), so the
            split leaves benefit on both sides — defensible against the {model.benchmark_id} credit band.
          </Alert>
          <ArrangementTable model={model} />
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <Typography variant="body2">
          Set the guarantee fees on <b>{n}</b> arrangements (blended {bps} bps, annual fee
          {' '}{formatCurrency(totalAnnualFee(arr), 'USD', true)}). Submitting routes them to maker-checker review.
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

export const otp7: ProcessBinding = { kpis: Kpis, tabs: { overview: Wizard, inputs: Arrangements } };
