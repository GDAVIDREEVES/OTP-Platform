import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { formatCurrency } from '@/shared/utils/format';
import type { StepDef } from '@/kernel/registry/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import WorkflowPath from '@/kernel/workflow/WorkflowPath';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import { useGuidedWorkflow } from '@/kernel/workflow/useGuidedWorkflow';
import { useReference } from '@/kernel/data/useReference';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

const RECORD_REF = 'OTP8-captive';

interface Policy {
  policy_id: string;
  line: string;
  insured: string;
  insured_name: string;
  sum_insured: number;
  gross_premium: number;
  incurred_losses: number;
  expenses: number;
}
interface Captive {
  insurer: string;
  insurer_name: string;
  benchmark_id: string;
  currency: string;
  program_year: number;
  capital: number;
  combined_ratio_ceiling: number;
  capital_adequacy_floor: number;
  policies: Policy[];
}

/** Program aggregates — all COMPUTED from premium / losses / expenses, never seeded. */
const grossPremium = (p: Policy[]) => p.reduce((s, x) => s + x.gross_premium, 0);
const incurredLosses = (p: Policy[]) => p.reduce((s, x) => s + x.incurred_losses, 0);
const expenses = (p: Policy[]) => p.reduce((s, x) => s + x.expenses, 0);
const lossRatio = (p: Policy[]) => {
  const gp = grossPremium(p);
  return gp > 0 ? incurredLosses(p) / gp : 0;
};
const expenseRatio = (p: Policy[]) => {
  const gp = grossPremium(p);
  return gp > 0 ? expenses(p) / gp : 0;
};
const combinedRatio = (p: Policy[]) => lossRatio(p) + expenseRatio(p);
/** Solvency cover = statutory capital / net premium written. */
const capitalAdequacy = (capital: number, p: Policy[]) => {
  const gp = grossPremium(p);
  return gp > 0 ? capital / gp : 0;
};
/** Per-policy combined ratio for the table. */
const policyCombined = (x: Policy) =>
  x.gross_premium > 0 ? (x.incurred_losses + x.expenses) / x.gross_premium : 0;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const FabricatedNote: FC = () => (
  <Alert severity="warning" variant="outlined">
    <b>Fabricated data — illustrative.</b> The captive insurance program — premiums, incurred losses and the combined
    ratio — is illustrative; there is no insurer entity or premium/claims source in the warehouse. Magnitudes (~$9.4M
    gross premium, ~64% loss ratio, ~86% combined ratio, ~$15M capital) are sized to be credible for the group and the
    combined ratio sits inside an underwriting band a third-party insurer would accept. Confirm the scale and the loss
    picks before relying on these figures.
  </Alert>
);

const STEPS: StepDef[] = [
  { key: 'prepare', label: 'Prepare', actor: 'assistant' },
  { key: 'setPremium', label: 'Set premiums', actor: 'human' },
  { key: 'review', label: 'Review & submit', actor: 'human', gate: true },
];

function useCaptive() {
  const { data, loading } = useReference<Captive>('captive');
  return { model: data, loading };
}

const Kpis: FC<BindingCtx> = () => {
  const { model } = useCaptive();
  const pols = model?.policies ?? [];
  const cr = combinedRatio(pols);
  const ca = model ? capitalAdequacy(model.capital, pols) : 0;
  const items: KpiItem[] = [
    { key: 'gp', label: 'Gross premium', value: model ? formatCurrency(grossPremium(pols), model.currency, true) : '—', provenance: 'underwriting · BM-FIN' },
    { key: 'lr', label: 'Loss ratio', value: model ? pct(lossRatio(pols)) : '—' },
    {
      key: 'cr',
      label: 'Combined ratio',
      value: model ? pct(cr) : '—',
      tone: model ? (cr <= model.combined_ratio_ceiling ? 'ok' : 'watch') : undefined,
      hint: 'losses + expenses / premium',
    },
    {
      key: 'ca',
      label: 'Capital adequacy',
      value: model ? `${ca.toFixed(2)}×` : '—',
      tone: model ? (ca >= model.capital_adequacy_floor ? 'ok' : 'watch') : undefined,
      hint: 'capital / net premium',
    },
  ];
  return <KpiStrip items={items} />;
};

