import { useState } from 'react';
import { api } from '@/shared/api/client';
import { useToast } from '@/shared/providers/DataProvider';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import type { MdProposal } from '@/shared/api/types';

export function useMappingWorkflow(onChange?: () => void) {
  const user = useSessionUser();
  const toast = useToast();
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
      toast.show('Submitted for review', 'success');
      onChange?.();
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
    } catch (e) {
      toast.show(`Approve failed (maker cannot self-approve): ${String(e)}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return { busyId, proposal, propose, submit, approve, user };
}
