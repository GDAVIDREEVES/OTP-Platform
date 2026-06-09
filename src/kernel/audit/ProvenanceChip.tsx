import { Chip, Tooltip } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';

/** Provenance class of the number behind the chip:
 *  real = verifiable warehouse figure, assumed = illustrative input,
 *  fabricated = magnitude invented for the demo. Sourced from
 *  /api/catalog/provenance. */
export type ProvenanceKind = 'real' | 'assumed' | 'fabricated';

// Per-kind accent: neutral (real), amber (assumed), dashed violet (fabricated).
// `undefined` keeps the original default look (solid violet link icon).
const KIND_SX: Record<ProvenanceKind, SxProps<Theme>> = {
  real: {
    borderColor: '#CBD5E1',
    color: '#475569',
    '& .MuiChip-icon': { color: '#64748B' },
  },
  assumed: {
    borderColor: '#F59E0B',
    color: '#B45309',
    '& .MuiChip-icon': { color: '#F59E0B' },
  },
  fabricated: {
    borderStyle: 'dashed',
    borderColor: '#7C3AED',
    color: '#6D28D9',
    '& .MuiChip-icon': { color: '#7C3AED' },
  },
};

/** A figure's lineage marker — the difference between a number a reviewer must
 *  trust and one they can verify. Clicking drills to the source. Pass `kind`
 *  to colour the chip by provenance (real / assumed / fabricated). */
export default function ProvenanceChip({
  source,
  tooltip,
  onClick,
  kind,
}: {
  source: string;
  tooltip?: string;
  onClick?: () => void;
  kind?: ProvenanceKind;
}) {
  const chip = (
    <Chip
      size="small"
      icon={<LinkIcon sx={{ fontSize: 13 }} />}
      label={source}
      onClick={onClick}
      variant="outlined"
      sx={{
        height: 22,
        fontSize: 11,
        cursor: onClick ? 'pointer' : 'default',
        '& .MuiChip-icon': { color: '#7C3AED' },
        ...(kind ? KIND_SX[kind] : {}),
      }}
    />
  );
  return tooltip ? (
    <Tooltip title={tooltip} arrow>
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}
