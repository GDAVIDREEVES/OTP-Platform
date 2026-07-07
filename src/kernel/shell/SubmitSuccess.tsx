import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Stack } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

interface Props {
  /** The binding's specific success message (kept per-process). */
  message: ReactNode;
  /** Record ref for the evidence packet; when set, an Evidence button appears. */
  recordRef?: string;
  /** The process whose audit trail this record lives on. */
  processId: string;
  /** Optional "back to …" affordance rendered as the primary next step. */
  backTo?: { label: string; path: string };
}

/**
 * The persistent post-submit panel: one success Alert plus the canonical button
 * row — **Evidence · Audit · Review queue · Back**. Every maker-checker submit
 * across the marquee bindings renders the identical row, so the affordances are
 * predictable regardless of which process the user came from.
 *
 * This coexists with the ReviewHandoff dialog (a one-time next-step nudge fired
 * on submit): the dialog points forward, this panel persists the evidence/audit
 * links. SubmitSuccess never enqueues review or notifies — callers do that
 * before rendering it.
 */
export default function SubmitSuccess({ message, recordRef, processId, backTo }: Props) {
  const navigate = useNavigate();
  return (
    <Stack spacing={2} sx={{ maxWidth: 760 }}>
      <Alert icon={<CheckCircleIcon />} severity="success">
        {message}
      </Alert>
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1 }}>
        {recordRef && (
          <Button variant="outlined" onClick={() => navigate(`/evidence/${encodeURIComponent(recordRef)}`)}>
            Evidence
          </Button>
        )}
        <Button variant="outlined" onClick={() => navigate(`/process/${processId}/audit`)}>
          Audit
        </Button>
        <Button variant="outlined" onClick={() => navigate('/review')}>
          Review queue
        </Button>
        {backTo && (
          <Button variant="contained" onClick={() => navigate(backTo.path)}>
            {backTo.label}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
