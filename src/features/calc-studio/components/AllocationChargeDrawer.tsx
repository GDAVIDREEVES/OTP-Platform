import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { api } from '@/shared/api/client';
import type { AllocationChargeLineage } from '@/shared/api/types';
import { fmtAmount, fmtPct } from '../allocationLib';

/** Charge drill drawer (M7 Allocations workbench, shell cloned from
 *  CalcDetailDrawer): one append-only ledger charge opened to its allocation
 *  context — the applied ratio and key value, the markup decomposition and the
 *  CONSTITUENT COST LINES from the run's persisted lineage index
 *  (GET /api/allocation/charges/{id}/lineage). True-up rows carry no cost
 *  lines; they drill to their parent Budget charge instead. Every amount is an
 *  exact decimal string rendered lexically — nothing is recomputed here. */

const KIND_LABEL: Record<string, string> = {
  allocated: 'Allocated (key apportionment)',
  direct: 'Direct charge (traceable)',
  pass_through: 'Pass-through (at cost)',
  true_up: 'True-up delta',
};

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography
        variant="caption"
        sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block' }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{value}</Typography>
    </Box>
  );
}

export default function AllocationChargeDrawer({
  chargeId,
  onClose,
}: {
  chargeId: string | null;
  onClose: () => void;
}) {
  const [lineage, setLineage] = useState<AllocationChargeLineage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLineage(null);
    setError(null);
    if (!chargeId) return;
    let alive = true;
    api
      .allocationChargeLineage(chargeId)
      .then((l) => alive && setLineage(l))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [chargeId]);

  const charge = lineage?.charge;
  // Display the deterministic engine id; the run prefix rides the caption.
  const engineId = chargeId?.includes(':') ? chargeId.slice(chargeId.indexOf(':') + 1) : chargeId;

  return (
    <Drawer anchor="right" open={chargeId !== null} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 680 } } }}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" alignItems="flex-start" sx={{ mb: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>
              Charge ledger — lineage drill
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, fontFamily: 'monospace', fontSize: 16, overflowWrap: 'anywhere' }}>
              {engineId ?? '—'}
            </Typography>
            {charge && (
              <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                run {charge.run_id ?? '—'}
              </Typography>
            )}
          </Box>
          <IconButton onClick={onClose} aria-label="Close">
            <CloseIcon />
          </IconButton>
        </Stack>

        {error && <Alert severity="error" variant="outlined">{error}</Alert>}
        {!error && lineage === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        ) : charge ? (
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={KIND_LABEL[lineage?.charge_kind ?? ''] ?? lineage?.charge_kind ?? 'charge'}
                sx={{ height: 22, fontWeight: 700 }}
              />
              <Chip size="small" label={charge.budget_or_actual} sx={{ height: 22 }} />
              <Chip size="small" variant="outlined" label={charge.period} sx={{ height: 22 }} />
            </Stack>

            {/* Allocation context */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
              <Meta label="Pool" value={lineage?.pool_id ?? charge.pool_id} />
              <Meta label="Provider → recipient" value={`${charge.provider_entity_id} → ${charge.recipient_entity_id}`} />
              <Meta label="Allocation key" value={charge.allocation_key_id ?? '—'} />
              <Meta label="Key value row" value={lineage?.key_value_id ?? '—'} />
              <Meta label="Allocation ratio" value={fmtPct(charge.allocation_ratio_applied)} />
              <Meta label="Markup rate" value={fmtPct(charge.markup_pct_applied)} />
              <Meta label="FX" value={`${charge.fx_rate} · ${charge.fx_rate_type} · ${charge.fx_rate_date}`} />
              <Meta label="Doc pack" value={charge.documentation_ref ?? '—'} />
            </Box>

            {/* The schema identity: gross = cost recovered + markup, to the cent. */}
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', gap: 1.5 }}>
                <Meta label="Cost recovered" value={`${fmtAmount(charge.cost_recovered_amount)} ${charge.charge_currency}`} />
                <Meta label="Markup" value={`${fmtAmount(charge.markup_amount)} ${charge.charge_currency}`} />
                <Meta label="Gross charge" value={`${fmtAmount(charge.gross_charge_amount)} ${charge.charge_currency}`} />
              </Stack>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                gross_charge_amount = cost_recovered_amount + markup_amount — exact decimal strings off
                the append-only ledger.
              </Typography>
            </Paper>

            {lineage?.true_up_parent_charge_id && (
              <Alert severity="info" variant="outlined">
                True-up delta — parent Budget charge:{' '}
                <Box component="span" sx={{ fontFamily: 'monospace', fontWeight: 700, overflowWrap: 'anywhere' }}>
                  {lineage.true_up_parent_charge_id}
                </Box>
              </Alert>
            )}

            <Divider />

            {/* Constituent cost lines (the run's persisted lineage index). */}
            <Box>
              <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                Constituent cost lines
              </Typography>
              {lineage && lineage.lines.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Cost line</TableCell>
                        <TableCell>Cost center</TableCell>
                        <TableCell>Element</TableCell>
                        <TableCell align="right">Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {lineage.lines.map((l) => (
                        <TableRow key={l.cost_line_id} hover>
                          <TableCell sx={{ maxWidth: 220 }}>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' }}>
                              {l.cost_line_id}
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              {l.charge_method ?? ''} · {l.fiscal_period}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{l.cost_center}</TableCell>
                          <TableCell sx={{ maxWidth: 180 }}>
                            <Typography variant="body2" sx={{ fontSize: 13 }}>{l.cost_element ?? '—'}</Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{l.cost_nature ?? ''}</Typography>
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {fmtAmount(l.amount_local)} {l.currency_local}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {lineage?.charge_kind === 'true_up'
                    ? 'True-up rows carry no cost lines — the delta reconstructs from the parent Budget charge and the actual-year recompute.'
                    : 'No cost lines recorded on the lineage index for this charge.'}
                </Typography>
              )}
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                From the run&apos;s persisted lineage index (lineage.json) — every charge is
                reconstructable from immutable inputs (SPEC §1).
              </Typography>
            </Box>
          </Stack>
        ) : null}
      </Box>
    </Drawer>
  );
}
