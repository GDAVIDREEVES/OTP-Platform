/**
 * CloseCommandCenter — the live close-cycle stepper on the home page.
 *
 * Replaces the hardcoded lifecycle stepper: every step (order, label, status,
 * owner, route, detail) comes from GET /api/close/status via
 * WorkSignalsProvider — the backend observes the platform's real signals,
 * this component only renders them. Dot color is meaning-coded via the
 * shared tokens (green = done, blue = in flight, red = needs a human).
 */

import { useNavigate } from 'react-router-dom';
import { Box, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { useCloseStatus } from '@/shared/providers/WorkSignalsProvider';
import { useSession } from '@/shared/providers/SessionProvider';
import { tokens } from '@/shared/theme';
import type { CloseStep } from '@/shared/api/types';

const STATUS_COLOR: Record<CloseStep['status'], string> = {
  complete: tokens.ok,
  active: tokens.action,
  attention: tokens.risk,
  pending: '#CBD5E1',
};

export default function CloseCommandCenter() {
  const navigate = useNavigate();
  const close = useCloseStatus();
  const { users } = useSession();

  if (!close) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="overline" sx={{ color: 'text.secondary' }}>Close cycle</Typography>
        <LinearProgress sx={{ mt: 1.5, height: 4, borderRadius: 2 }} />
      </Paper>
    );
  }

  /** Persona name for a step owner; `shared` steps belong to everyone. */
  const ownerLabel = (owner: CloseStep['owner']): string =>
    owner === 'shared' ? 'All roles' : users.find((u) => u.role === owner)?.name ?? owner;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="overline" sx={{ color: 'text.secondary' }}>
        Close cycle · FY{close.year}
      </Typography>
      <Stack direction="row" alignItems="flex-start" sx={{ mt: 0.5, flexWrap: 'wrap' }}>
        {close.steps.map((step, i) => {
          const complete = step.status === 'complete';
          // Active + attention steps get the visual spotlight (bold label +
          // the one-line detail); `current_index` agrees with this by design.
          const spotlight = step.status === 'active' || step.status === 'attention';
          const color = STATUS_COLOR[step.status];
          return (
            <Box key={step.id} sx={{ display: 'flex', alignItems: 'flex-start', flex: i < close.steps.length - 1 ? 1 : '0 0 auto', minWidth: 0 }}>
              <Stack
                spacing={0.25}
                onClick={() => navigate(step.route)}
                sx={{ minWidth: 0, cursor: 'pointer', borderRadius: 1, p: 0.5, '&:hover': { bgcolor: '#F1F5F9' } }}
              >
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                  <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                    {complete ? <CheckRoundedIcon sx={{ fontSize: 15 }} /> : i + 1}
                  </Box>
                  <Typography variant="body2" noWrap sx={{ fontWeight: spotlight ? 700 : 500, color: spotlight ? 'text.primary' : 'text.secondary' }}>{step.label}</Typography>
                  {step.id === 'waterfall' && (
                    <Typography variant="caption" noWrap sx={{ color: 'text.secondary' }}>
                      · {close.basis.mode === 'post_charge' ? 'post-charge' : 'base'}
                    </Typography>
                  )}
                </Stack>
                {spotlight && (
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ pl: '30px', minWidth: 0 }}>
                    <Chip size="small" label={ownerLabel(step.owner)} sx={{ height: 18, fontSize: 10, fontWeight: 700, flexShrink: 0 }} />
                    <Typography variant="caption" noWrap sx={{ color: 'text.secondary' }}>{step.detail}</Typography>
                  </Stack>
                )}
              </Stack>
              {i < close.steps.length - 1 && (
                // mt 15px centers the 2px rail on the dot row: 4px cell padding + 12px half-dot − 1px half-rail (revisit if the 24px dot changes).
                <Box sx={{ flex: 1, height: 2, bgcolor: complete ? tokens.ok : '#E2E8F0', mx: 1, mt: '15px' }} />
              )}
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}
