import {
  Alert,
  Box,
  Chip,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from '@mui/material';
import type { Entity } from '@/shared/types/entity';
import { formatCurrency } from '@/shared/utils/format';

interface ReviewStepProps {
  entity: Entity;
  adjustmentAmount: number;
}

export default function ReviewStep({ entity, adjustmentAmount }: ReviewStepProps) {
  return (
    <Box>
      <Alert severity="warning" sx={{ mb: 2 }}>
        This adjustment will generate invoice <b>INV-2025-1042</b> and route to
        Sam Rodriguez (Tax Director) for approval. A full audit trail will be
        recorded.
      </Alert>
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
              Adjustment summary
            </Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ color: '#64748B' }}>Payor</TableCell>
                  <TableCell align="right">{entity.id}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ color: '#64748B' }}>Payee</TableCell>
                  <TableCell align="right">IE-001</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ color: '#64748B' }}>Currency</TableCell>
                  <TableCell align="right">EUR</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ color: '#64748B' }}>Amount</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>
                    {formatCurrency(Math.abs(adjustmentAmount), 'USD')}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ color: '#64748B' }}>Posting period</TableCell>
                  <TableCell align="right">FY2025 — Dec 31</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
              Supporting documentation
            </Typography>
            <Stack spacing={1}>
              <Chip
                label="Firm TP Handbook — Ireland §7.2"
                size="small"
                sx={{ alignSelf: 'flex-start' }}
              />
              <Chip
                label="Irish TCA 1997, Part 35A"
                size="small"
                sx={{ alignSelf: 'flex-start' }}
              />
              <Chip
                label="OECD TP Guidelines 2022, Ch. I"
                size="small"
                sx={{ alignSelf: 'flex-start' }}
              />
              <Chip
                label="IE-002 Benchmark Study — FY2025"
                size="small"
                sx={{ alignSelf: 'flex-start' }}
              />
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
