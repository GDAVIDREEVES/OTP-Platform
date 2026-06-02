import { Chip, Tooltip } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';

/** A figure's lineage marker — the difference between a number a reviewer must
 *  trust and one they can verify. Clicking drills to the source. */
export default function ProvenanceChip({
  source,
  tooltip,
  onClick,
}: {
  source: string;
  tooltip?: string;
  onClick?: () => void;
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
