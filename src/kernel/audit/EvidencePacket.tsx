import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PrintIcon from '@mui/icons-material/Print';
import GppGoodIcon from '@mui/icons-material/GppGood';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';
import type { AuditEvent, EvidencePacket as Packet } from '@/shared/api/types';

const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const fmtTs = (ts: string) => {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
};

/** Event types that make up a record's cross-process lineage (mirrors
 *  backend/state/lineage.py:_TIMELINE_EVENTS — the lifecycle milestones plus the
 *  cross-process handoff hops). Everything else is noise for this narrative. */
const LINEAGE_EVENTS = new Set([
  'created',
  'submitted',
  'approved',
  'rejected',
  'handoff',
  'posted',
]);

/** A `handoff` event carries the originating/receiving process pair in `after`. */
function handoffPair(e: AuditEvent): { from?: string; to?: string } {
  const a = e.after;
  if (a && typeof a === 'object') {
    const { from, to } = a as { from?: unknown; to?: unknown };
    return {
      from: typeof from === 'string' ? from : undefined,
      to: typeof to === 'string' ? to : undefined,
    };
  }
  return {};
}

/** A short verb for a lineage step; the rationale carries the detail. */
const STEP_VERB: Record<string, string> = {
  created: 'created',
  submitted: 'submitted',
  approved: 'approved',
  rejected: 'rejected',
  handoff: 'handed off',
  posted: 'posted',
};

/** One node in the horizontal lineage stepper. `process` is the owning process
 *  tag shown under the verb (the receiving side for a handoff); `assistant`
 *  drives the lavender vs neutral tone. */
interface LineageNode {
  id: number;
  verb: string;
  process: string | null;
  assistant: boolean;
  ts: string;
  detail: string | null;
}

function toNodes(events: AuditEvent[]): LineageNode[] {
  return events
    .filter((e) => LINEAGE_EVENTS.has(e.event_type))
    .map((e) => {
      const assistant = e.actor_kind === 'assistant';
      if (e.event_type === 'handoff') {
        const { to } = handoffPair(e);
        return {
          id: e.id,
          verb: STEP_VERB.handoff,
          process: to ?? e.process_id,
          assistant,
          ts: e.ts,
          detail: e.rationale,
        };
      }
      return {
        id: e.id,
        verb: STEP_VERB[e.event_type] ?? e.event_type,
        process: e.process_id,
        assistant,
        ts: e.ts,
        detail: e.rationale,
      };
    });
}

/** Standalone, print-ready evidence packet: event history + before/after diffs
 *  + linked ACDOCA postings + chain integrity. The toolbar hides on print. */
