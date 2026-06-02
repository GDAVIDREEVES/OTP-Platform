import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/shared/api/client';
import type { StepDef } from '@/kernel/registry/types';

/** Drives a guided workflow's position + working state, persisting it as a
 *  draft so leaving never loses progress and returning resumes the exact step. */
export function useWorkflowState(
  processId: string,
  recordRef: string,
  userId: string,
  steps: StepDef[],
) {
  const [stepIndex, setStepIndex] = useState(0);
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [loaded, setLoaded] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const draftId = useRef<number | null>(null);

  // Resume from an existing draft, or start fresh.
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    api
      .draft(processId, recordRef, userId)
      .then((d) => {
        if (!alive) return;
        draftId.current = d.id;
        setStepIndex(Math.min(d.step_index, steps.length - 1));
        setPayload(d.payload || {});
        setLastSavedAt(d.updated_at);
      })
      .catch(() => {
        if (!alive) return;
        draftId.current = null;
        setStepIndex(0);
        setPayload({});
      })
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processId, recordRef, userId]);

  // Debounced autosave after the initial load.
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    const t = window.setTimeout(() => {
      api
        .putDraft({
          user_id: userId,
          process_id: processId,
          record_ref: recordRef,
          step: steps[stepIndex]?.key ?? '',
          step_index: stepIndex,
          payload,
        })
        .then((d) => {
          if (!alive) return;
          draftId.current = d.id;
          setLastSavedAt(d.updated_at);
        })
        .catch(() => {});
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, stepIndex, payload]);

  const patchPayload = useCallback(
    (patch: Record<string, unknown>) => setPayload((p) => ({ ...p, ...patch })),
    [],
  );

  const clearDraft = useCallback(async () => {
    if (draftId.current != null) {
      try {
        await api.deleteDraft(draftId.current);
      } catch {
        /* best effort */
      }
    }
  }, []);

  return { stepIndex, setStepIndex, payload, patchPayload, loaded, lastSavedAt, clearDraft };
}
