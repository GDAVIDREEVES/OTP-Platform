import { Box, Stack, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { tokens } from '@/shared/theme';
import type { StepDef } from '@/kernel/registry/types';

/** Persistent "you are here": where am I, what's done, what's next. Assistant
 *  steps are marked so the AI's stretch of the path is legible. */
export default function StepIndicator({ steps, current }: { steps: StepDef[]; current: number }) {
  return (
    <Box>
      <Typography variant="overline" sx={{ color: 'text.secondary' }}>
        Step {current + 1} of {steps.length} · {steps[current]?.label}
      </Typography>
      <Stack direction="row" alignItems="flex-start" sx={{ mt: 0.5 }}>
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          const assist = s.actor === 'assistant';
          const dot = active ? (assist ? tokens.assist : tokens.action) : done ? tokens.ok : '#CBD5E1';
          return (
            <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : '0 0 auto' }}>
              <Stack alignItems="center" spacing={0.5} sx={{ minWidth: 88 }}>
                <Box
                  sx={{
                    width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 13, bgcolor: dot,
                  }}
                >
                  {done ? <CheckIcon sx={{ fontSize: 16 }} /> : i + 1}
                </Box>
                <Typography variant="caption" sx={{ fontWeight: active ? 700 : 500, color: active ? 'text.primary' : 'text.secondary', textAlign: 'center', lineHeight: 1.15 }}>
                  {s.label}
                  {assist && (
                    <Box component="span" sx={{ display: 'block', fontSize: 9, fontWeight: 700, color: tokens.assist }}>
                      AI-assisted
                    </Box>
                  )}
                </Typography>
              </Stack>
              {i < steps.length - 1 && (
                <Box sx={{ flex: 1, height: 2, bgcolor: i < current ? tokens.ok : '#E2E8F0', mx: 1, mb: 3 }} />
              )}
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
