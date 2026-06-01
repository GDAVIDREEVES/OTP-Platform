import { Box, Paper, Stack, Typography } from '@mui/material';
import { tokens } from '@/shared/theme';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import type { KpiItem, KpiTone } from '../bindings/types';

const toneColor = (tone?: KpiTone): string =>
  tone === 'ok'
    ? tokens.ok
    : tone === 'watch'
      ? tokens.watch
      : tone === 'risk'
        ? tokens.risk
        : tokens.ink;

/** Answer-first KPI strip: the conclusion before the detail. */
export default function KpiStrip({ items }: { items: KpiItem[] }) {
  if (!items.length) return null;
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2 }}>
      {items.map((k) => (
        <Paper
          key={k.key}
          variant="outlined"
          sx={{ px: 2.5, py: 1.75, minWidth: 170, flex: '1 1 170px' }}
        >
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}
          >
            {k.label}
          </Typography>
          <Typography
            sx={{ fontSize: 26, fontWeight: 800, lineHeight: 1.2, color: toneColor(k.tone), fontVariantNumeric: 'tabular-nums' }}
          >
            {k.value}
          </Typography>
          {k.hint && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              {k.hint}
            </Typography>
          )}
          {k.provenance && (
            <Box sx={{ mt: 0.5 }}>
              <ProvenanceChip source={k.provenance} tooltip="Source lineage" />
            </Box>
          )}
        </Paper>
      ))}
    </Stack>
  );
}
