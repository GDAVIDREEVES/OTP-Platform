import { useState } from 'react';
import { api } from '@/shared/api/client';
import { useToast } from '@/shared/providers/DataProvider';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useRefreshSignals } from '@/shared/providers/WorkSignalsProvider';
import { useReviewHandoff } from '@/kernel/review/ReviewHandoff';
import type { MdProposal } from '@/shared/api/types';

export function useMappingWorkflow(onChange?: () => void) {
  const user = useSessionUser();
  const toast = useToast();
  const refreshSignals = useRefreshSignals();
  const { notifySubmitted } = useReviewHandoff();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Record<string, MdProposal>>({});

  const propose = async (id: string) => {
    setBusyId(id);
    try {
      const p = await api.mdPropose(id);
      setProposal((m) => ({ ...m, [id]: p }));
    } catch (e) {
      toast.show(`Propose failed: ${String(e)}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const submit = async (id: string) => {
    setBusyId(id);
    try {
      await api.mdSubmitMapping(id, user.id);
      onChange?.();
      void refreshSignals(); // master_data close step / review counts
      notifySubmitted({ recordRef: `mdmap:${id}`, label: `SAP mapping ${id}` });
    } catch (e) {
      toast.show(`Submit failed: ${String(e)}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const approve = async (id: string) => {
    setBusyId(id);
    try {
      await api.mdApproveMapping(id, user.id);
      toast.show('Approved & applied — audited', 'success');
      onChange?.();
      void refreshSignals(); // master_data close step / review counts
    } catch (e) {
      toast.show(`Approve failed (maker cannot self-approve): ${String(e)}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return { busyId, proposal, propose, submit, approve, user };
}
