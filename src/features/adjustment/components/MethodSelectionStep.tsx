import {
  Alert,
  Box,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import type { Entity } from '@/shared/types/entity';
import type { JournalEntryRow } from '@/shared/api/types';
import type { AsyncResult } from '@/shared/hooks/useAsync';
import { formatCurrency } from '@/shared/utils/format';

export type AdjustmentMode = 'median' | 'upper' | 'custom';

interface MethodSelectionStepProps {
  entity: Entity;
  mode: AdjustmentMode;
  setMode: (mode: AdjustmentMode) => void;
  customMargin: number;
  setCustomMargin: (value: number) => void;
  median: number;
  actual: number;
  targetMargin: number;
  adjustmentAmount: number;
  journal: AsyncResult<JournalEntryRow[]>;
}

export default function MethodSelectionStep({
  entity,
  mode,
  setMode,
  customMargin,
  setCustomMargin,
  median,
  actual,
  targetMargin,
  adjustmentAmount,
  journal,
}: MethodSelectionStepProps) {
  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={7}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Adjustment target
        </Typography>
        <RadioGroup
          value={mode}
          onChange={(ev) => setMode(ev.target.value as AdjustmentMode)}
        >
          <Paper variant="outlined" sx={{ p: 1.5, mb: 1 }}>
            <FormControlLabel
              value="median"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Adjust to median ({median}%)
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#64748B' }}>
                    Firm-recommended — aligns with most jurisdictions'
                    expectations.
                  </Typography>
                </Box>
              }
            />
          </Paper>
          <Paper variant="outlined" sx={{ p: 1.5, mb: 1 }}>
            <FormControlLabel
              value="upper"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Adjust to upper quartile ({entity.targetMarginHigh}%)
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#64748B' }}>
                    Smaller adjustment; still within defensible range.
                  </Typography>
                </Box>
              }
            />
          </Paper>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <FormControlLabel
              value="custom"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Custom target
                  </Typography>
                </Box>
              }
            />
            {mode === 'custom' && (
              <TextField
                size="small"
                value={customMargin}
                onChange={(ev) => setCustomMargin(Number(ev.target.value))}
                sx={{ mt: 1, ml: 4 }}
                InputProps={{ endAdornment: '%' }}
              />
            )}
          </Paper>
        </RadioGroup>
      </Grid>
      <Grid item xs={12} md={5}>
        <Paper variant="outlined" sx={{ p: 2.5, bgcolor: '#F8FAFC' }}>
          <Typography
            variant="caption"
            sx={{
              color: '#64748B',
              fontWeight: 600,
              textTransform: 'uppercase',
            }}
          >
            Calculated adjustment
          </Typography>
          <Typography
            variant="h4"
            sx={{ fontWeight: 800, color: '#DC2626', my: 1 }}
          >
            {formatCurrency(Math.abs(adjustmentAmount), 'USD')}
          </Typography>
          <Typography variant="body2" sx={{ color: '#475569', mb: 2 }}>
            Upward intercompany charge from {entity.id} to IE-001 (principal
            manufacturer), reducing operating margin from {actual}% →{' '}
            {targetMargin}%.
          </Typography>
          <Divider sx={{ my: 2 }} />

          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell sx={{ border: 0, color: '#64748B' }}>
                  YTD Volume
                </TableCell>
                <TableCell sx={{ border: 0 }} align="right">
                  {formatCurrency(entity.ytdVolume, 'USD', true)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ border: 0, color: '#64748B' }}>
                  Current OM
                </TableCell>
                <TableCell sx={{ border: 0 }} align="right">
                  {actual}%
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ border: 0, color: '#64748B' }}>
                  Target OM
                </TableCell>
                <TableCell sx={{ border: 0 }} align="right">
                  {targetMargin}%
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ border: 0, color: '#64748B' }}>
                  Basis pp
                </TableCell>
                <TableCell sx={{ border: 0 }} align="right">
                  {(actual - targetMargin).toFixed(1)}pp
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Paper>
      </Grid>

      {/* Supporting journal entries — audit trail from ACDOCA */}
      <Grid item xs={12}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="flex-end"
            sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}
          >
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Supporting journal entries
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748B' }}>
                Recent ACDOCA postings for {entity.id} — these are the line
                items the adjustment will sit alongside.
              </Typography>
            </Box>
            {journal.data && (
              <Chip
                label={`${journal.data.length} of latest 25 lines`}
                size="small"
                sx={{ bgcolor: '#F1F5F9', color: '#475569', fontWeight: 600 }}
              />
            )}
          </Stack>
          {journal.loading ? (
            <Typography variant="body2" sx={{ color: '#64748B', py: 1.5 }}>
              Loading journal entries…
            </Typography>
          ) : journal.error ? (
            <Alert severity="warning">{journal.error.message}</Alert>
          ) : journal.data && journal.data.length > 0 ? (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 720 }}>
                <TableBody>
                  {journal.data.slice(0, 12).map((j, i) => (
                    <TableRow key={`${j.BELNR}-${j.DOCLN}-${i}`} hover>
                      <TableCell sx={{ color: '#64748B', fontSize: 12 }}>
                        {j.BUDAT}
                      </TableCell>
                      <TableCell
                        sx={{ fontFamily: 'monospace', fontSize: 12 }}
                      >
                        {j.BELNR}/{j.DOCLN}
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>
                        <Box sx={{ fontWeight: 600 }}>{j.RACCT}</Box>
                        {j.RASSC && (
                          <Box sx={{ color: '#64748B', fontSize: 11 }}>
                            TP: {j.RASSC}
                          </Box>
                        )}
                      </TableCell>
                      <TableCell sx={{ color: '#475569', fontSize: 12 }}>
                        {j.SGTXT || '—'}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ fontWeight: 700, fontSize: 12 }}
                      >
                        {formatCurrency(j.HSL, j.RHCUR || 'USD', false)}
                      </TableCell>
                      <TableCell sx={{ fontSize: 11, color: '#64748B' }}>
                        {j.BLART}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          ) : (
            <Typography variant="body2" sx={{ color: '#64748B', py: 1.5 }}>
              No journal entries found for this entity.
            </Typography>
          )}
        </Paper>
      </Grid>
    </Grid>
  );
}
