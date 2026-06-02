import { useCallback, useEffect, useState } from 'react';
import { api } from '@/shared/api/client';
import type { AuditEvent, ChainVerify } from '@/shared/api/types';

/** Read the audit stream for a record and/or process, with on-demand chain
 *  verification. */
export function useAudit(params: { recordRef?: string; processId?: string }) {
  const { recordRef, processId } = params;
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [verify, setVerify] = useState<ChainVerify | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await api.audit({ record_ref: recordRef, process_id: processId }));
    } finally {
      setLoading(false);
    }
  }, [recordRef, processId]);

  useEffect(() => {
    let alive = true;
    void api
      .audit({ record_ref: recordRef, process_id: processId })
      .then((e) => alive && setEvents(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [recordRef, processId]);

  const runVerify = useCallback(async () => {
    setVerify(await api.auditVerify());
  }, []);

  return { events, loading, refresh, verify, runVerify };
}
