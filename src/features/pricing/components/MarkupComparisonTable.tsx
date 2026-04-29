import {
  Box,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { markupData } from './mockData';

export default function MarkupComparisonTable() {
  const maxVal = Math.max(
    ...markupData.flatMap((cc) =>
      cc.products.flatMap((pp) => [Math.abs(pp.current), Math.abs(pp.proposed)]),
    ),
  );
  return (
    <Paper sx={{ p: 2.5 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Current price vs New price comparison
          </Typography>
          <Typography variant="caption" sx={{ color: '#64748B' }}>
            Markup % by country and product · FY21 Total
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <Box
              sx={{
                width: 12,
                height: 12,
                bgcolor: '#C4B5FD',
                borderRadius: 0.5,
              }}
            />
            <Typography variant="caption" sx={{ color: '#475569' }}>
              Current Markup
            </Typography>
          </Stack>
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <Box
              sx={{
                width: 12,
                height: 12,
                bgcolor: '#2563EB',
                borderRadius: 0.5,
              }}
            />
            <Typography variant="caption" sx={{ color: '#475569' }}>
              New Markup
            </Typography>
          </Stack>
        </Stack>
      </Stack>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 900 }}>
          <TableHead>
            <TableRow sx={{ bgcolor: '#F8FAFC' }}>
              <TableCell sx={{ fontWeight: 700, width: 140 }}>Country</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 120 }}>Product</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, width: 110 }}>
                Current %
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, width: 110 }}>
                New %
              </TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Comparison</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, width: 90 }}>
                Δ
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {markupData.flatMap((c) =>
              c.products.map((p, i) => {
                const delta = +(p.proposed - p.current).toFixed(1);
                const currentW = (Math.abs(p.current) / maxVal) * 100;
                const proposedW = (Math.abs(p.proposed) / maxVal) * 100;
                return (
                  <TableRow key={`${c.country}-${p.name}`} hover>
                    <TableCell sx={{ fontWeight: 700, color: '#0F172A' }}>
                      {i === 0 ? c.country : ''}
                    </TableCell>
                    <TableCell sx={{ color: '#475569' }}>{p.name}</TableCell>
                    <TableCell align="right">
                      {p.current.toFixed(1)}%
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {p.proposed.toFixed(1)}%
                    </TableCell>
                    <TableCell>
                      <Stack spacing={0.5}>
                        <Box
                          sx={{
                            width: `${currentW}%`,
                            height: 8,
                            bgcolor: '#C4B5FD',
                            borderRadius: 0.5,
                            minWidth: 4,
                          }}
                        />
                        <Box
                          sx={{
                            width: `${proposedW}%`,
                            height: 8,
                            bgcolor: '#2563EB',
                            borderRadius: 0.5,
                            minWidth: 4,
                          }}
                        />
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Stack
                        direction="row"
                        spacing={0.25}
                        alignItems="center"
                        justifyContent="flex-end"
                      >
                        {delta >= 0 ? (
                          <TrendingUpIcon
                            sx={{ fontSize: 14, color: '#16A34A' }}
                          />
                        ) : (
                          <TrendingDownIcon
                            sx={{ fontSize: 14, color: '#DC2626' }}
                          />
                        )}
                        <Typography
                          variant="caption"
                          sx={{
                            fontWeight: 700,
                            color: delta >= 0 ? '#16A34A' : '#DC2626',
                          }}
                        >
                          {delta >= 0 ? '+' : ''}
                          {delta}
                        </Typography>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              }),
            )}
          </TableBody>
        </Table>
      </Box>
    </Paper>
  );
}
