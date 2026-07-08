import {
  Box,
  Button,
  Chip,
  Divider,
  Link as MuiLink,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useNavigate } from 'react-router-dom';
import { adjustmentRoute } from '@/kernel/workflow/originRoute';
import type { Entity } from '@/shared/types/entity';
import { statusColor, statusLabel } from '@/shared/utils/status';
import { formatCurrency } from '@/shared/utils/format';

interface EntityTableProps {
  entities: Entity[];
  visible: Entity[];
  filterOutOfRange: boolean;
  setFilterOutOfRange: (value: boolean | ((prev: boolean) => boolean)) => void;
}

export default function EntityTable({
  entities,
  visible,
  filterOutOfRange,
  setFilterOutOfRange,
}: EntityTableProps) {
  const navigate = useNavigate();
  return (
    <Paper sx={{ p: 2.5, mb: 2.5 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Entity Summary
          </Typography>
          <Typography variant="caption" sx={{ color: '#64748B' }}>
            {filterOutOfRange
              ? 'Showing entities out of range only'
              : 'Top flagged and representative entities'}
          </Typography>
        </Box>
        {filterOutOfRange && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => setFilterOutOfRange(false)}
          >
            Clear filter
          </Button>
        )}
      </Stack>

      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 900 }}>
          <TableHead>
            <TableRow>
              <TableCell>Entity ID</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Country</TableCell>
              <TableCell>Function</TableCell>
              <TableCell>TP Method</TableCell>
              <TableCell align="right">YTD Volume</TableCell>
              <TableCell align="right">Actual</TableCell>
              <TableCell align="right">Target</TableCell>
              <TableCell align="right">Variance</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Last Updated</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((e) => (
              <TableRow key={e.id} hover>
                <TableCell sx={{ fontWeight: 700 }}>{e.id}</TableCell>
                <TableCell>{e.name}</TableCell>
                <TableCell>{e.countryCode}</TableCell>
                <TableCell>{e.function}</TableCell>
                <TableCell>{e.tpMethod}</TableCell>
                <TableCell
                  align="right"
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatCurrency(e.ytdVolume, 'USD', true)}
                </TableCell>
                <TableCell
                  align="right"
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {e.actualMargin !== null ? `${e.actualMargin}%` : '—'}
                </TableCell>
                <TableCell
                  align="right"
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {e.targetMarginLabel}
                </TableCell>
                <TableCell
                  align="right"
                  sx={{
                    fontVariantNumeric: 'tabular-nums',
                    color: e.variance && e.variance > 0 ? '#DC2626' : '#475569',
                    fontWeight: e.variance && e.variance > 0 ? 700 : 400,
                  }}
                >
                  {e.variance && e.variance > 0 ? `+${e.variance}pp` : '—'}
                </TableCell>
                <TableCell>
                  <Chip
                    label={statusLabel[e.status]}
                    size="small"
                    sx={{
                      bgcolor: `${statusColor[e.status]}18`,
                      color: statusColor[e.status],
                      fontWeight: 700,
                    }}
                  />
                </TableCell>
                <TableCell sx={{ color: '#64748B' }}>{e.lastUpdated}</TableCell>
                <TableCell align="right">
                  <Stack
                    direction="row"
                    spacing={0.5}
                    justifyContent="flex-end"
                  >
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => navigate(`/entities/${e.id}`)}
                    >
                      Review
                    </Button>
                    {e.status === 'out-of-range' && (
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => navigate(adjustmentRoute(e.id))}
                      >
                        Adjust
                      </Button>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <Divider sx={{ my: 1.5 }} />

      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="caption" sx={{ color: '#64748B' }}>
          Showing {visible.length} of {entities.length} entities
        </Typography>
        {filterOutOfRange && (
          <MuiLink
            component="button"
            underline="hover"
            sx={{ fontSize: 13, fontWeight: 600 }}
            onClick={() => setFilterOutOfRange(false)}
          >
            Show all entities{' '}
            <ArrowForwardIcon sx={{ fontSize: 14, verticalAlign: 'middle' }} />
          </MuiLink>
        )}
      </Stack>
    </Paper>
  );
}
