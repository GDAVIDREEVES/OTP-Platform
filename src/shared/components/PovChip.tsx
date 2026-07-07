/**
 * PovChip — the point-of-view badge for any data-bearing surface.
 *
 * Normally a quiet outlined "FY{year}" echo of the global period selector
 * (tooltip carries the full POV, e.g. "FY2026 · Full Year"). But when a
 * surface is hard-pinned to a different fiscal year than the selector —
 * several consoles fetch with a fixed year — it turns into a warning chip
 * "Pinned FY{pinned} ≠ FY{global}" so nobody reads a 2026 number believing
 * it follows the 2025 selector. Zero fetches: reads the already-loaded period
 * from DataProvider via usePov().
 */
import type { FC } from 'react';
import { Chip, Tooltip } from '@mui/material';
import { usePov } from '@/shared/hooks/usePov';

interface Props {
  /** The fiscal year this surface is hard-coded to fetch, if any. When it
   *  differs from the global selector the chip flips to its warning state. */
  pinnedYear?: number | null;
  size?: 'small' | 'medium';
}

const PovChip: FC<Props> = ({ pinnedYear, size = 'small' }) => {
  const pov = usePov();
  const compact = size === 'small' ? { height: 20, fontSize: 11 } : undefined;

  if (pinnedYear != null && pinnedYear !== pov.year) {
    return (
      <Tooltip
        arrow
        title={`This surface is pinned to FY${pinnedYear}, but the global period selector is on ${pov.label}. The numbers here do NOT follow the selector.`}
      >
        <Chip
          size={size}
          color="warning"
          label={`Pinned FY${pinnedYear} ≠ FY${pov.year}`}
          sx={{ ...compact, fontWeight: 700 }}
        />
      </Tooltip>
    );
  }

  return (
    <Tooltip arrow title={`Point of view: ${pov.label}`}>
      <Chip size={size} variant="outlined" label={`FY${pov.year}`} sx={{ ...compact, fontWeight: 700 }} />
    </Tooltip>
  );
};

export default PovChip;