export default function EvidencePacket() {
  const { ref } = useParams();
  const recordRef = ref ? decodeURIComponent(ref) : '';
  const navigate = useNavigate();
  const [packet, setPacket] = useState<Packet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!recordRef) return;
    let alive = true;
    setLoading(true);
    api
      .evidence(recordRef)
      .then((p) => alive && setPacket(p))
      .catch(() => alive && setPacket(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [recordRef]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'white' }}>
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.5, px: 3, py: 1.5,
          borderBottom: '1px solid #E2E8F0', position: 'sticky', top: 0, bgcolor: 'white', zIndex: 1,
          '@media print': { display: 'none' },
        }}
      >
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} size="small">Back</Button>
        <Box sx={{ flex: 1 }} />
        <Button startIcon={<PrintIcon />} variant="contained" onClick={() => window.print()} size="small">
          Print / export
        </Button>
      </Box>

      <Box sx={{ maxWidth: 900, mx: 'auto', p: { xs: 2, md: 4 } }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress /></Box>
        ) : !packet ? (
          <Alert severity="warning">No evidence for {recordRef}.</Alert>
        ) : (
          <Stack spacing={3}>
            <Box>
              <Typography variant="overline" sx={{ color: 'text.secondary' }}>Evidence packet</Typography>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>{packet.subject || packet.record_ref}</Typography>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{packet.record_ref}</Typography>
                <Chip
                  size="small"
                  icon={<GppGoodIcon sx={{ fontSize: 14 }} />}
                  color={packet.verify.ok ? 'success' : 'error'}
                  label={packet.verify.ok ? 'Audit chain intact' : `Chain broken @ ${packet.verify.broken_at}`}
                />
              </Stack>
            </Box>

            {(() => {
              const nodes = toNodes(packet.events);
              if (nodes.length === 0) return null;
              return (
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>Process lineage</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.25 }}>
                    The cross-process story for this record — each hop is one more event on the same
                    hash-chained trail. Lavender steps were prepared by the Research Brain; neutral steps
                    you own.
                  </Typography>
                  <Box
                    sx={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'stretch',
                      gap: 0.5,
                      '@media print': { flexWrap: 'wrap' },
                    }}
                  >
                    {nodes.map((n, i) => (
                      <Box key={n.id} sx={{ display: 'flex', alignItems: 'center' }}>
                        <Box
                          sx={{
                            minWidth: 124,
                            border: '1px solid',
                            borderColor: n.assistant ? tokens.assist : 'divider',
                            bgcolor: n.assistant ? '#FAF5FF' : '#F8FAFC',
                            borderRadius: 1.5,
                            px: 1.25,
                            py: 0.75,
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{
                              fontWeight: 800,
                              textTransform: 'capitalize',
                              color: n.assistant ? tokens.assist : 'text.primary',
                              display: 'block',
                              lineHeight: 1.2,
                            }}
                          >
                            {n.verb}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                            {n.process ?? '—'}
                          </Typography>
                          {n.detail && (
                            <Typography
                              variant="caption"
                              sx={{
                                color: 'text.secondary',
                                display: 'block',
                                mt: 0.25,
                                fontSize: 10,
                                maxWidth: 180,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={n.detail}
                            >
                              {n.detail}
                            </Typography>
                          )}
                        </Box>
                        {i < nodes.length - 1 && (
                          <ChevronRightIcon sx={{ color: 'text.disabled', mx: 0.25 }} />
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              );
            })()}

            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>Event history</Typography>
              {packet.events.map((e) => (
                <Box key={e.id} sx={{ display: 'flex', gap: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Chip size="small" label={e.event_type} sx={{ fontWeight: 700, textTransform: 'capitalize', minWidth: 90 }} />
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {e.actor}
                      {e.actor_kind === 'assistant' && (
                        <Chip size="small" label="assisted" sx={{ ml: 0.75, height: 18, fontSize: 10, bgcolor: '#EDE9FE', color: tokens.assist }} />
                      )}
                    </Typography>
                    {e.rationale && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{e.rationale}</Typography>}
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{fmtTs(e.ts)}</Typography>
                </Box>
              ))}
            </Box>

            {packet.diffs.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>Before / after</Typography>
                {packet.diffs.map((d) => (
                  <Box key={d.event_id} sx={{ mb: 1.5 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'capitalize' }}>
                      {d.event_type} · {d.actor} · {fmtTs(d.ts)}
                    </Typography>
                    <Table size="small">
                      <TableBody>
                        {d.changes.map((c) => (
                          <TableRow key={c.field}>
                            <TableCell sx={{ fontWeight: 600, width: 200 }}>{c.field}</TableCell>
                            <TableCell sx={{ color: '#B91C1C', textDecoration: 'line-through' }}>{fmt(c.from)}</TableCell>
                            <TableCell sx={{ color: '#15803D', fontWeight: 600 }}>{fmt(c.to)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                ))}
              </Box>
            )}

            {packet.postings.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>Linked ACDOCA postings</Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell><TableCell>Doc</TableCell><TableCell>Account</TableCell>
                      <TableCell>Description</TableCell><TableCell align="right">Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {packet.postings.map((r, i) => (
                      <TableRow key={`${r.BELNR}-${i}`}>
                        <TableCell>{r.BUDAT ?? '—'}</TableCell>
                        <TableCell>{r.BELNR}</TableCell>
                        <TableCell>{r.RACCT}</TableCell>
                        <TableCell sx={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.SGTXT}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.HSL, r.RHCUR || 'USD')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}

            <Divider />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Generated from the append-only, hash-chained audit stream. Integrity verified at render.
            </Typography>
          </Stack>
        )}
      </Box>
    </Box>
  );
}
