import type { ReactNode } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import type { StepDef } from '@/kernel/registry/types';
import StepIndicator from './StepIndicator';

function timeAgo(iso: string): string {
  try {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  } catch {
    return '';
  }
}

/** Generic guided-path runner: a persistent step rail, one dominant action,
 *  and a final gated step that always ends in human submit. */
export default function WorkflowPath({
  steps,
  stepIndex,
  setStepIndex,
  canContinue,
  onComplete,
  completing,
  renderStep,
  lastSavedAt,
}: {
  steps: StepDef[];
  stepIndex: number;
  setStepIndex: (i: number) => void;
  canContinue: boolean;
  onComplete: () => void;
  completing?: boolean;
  renderStep: (step: StepDef, index: number) => ReactNode;
  lastSavedAt?: string | null;
}) {
  const step = steps[stepIndex];
  const isGate = !!step?.gate;
  const handleContinue = () => {
    if (isGate) onComplete();
    else setStepIndex(stepIndex + 1);
  };
  return (
    <Stack spacing={2.5} sx={{ maxWidth: 880 }}>
      <StepIndicator steps={steps} current={stepIndex} />
      <Box>{renderStep(step, stepIndex)}</Box>
      <Stack direction="row" alignItems="center" spacing={1.5}>
        {stepIndex > 0 && (
          <Button onClick={() => setStepIndex(stepIndex - 1)} disabled={completing}>
            Back
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {lastSavedAt && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Draft saved {timeAgo(lastSavedAt)}
          </Typography>
        )}
        <Button variant="contained" size="large" onClick={handleContinue} disabled={!canContinue || completing}>
          {completing ? 'Submitting…' : isGate ? 'Submit for review' : 'Continue'}
        </Button>
      </Stack>
    </Stack>
  );
}
