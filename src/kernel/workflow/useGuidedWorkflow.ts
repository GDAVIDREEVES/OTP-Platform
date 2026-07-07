import { useState } from 'react';
import { api } from '@/shared/api/client';
import { useToast } from '@/shared/providers/DataProvider';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useRefreshSignals } from '@/shared/providers/WorkSignalsProvider';
import { useReviewHandoff } from '@/kernel/review/ReviewHandoff';
import type { StepDef } from '@/kernel/registry/types';
import { useWorkflowState } from './useWorkflowState';

/** Shared scaffolding for a guided path that ends in maker-checker review:
 *  draft state + autosave, an agentic prepare (logs the assisted event), and a
 *  gated submit that enqueues a review item (which logs "submitted"). */
export function useGuidedWorkflow(processId: string, recordRef: string, steps: StepDef[]) {
  const user = useSessionUser();
  const toast = useToast();
  const refreshSignals = useRefreshSignals();
  const { notifySubmitted } = useReviewHandoff();
  const wf = useWorkflowState(processId, recordRef, user.id, steps);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const prepare = async (extra?: Record<string, unknown>) => {
    setPreparing(true);
    try {
      const res = await api.researchBrainPrepare({ process_id: processId, record_ref: recordRef, ...(extra || {}) });
      wf.patchPayload({ prepared: true, rbSummary: res.summary });
    } catch (e) {
      toast.show(`Prep failed: ${String(e)}`, 'error');
    } finally {
      setPreparing(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.enqueueReview({ process_id: processId, record_ref: recordRef, maker: user.id });
      await wf.clearDraft();
      setSubmitted(true);
      void refreshSignals(); // bell badge / home Command Center / My work
      notifySubmitted({ recordRef, processId });
    } catch (e) {
      toast.show(`Submit failed: ${String(e)}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return { wf, user, preparing, submitting, submitted, prepare, submit };
}
