import { Box, Paper, Stack, Typography } from '@mui/material';
import PsychologyIcon from '@mui/icons-material/Psychology';
import { tokens } from '@/shared/theme';

/** The visible boundary between what the AI did and what the human owns. */
export default function AgenticHandoffMarker({ summary }: { summary: string }) {
  return (
    <Paper variant="outlined" sx={{ borderColor: tokens.assist, bgcolor: '#FAF5FF', p: 2 }}>
      <Stack direction="row" spacing={1.5}>
        <PsychologyIcon sx={{ color: tokens.assist }} />
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: tokens.assist }}>
            Research Brain (assisted)
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {summary}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.75 }}>
            Logged as a named actor, distinct from you, and reversible until posted. The assistant
            prepares; you decide, review, and post.
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}