const PolicyTable: FC<{ model: Captive }> = ({ model }) => {
  const navigate = useNavigate();
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Policy</TableCell>
          <TableCell>Line</TableCell>
          <TableCell>Insured</TableCell>
          <TableCell align="right">Sum insured</TableCell>
          <TableCell align="right">Premium</TableCell>
          <TableCell align="right">Incurred losses</TableCell>
          <TableCell align="right">Combined ratio</TableCell>
          <TableCell>Benchmark</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {model.policies.map((x) => {
          const combined = policyCombined(x);
          const within = combined <= model.combined_ratio_ceiling;
          return (
            <TableRow key={x.policy_id} hover>
              <TableCell>{x.policy_id}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{x.line}</TableCell>
              <TableCell>{x.insured_name}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(x.sum_insured, model.currency, true)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(x.gross_premium, model.currency, true)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(x.incurred_losses, model.currency, true)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{pct(combined)}</TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Chip size="small" label={within ? 'In band' : 'Review'} sx={{ bgcolor: within ? '#16A34A' : '#D97706', color: 'white', fontWeight: 700, height: 22 }} />
                  <ProvenanceChip source={model.benchmark_id} tooltip="Underwriting benchmark backing the combined-ratio band" onClick={() => navigate('/process/OTP-25/overview')} />
                </Stack>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

const Policies: FC<BindingCtx> = () => {
  const { model, loading } = useCaptive();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.policies.length) return <Alert severity="info" variant="outlined">No captive policies to price.</Alert>;
  return (
    <Stack spacing={2}>
      <FabricatedNote />
      <Alert severity="info" variant="outlined">
        {model.insurer_name} writes {model.policies.length} lines of cover for operating affiliates. Each premium is
        arm&rsquo;s-length-tested on the <b>combined ratio</b> ((incurred losses + expenses) / premium): it must sit at or
        below the {pct(model.combined_ratio_ceiling)} ceiling a third-party insurer would underwrite, and statutory capital
        must clear the {model.capital_adequacy_floor.toFixed(2)}× net-premium solvency floor.
      </Alert>
      <PolicyTable model={model} />
    </Stack>
  );
};

const Wizard: FC<BindingCtx> = () => {
  const navigate = useNavigate();
  const { model, loading } = useCaptive();
  const g = useGuidedWorkflow('OTP-8', RECORD_REF, STEPS);
  const prepared = !!g.wf.payload.prepared;

  if (g.submitted) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        <Alert icon={<CheckCircleIcon />} severity="success">Captive premiums submitted for review.</Alert>
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" onClick={() => navigate(`/evidence/${encodeURIComponent(RECORD_REF)}`)}>Evidence packet</Button>
          <Button variant="outlined" onClick={() => navigate('/review')}>Open review queue</Button>
        </Stack>
      </Stack>
    );
  }

  if (loading || !g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.policies.length) return <Alert severity="info" variant="outlined">No captive policies to price.</Alert>;

  const pols = model.policies;
  const n = pols.length;
  const gp = grossPremium(pols);
  const cr = combinedRatio(pols);
  const ca = capitalAdequacy(model.capital, pols);
  const withinBand = cr <= model.combined_ratio_ceiling;
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
            The Research Brain pulls each line&rsquo;s loss experience, builds the combined ratio against the
            {' '}{pct(model.combined_ratio_ceiling)} underwriting ceiling, and checks the {ca.toFixed(2)}× capital
            position against the {model.capital_adequacy_floor.toFixed(2)}× solvency floor — anchored to the
            {' '}{model.benchmark_id} band. The premium decision is yours.
          </Typography>
          <Box>
            <Button
              variant="contained"
              disabled={g.preparing}
              startIcon={g.preparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void g.prepare({ summary: `Priced ${n} captive lines (${formatCurrency(gp, model.currency, true)} gross premium); loss ratio ${pct(lossRatio(pols))}, combined ratio ${pct(cr)} (ceiling ${pct(model.combined_ratio_ceiling)}), capital adequacy ${ca.toFixed(2)}×. Review and submit are yours.` })}
            >
              {g.preparing ? 'Preparing…' : 'Run Research Brain preparation'}
            </Button>
          </Box>
        </Stack>
      );
    }
    if (step.key === 'setPremium') {
      return (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2">Combined ratio <b>{pct(cr)}</b> on {formatCurrency(gp, model.currency, true)} gross premium · capital {ca.toFixed(2)}×</Typography>
            <ProvenanceChip source={`${model.benchmark_id} underwriting`} tooltip="Backed by the OTP-25 benchmark" onClick={() => navigate('/process/OTP-25/overview')} />
          </Stack>
          <Alert severity={withinBand ? 'success' : 'warning'} variant="outlined">
            {withinBand
              ? `Combined ratio ${pct(cr)} sits below the ${pct(model.combined_ratio_ceiling)} ceiling — defensible against the ${model.benchmark_id} underwriting band.`
              : `Combined ratio ${pct(cr)} exceeds the ${pct(model.combined_ratio_ceiling)} ceiling — the captive is underpriced; expect scrutiny and document the basis.`}
          </Alert>
          <PolicyTable model={model} />
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <Typography variant="body2">
          Set the captive premiums on <b>{n}</b> lines ({formatCurrency(gp, model.currency, true)} gross premium,
          {' '}combined ratio {pct(cr)}, capital adequacy {ca.toFixed(2)}×). Submitting routes them to maker-checker review.
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

export const otp8: ProcessBinding = { kpis: Kpis, tabs: { overview: Wizard, inputs: Policies } };
