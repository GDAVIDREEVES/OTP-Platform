import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Chip, Stack, Typography } from '@mui/material';

export interface RunsAsProcessRef {
  /** OTP id, e.g. `OTP-3`. */
  id: string;
  /** Chip label, e.g. `OTP-3 · royalty`. */
  label: string;
}

interface RunsAsProcessBannerProps {
  /** Leading sentence, e.g. "Price setting runs as guided processes…". */
  note: string;
  /** Guided processes this de-navved page defers to; each chip deep-links to
   *  `/process/{id}/overview`. */
  processes: RunsAsProcessRef[];
}

/** Shared "this de-navved page also runs as guided processes" banner. Used by
 *  the read-only reference views (Segmented P&L, Price Setting, Royalties) so
 *  they consistently point back at the canonical process shell. */
const RunsAsProcessBanner: FC<RunsAsProcessBannerProps> = ({ note, processes }) => {
  const navigate = useNavigate();
  return (
    <Alert severity="info" variant="outlined" sx={{ mb: 2.5, alignItems: 'center' }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {note}
        </Typography>
        {processes.map((p) => (
          <Chip
            key={p.id}
            size="small"
            label={p.label}
            onClick={() => navigate(`/process/${p.id}/overview`)}
            sx={{ cursor: 'pointer', fontWeight: 600 }}
          />
        ))}
      </Stack>
    </Alert>
  );
};

export default RunsAsProcessBanner;
