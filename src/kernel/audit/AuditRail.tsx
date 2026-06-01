import { Box, Chip, IconButton, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { tokens } from '@/shared/theme';
import type { ProcessDef } from '@/kernel/registry/types';
import { useAudit } from './useAudit';

/** Persistent, collapsible "audit one glance away" rail — shell-owned, so every
 *  module surfaces recent activity without leaving the screen. */
export default function AuditRail({ def, onClose }: { def: ProcessDef; onClose: () => void }) {
  const { events } = useAudit({ processId: def.id });
  const recent = [...events].reverse().slice(0, 12);
  return (
    <Box
      sx={{
        width: { xs: '100%', md: 300 }, flexShrink: 0, border: '1px solid', borderColor: 'divider',
        borderRadius: 2, p: 1.5, bgcolor: '#FCFCFD', position: { md: 'sticky' }, top: { md: 88 },
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="overline" sx={{ color: 'text.secondary', flex: 1 }}>Audit &amp; provenance</Typography>
        <IconButton size="small" onClick={onClose} aria-label="Close audit rail"><CloseIcon fontSize="small" /></IconButton>
      </Stack>
      {recent.length === 0 ? (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          No events yet for {def.id}. The trail fills automatically as work happens.
        </Typography>
      ) : (
        recent.map((e) => (
          <Box key={e.id} sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Chip size="small" label={e.event_type} sx={{ height: 18, fontSize: 10, fontWeight: 700, textTransform: 'capitalize' }} />
              <Typography variant="caption" sx={{ fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.actor}
                {e.actor_kind === 'assistant' && (
                  <Box component="span" sx={{ color: tokens.assist, fontWeight: 700 }}> · AI</Box>
                )}
              </Typography>
            </Stack>
            {e.rationale && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.rationale}
              </Typography>
            )}
          </Box>
        ))
      )}
    </Box>
  );
}
