import { Box, Paper, Stack, Typography } from '@mui/material';
import PsychologyIcon from '@mui/icons-material/Psychology';
import PersonIcon from '@mui/icons-material/Person';
import { tokens } from '@/shared/theme';

/** Who owns a step in a cross-process lineage. Drives the marker's tone so a
 *  reader can tell at a glance what the assistant *prepared* from what a human
 *  *decided / posted*. */
export type ActorKind = 'assistant' | 'human';

const TONE: Record<
  ActorKind,
  { color: string; bg: string; border: string; icon: typeof PsychologyIcon; label: string; foot: string }
> = {
  assistant: {
    color: tokens.assist,
    bg: '#FAF5FF',
    border: tokens.assist,
    icon: PsychologyIcon,
    label: 'Research Brain (assisted)',
    foot:
      'Logged as a named actor, distinct from you, and reversible until posted. The assistant prepares; you decide, review, and post.',
  },
  human: {
    color: tokens.ink,
    bg: '#F8FAFC',
    border: '#E2E8F0',
    icon: PersonIcon,
    label: 'You (owned)',
    foot: 'Logged under your name as the accountable owner of this step.',
  },
};

/**
 * The visible boundary between what the assistant did and what the human owns,
 * generalized for any lineage step. `actorKind` selects the tone (assistant =
 * lavender, human = neutral); `title`/`foot` override the defaults when a step
 * needs its own narrative. `AgenticHandoffMarker` is the assistant-tone wrapper.
 */
export default function LineageMarker({
  summary,
  actorKind = 'assistant',
  title,
  foot,
}: {
  summary: string;
  actorKind?: ActorKind;
  title?: string;
  foot?: string;
}) {
  const t = TONE[actorKind];
  const Icon = t.icon;
  const showFoot = foot ?? t.foot;
  return (
    <Paper variant="outlined" sx={{ borderColor: t.border, bgcolor: t.bg, p: 2 }}>
      <Stack direction="row" spacing={1.5}>
        <Icon sx={{ color: t.color }} />
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: t.color }}>
            {title ?? t.label}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {summary}
          </Typography>
          {showFoot && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.75 }}>
              {showFoot}
            </Typography>
          )}
        </Box>
      </Stack>
    </Paper>
  );
}
