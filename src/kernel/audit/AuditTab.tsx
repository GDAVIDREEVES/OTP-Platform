import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import GppGoodIcon from '@mui/icons-material/GppGood';
import { tokens } from '@/shared/theme';
import type { ProcessDef } from '@/kernel/registry/types';
import type { AuditEvent } from '@/shared/api/types';
import { useAudit } from './useAudit';

const fmtTs = (ts: string) => {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
};

function EventRow({ e }: { e: AuditEvent }) {
  const assisted = e.actor_kind === 'assistant';
  return (
    <Box sx={{ display: 'flex', gap: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', alignItems: 'flex-start' }}>
      <Chip size="small" label={e.event_type} sx={{ fontWeight: 700, textTransform: 'capitalize', minWidth: 92 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{e.actor}</Typography>
          {assisted && (
            <Chip size="small" label="assisted" sx={{ height: 18, fontSize: 10, fontWeight: 700, bgcolor: '#EDE9FE', color: tokens.assist }} />
          )}
        </Stack>
        {e.rationale && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{e.rationale}</Typography>
        )}
        <Typography variant="caption" sx={{ display: 'block', color: '#94A3B8' }}>{e.record_ref}</Typography>
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{fmtTs(e.ts)}</Typography>
    </Box>
  );
}

/** Shell-owned Audit tab: the append-only stream for this process, newest
 *  first, with one-click chain verification. Identical on all 50 modules. */
export default function AuditTab({ def }: { def: ProcessDef }) {
  const { events, loading, verify, runVerify } = useAudit({ processId: def.id });
  if (loading) return null;
  return (
    <Stack spacing={2} sx={{ maxWidth: 860 }}>
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Append-only event stream</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" startIcon={<GppGoodIcon />} onClick={() => void runVerify()}>
          Verify integrity
        </Button>
        {verify && (
          <Chip size="small" color={verify.ok ? 'success' : 'error'} label={verify.ok ? 'Chain intact' : `Broken @ ${verify.broken_at}`} />
        )}
      </Stack>
      {events.length === 0 ? (
        <Alert severity="info" variant="outlined">
          No events recorded for {def.id} yet. The trail is a by-product of the work —
          events (created, submitted, reviewed, approved, posted) are written
          automatically, never as a separate step.
        </Alert>
      ) : (
        <Box>
          {[...events].reverse().map((e) => (
            <EventRow key={e.id} e={e} />
          ))}
        </Box>
      )}
    </Stack>
  );
}
