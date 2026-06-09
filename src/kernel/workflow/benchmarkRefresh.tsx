/**
 * "Benchmark refreshed — re-confirm" staleness flag.
 *
 * When OTP-25 refreshes a benchmarking set it fans out a handoff onto each
 * downstream rate's record_ref (loop 1.3). A consumer (OTP-3 royalty rate,
 * OTP-6 IC loan rate) detects that handoff by reading its own lineage feed —
 * any `handoff` event whose `after.from` is `OTP-25` means the set behind the
 * rate moved and the rate should be re-confirmed. No side table: this is just
 * the audit chain read back through `api.lineage`.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chip, Tooltip } from '@mui/material';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import { api } from '@/shared/api/client';

/** True once OTP-25 has handed off a benchmark refresh onto `recordRef`. */
export function useBenchmarkRefreshed(recordRef: string): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .lineage(recordRef)
      .then((feed) => {
        if (!alive) return;
        setStale(
          feed.some((e) => e.event_type === 'handoff' && e.after?.from === 'OTP-25'),
        );
      })
      .catch(() => alive && setStale(false));
    return () => {
      alive = false;
    };
  }, [recordRef]);
  return stale;
}

/** Amber re-confirm chip; clicking jumps to the rate's own wizard to re-run. */
export function BenchmarkRefreshedChip({ wizardRoute }: { wizardRoute: string }) {
  const navigate = useNavigate();
  return (
    <Tooltip title="The backing benchmarking set was refreshed in OTP-25 — re-confirm this rate against the new range." arrow>
      <Chip
        size="small"
        icon={<AutorenewIcon sx={{ fontSize: 14 }} />}
        label="Benchmark refreshed — re-confirm"
        onClick={() => navigate(wizardRoute)}
        sx={{
          height: 22,
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          bgcolor: '#FEF3C7',
          color: '#92400E',
          '& .MuiChip-icon': { color: '#D97706' },
        }}
      />
    </Tooltip>
  );
}
