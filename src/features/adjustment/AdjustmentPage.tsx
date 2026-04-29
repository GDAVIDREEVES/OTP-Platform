import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Breadcrumbs,
  Button,
  Divider,
  Link as MuiLink,
  Paper,
  Snackbar,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';
import PsychologyIcon from '@mui/icons-material/Psychology';
import AppShell from '@/shared/components/layout/AppShell';
import { useEntity, useSettings } from '@/shared/providers/DataProvider';
import { useJournalEntries } from '@/shared/hooks/useJournalEntries';
import { useSubmitAdjustment } from '@/shared/hooks/useSubmitAdjustment';
import { useResearchBrain } from '@/features/research-brain/ResearchBrainContext';
import MethodSelectionStep, {
  type AdjustmentMode,
} from './components/MethodSelectionStep';
import ReviewStep from './components/ReviewStep';
import SubmittedStep from './components/SubmittedStep';

export default function Adjustment() {
  const { id } = useParams();
  const navigate = useNavigate();
  const e = useEntity(id);
  const journal = useJournalEntries({ entity: id, limit: 25 });
  const settings = useSettings();
  const { submit, pending: submitting } = useSubmitAdjustment();
  const { openPanel } = useResearchBrain();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<AdjustmentMode>('median');
  const [customMargin, setCustomMargin] = useState(4);
  const [submitted, setSubmitted] = useState(false);

  if (!e)
    return (
      <AppShell pageTitle="Entity not found">
        <Paper sx={{ p: 3 }}>Entity {id} not found.</Paper>
      </AppShell>
    );

  const median = (e.targetMarginLow + e.targetMarginHigh) / 2;
  const actual = e.actualMargin ?? 0;
  const targetMargin =
    mode === 'median'
      ? median
      : mode === 'upper'
      ? e.targetMarginHigh
      : customMargin;
  const adjustmentAmount = Math.round(
    e.ytdVolume * ((actual - targetMargin) / 100),
  );

  const handleSubmit = async () => {
    const result = await submit({
      entityId: e.id,
      entityName: e.name,
      amount: Math.abs(adjustmentAmount),
      currency: e.currency || 'USD',
      mode,
      targetMargin,
      actualMargin: actual,
      notes: mode === 'custom' ? `Custom target ${customMargin}%` : undefined,
      submittedBy: settings.defaultReviewer || 'You',
    });
    if (result) {
      setSubmitted(true);
      setStep(2);
    }
  };

  return (
    <AppShell pageTitle={`Adjustment — ${e.id}`}>
      <Breadcrumbs sx={{ mb: 2, fontSize: 13 }}>
        <MuiLink
          underline="hover"
          color="inherit"
          onClick={() => navigate('/dashboard')}
          sx={{ cursor: 'pointer' }}
        >
          Dashboard
        </MuiLink>
        <MuiLink
          underline="hover"
          color="inherit"
          onClick={() => navigate(`/entities/${e.id}`)}
          sx={{ cursor: 'pointer' }}
        >
          {e.id}
        </MuiLink>
        <Typography variant="body2" sx={{ color: '#0F172A', fontWeight: 600 }}>
          Adjustment
        </Typography>
      </Breadcrumbs>

      <Paper sx={{ p: 3, mb: 2.5 }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ mb: 2 }}
        >
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Propose year-end adjustment
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748B' }}>
              Bring {e.name} within the arm's length range.
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={<PsychologyIcon />}
            onClick={() =>
              openPanel({
                entityId: e.id,
                entityName: e.name,
                jurisdiction: e.country,
                function: e.function,
                method: e.tpMethod,
                transactionType: 'Tangible Goods',
              })
            }
          >
            Ask Research Brain
          </Button>
        </Stack>

        <Stepper activeStep={step} sx={{ mb: 3 }}>
          <Step>
            <StepLabel>Select method</StepLabel>
          </Step>
          <Step>
            <StepLabel>Review & confirm</StepLabel>
          </Step>
          <Step>
            <StepLabel>Submit for approval</StepLabel>
          </Step>
        </Stepper>

        {step === 0 && (
          <MethodSelectionStep
            entity={e}
            mode={mode}
            setMode={setMode}
            customMargin={customMargin}
            setCustomMargin={setCustomMargin}
            median={median}
            actual={actual}
            targetMargin={targetMargin}
            adjustmentAmount={adjustmentAmount}
            journal={journal}
          />
        )}

        {step === 1 && (
          <ReviewStep entity={e} adjustmentAmount={adjustmentAmount} />
        )}

        {step === 2 && <SubmittedStep />}

        {step < 2 && (
          <>
            <Divider sx={{ my: 3 }} />
            <Stack direction="row" justifyContent="space-between">
              <Button
                onClick={() =>
                  step === 0
                    ? navigate(`/entities/${e.id}`)
                    : setStep((s) => s - 1)
                }
              >
                {step === 0 ? 'Cancel' : 'Back'}
              </Button>
              <Button
                variant="contained"
                disabled={submitting}
                onClick={async () => {
                  if (step === 1) {
                    await handleSubmit();
                  } else {
                    setStep((s) => s + 1);
                  }
                }}
              >
                {submitting
                  ? 'Submitting…'
                  : step === 1
                  ? 'Submit for approval'
                  : 'Continue'}
              </Button>
            </Stack>
          </>
        )}
      </Paper>

      <Snackbar
        open={submitted}
        autoHideDuration={4000}
        onClose={() => setSubmitted(false)}
        message="Adjustment submitted to Tax Director for approval"
      />
    </AppShell>
  );
}
