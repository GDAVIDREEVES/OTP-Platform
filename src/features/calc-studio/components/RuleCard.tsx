import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Chip, CircularProgress, Collapse, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import { api } from '@/shared/api/client';
import type { AuditEvent, Parameter } from '@/shared/api/types';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import { provKind, valueText, PROV_META } from '../lib';

/** Rule cards (CS-d) — read-mostly structured grids for the parameter-backed
 *  rules a calculation applies, rendered in the detail drawer's Definition
 *  section. beat → the RACCT → payment-type classification table (base-eroding
 *  badge from beat.non_base_eroding) + the payment-type order; profit_split →
 *  the participant set and allocation keys. There is NO free-text formula
 *  editor — edits go through Drivers & Assumptions, where each change is
 *  hash-chained at param:{key}; the version chip counts those edited events
 *  (via GET /api/audit) and expands into the changelog. */

/** Extract the governed value from a param-edit audit event's before/after. */
function paramValue(side: unknown): string {
  return valueText((side as { value?: unknown } | null)?.value);
}

function ParamVersionFooter({ paramKey }: { paramKey: string }) {
  const navigate = useNavigate();
  const [edits, setEdits] = useState<AuditEvent[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setEdits(null);
    setOpen(false);
    api.audit({ record_ref: `param:${paramKey}` })
      .then((evs) => setEdits(evs.filter((e) => e.event_type === 'edited')))
      .catch(() => setEdits([]));
  }, [paramKey]);

  return (
    <Box sx={{ mt: 1 }}>
      <Stack direction="row" alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        <Button size="small" onClick={() => navigate('/calc-studio/drivers')}>
          Edit in Drivers &amp; Assumptions
        </Button>
        {edits === null ? (
          <CircularProgress size={14} />
        ) : (
          <Chip
            size="small"
            variant="outlined"
            icon={<HistoryIcon sx={{ fontSize: 14 }} />}
            label={`${edits.length} edit${edits.length === 1 ? '' : 's'}`}
            onClick={edits.length > 0 ? () => setOpen(!open) : undefined}
            sx={{ height: 22, fontSize: 11 }}
          />
        )}
        <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
          param:{paramKey}
        </Typography>
      </Stack>
      <Collapse in={open}>
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {[...(edits ?? [])].reverse().map((e) => (
            <Stack key={e.id} direction="row" alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                {new Date(e.ts).toLocaleString()} · {e.actor}
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
                {paramValue(e.before)} → {paramValue(e.after)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}

function CardTitle({ title, param }: { title: string; param: Parameter }) {
  return (
    <Stack direction="row" alignItems="center" sx={{ mb: 1, flexWrap: 'wrap', gap: 0.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{title}</Typography>
      <ProvenanceChip
        source={param.provenance ?? 'assumed'}
        kind={provKind(param.provenance)}
        tooltip={PROV_META[provKind(param.provenance)].hint}
      />
    </Stack>
  );
}

export default function RuleCard({ parameters }: { parameters: Parameter[] }) {
  const byKey = useMemo(
    () => new Map(parameters.map((p) => [p.key, p])),
    [parameters]
  );
  const racct = byKey.get('beat.racct_type');
  const nonBase = byKey.get('beat.non_base_eroding');
  const payTypes = byKey.get('beat.payment_types');
  const psParticipants = byKey.get('csa.ps_participants');
  const psKeys = byKey.get('csa.ps_keys');

  if (!racct && !psParticipants && !psKeys) return null;

  const nonBaseSet = new Set(
    Array.isArray(nonBase?.value) ? (nonBase?.value as string[]) : []
  );

  return (
    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
      {racct && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <CardTitle title="Classification rule — RACCT → payment type" param={racct} />
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Account</TableCell>
                  <TableCell>Payment type</TableCell>
                  <TableCell>§59A treatment</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries((racct.value as Record<string, string>) ?? {}).map(([acct, ptype]) => (
                  <TableRow key={acct}>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{acct}</TableCell>
                    <TableCell>{ptype}</TableCell>
                    <TableCell>
                      {nonBaseSet.has(ptype) ? (
                        <Chip size="small" variant="outlined" label="excluded (COGS)" sx={{ height: 20, fontSize: 11 }} />
                      ) : (
                        <Chip size="small" color="warning" variant="outlined" label="base-eroding" sx={{ height: 20, fontSize: 11 }} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {payTypes && Array.isArray(payTypes.value) && (
            <Stack direction="row" alignItems="center" sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                Payment types
              </Typography>
              {(payTypes.value as string[]).map((t) => (
                <Chip
                  key={t}
                  size="small"
                  variant="outlined"
                  color={nonBaseSet.has(t) ? undefined : 'warning'}
                  label={t}
                  sx={{ height: 20, fontSize: 11 }}
                />
              ))}
            </Stack>
          )}
          <ParamVersionFooter paramKey="beat.racct_type" />
        </Paper>
      )}
      {(psParticipants || psKeys) && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <CardTitle
            title="Allocation rule — participants & keys"
            param={(psParticipants ?? psKeys) as Parameter}
          />
          {psParticipants && Array.isArray(psParticipants.value) && (
            <Stack direction="row" alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                Participants
              </Typography>
              {(psParticipants.value as string[]).map((p) => (
                <Chip key={p} size="small" label={p} sx={{ height: 20, fontSize: 11, fontFamily: 'monospace' }} />
              ))}
            </Stack>
          )}
          {psKeys && Array.isArray(psKeys.value) && (
            <Stack direction="row" alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                Allocation keys
              </Typography>
              {(psKeys.value as string[]).map((k) => (
                <Chip key={k} size="small" variant="outlined" label={k} sx={{ height: 20, fontSize: 11, fontFamily: 'monospace' }} />
              ))}
            </Stack>
          )}
          <ParamVersionFooter paramKey={psParticipants ? 'csa.ps_participants' : 'csa.ps_keys'} />
        </Paper>
      )}
    </Stack>
  );
}
