import { Box, Chip, Stack, Typography } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import type { ProcessDef } from '../registry/types';
import { FALLBACK_CATALOG } from '../registry/fallback';

const APPLIC: Record<string, string> = { H: 'High applicability', M: 'Medium applicability', L: 'Low applicability' };

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
      <Box component="span" sx={{ color: '#475569', fontWeight: 700 }}>{label}:</Box> {value}
    </Typography>
  );
}

/** The invariant identity header — the same anatomy on all 50 modules. */
export default function ProcessHeader({ def }: { def: ProcessDef }) {
  const catLabel = FALLBACK_CATALOG.categories[def.category] ?? def.category;
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75, flexWrap: 'wrap', gap: 1 }}>
        <Chip label={def.id} size="small" sx={{ fontWeight: 800, bgcolor: '#0F172A', color: 'white' }} />
        <Chip label={`${def.category} · ${catLabel}`} size="small" variant="outlined" />
        {def.top15 && (
          <Chip
            icon={<StarIcon sx={{ fontSize: 14, color: '#B45309 !important' }} />}
            label="Top 15"
            size="small"
            sx={{ bgcolor: '#FEF3C7', color: '#B45309', fontWeight: 700 }}
          />
        )}
        <Chip label={APPLIC[def.pharmaApplicability] ?? def.pharmaApplicability} size="small" variant="outlined" />
      </Stack>
      <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.01em' }}>
        {def.name}
      </Typography>
      <Stack direction="row" spacing={2} sx={{ mt: 0.75, flexWrap: 'wrap', gap: 1.5 }}>
        <Meta label="OECD" value={def.oecdAnchor} />
        <Meta label="Owner" value={def.ownerFunction} />
        <Meta label="Cadence" value={def.cadence} />
        <Meta label="Pattern" value={def.pattern} />
      </Stack>
    </Box>
  );
}
