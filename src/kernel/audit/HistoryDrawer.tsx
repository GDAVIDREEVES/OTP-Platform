/**
 * HistoryDrawer — the audit history of ONE governed object, in place.
 *
 * A right-anchored drawer over GET /api/evidence/{ref} (the same packet the
 * full-page EvidencePacket renders): compact event timeline newest-first with
 * assistant-actor marking, per-event field diffs when the packet carries them,
 * a chain-integrity badge, and a footer link out to the printable packet at
 * /evidence/{ref}. Pair it with the exported HistoryButton — a small History
 * icon that owns its own open state and stops row-click propagation — so any
 * table row or card can offer "why is this the way it is?" in one click,
 * without navigating away from the work.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FC, MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import HistoryIcon from '@mui/icons-material/History';
import GppGoodIcon from '@mui/icons-material/GppGood';
import { api } from '@/shared/api/client';
import { tokens } from '@/shared/theme';
import LifecycleChip, { STATUS_META } from '@/shared/components/LifecycleChip';
import type { AuditEvent, EvidenceDiff, EvidencePacket as Packet } from '@/shared/api/types';

const fmtTs = (ts: string) => {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
};

/** Render one diff value compactly — objects/arrays as truncated JSON, never
 *  "[object Object]". */
const fmtVal = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
};

/** Event-type chip: lifecycle vocabulary → LifecycleChip, anything else a
 *  plain capitalized chip (the AuditTab idiom). */
function EventTypeChip({ eventType }: { eventType: string }) {
  if (STATUS_META[eventType]) return <LifecycleChip status={eventType} />;
  return (
    <Chip
      size="small"
      label={eventType}
      sx={{ height: 20, fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}
    />
  );
}

function EventRow({ e, diff }: { e: AuditEvent; diff?: EvidenceDiff }) {
  const assisted = e.actor_kind === 'assistant';
  return (
    <Box sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        <Box sx={{ minWidth: 92 }}>
          <EventTypeChip eventType={e.event_type} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 700 }}>{e.actor}</Typography>
            {assisted && (
              <Chip
                size="small"
                label="assisted"
                sx={{ height: 18, fontSize: 10, fontWeight: 700, bgcolor: '#EDE9FE', color: tokens.assist }}
              />
            )}
          </Stack>
          {e.rationale && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              {e.rationale}
            </Typography>
          )}
          {diff && diff.changes.length > 0 && (
            <Box sx={{ mt: 0.5 }}>
              {diff.changes.map((c) => (
                <Typography key={c.field} variant="caption" sx={{ display: 'block', lineHeight: 1.6 }}>
                  <Box component="span" sx={{ fontWeight: 600 }}>{c.field}</Box>
                  {': '}
                  <Box component="span" sx={{ color: '#B91C1C', textDecoration: 'line-through' }}>
                    {fmtVal(c.from)}
                  </Box>
                  {' → '}
                  <Box component="span" sx={{ color: '#15803D', fontWeight: 600 }}>{fmtVal(c.to)}</Box>
                </Typography>
              ))}
            </Box>
          )}
        </Box>
        <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
          {fmtTs(e.ts)}
        </Typography>
      </Stack>
    </Box>
  );
}

interface HistoryDrawerProps {
  /** The audit record_ref this drawer narrates (e.g. "scenario:3", "param:csa.pct_mult"). */
  recordRef: string;
  open: boolean;
  onClose: () => void;
}

export default function HistoryDrawer({ recordRef, open, onClose }: HistoryDrawerProps) {
  const navigate = useNavigate();
  const [packet, setPacket] = useState<Packet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!open || !recordRef) return undefined;
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .evidence(recordRef)
      .then((p) => alive && setPacket(p))
      .catch((e) => {
        if (!alive) return;
        setPacket(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, recordRef, nonce]);

  // Per-event field diffs, keyed by the owning event.
  const diffByEvent = useMemo(() => {
    const m = new Map<number, EvidenceDiff>();
    (packet?.diffs ?? []).forEach((d) => m.set(d.event_id, d));
    return m;
  }, [packet]);

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 520 } } }}>
      <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Stack direction="row" alignItems="flex-start" spacing={1}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>History</Typography>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, wordBreak: 'break-all' }}>
              {packet?.subject || recordRef}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{recordRef}</Typography>
              {packet && (
                <Chip
                  size="small"
                  icon={<GppGoodIcon sx={{ fontSize: 14 }} />}
                  color={packet.verify.ok ? 'success' : 'error'}
                  label={packet.verify.ok ? 'Audit chain intact' : `Chain broken @ ${packet.verify.broken_at}`}
                  sx={{ height: 20, fontSize: 11 }}
                />
              )}
            </Stack>
          </Box>
          <IconButton size="small" onClick={onClose} aria-label="Close history">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Box sx={{ flex: 1, overflowY: 'auto', mt: 1.5 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
          ) : error ? (
            <Alert
              severity="error"
              action={<Button color="inherit" size="small" onClick={retry}>Retry</Button>}
            >
              Could not load the history for {recordRef}: {error}
            </Alert>
          ) : !packet || packet.events.length === 0 ? (
            <Alert severity="info" variant="outlined">
              No events recorded for {recordRef} yet. The trail is a by-product of the
              work — events are written automatically, never as a separate step.
            </Alert>
          ) : (
            <Box>
              {[...packet.events].reverse().map((e) => (
                <EventRow key={e.id} e={e} diff={diffByEvent.get(e.id)} />
              ))}
            </Box>
          )}
        </Box>

        <Divider sx={{ mt: 1.5 }} />
        <Stack direction="row" alignItems="center" sx={{ pt: 1.25 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1 }}>
            Append-only, hash-chained. Integrity verified at render.
          </Typography>
          <Button size="small" onClick={() => navigate(`/evidence/${encodeURIComponent(recordRef)}`)}>
            Open full evidence packet
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}

/** One-click history affordance for any table row or card: a small History
 *  IconButton that owns its drawer state and never triggers the row's own
 *  onClick (stopPropagation). */
export const HistoryButton: FC<{ recordRef: string; size?: 'small' | 'medium' }> = ({
  recordRef,
  size = 'small',
}) => {
  const [open, setOpen] = useState(false);
  const onOpen = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setOpen(true);
  };
  return (
    <>
      <Tooltip title="History" arrow>
        <IconButton size={size} onClick={onOpen} aria-label={`History for ${recordRef}`}>
          <HistoryIcon fontSize={size === 'small' ? 'small' : 'medium'} />
        </IconButton>
      </Tooltip>
      <HistoryDrawer recordRef={recordRef} open={open} onClose={() => setOpen(false)} />
    </>
  );
};
