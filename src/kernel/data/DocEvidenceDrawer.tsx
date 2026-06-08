import { useEffect, useState } from 'react';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import GppGoodIcon from '@mui/icons-material/GppGood';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';
import type { EvidencePacket } from '@/shared/api/types';

const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const fmtTs = (ts: string) => {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
};

/** Side-panel evidence packet for the documentation workpapers (OTP-37 / OTP-32).
 *  Reuses the existing /api/evidence composition (audit history + before/after
 *  diffs + linked ACDOCA postings + chain integrity) — the §6662 export, in a
 *  drawer — with a link out to the standalone print-ready packet. */
export default function DocEvidenceDrawer({
  open,
  onClose,
  recordRef,
  title,
}: {
  open: boolean;
  onClose: () => void;
  recordRef?: string;
  title?: string;
}) {
  const [packet, setPacket] = useState<EvidencePacket | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !recordRef) return;
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
  }, [open, recordRef]);

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 560 } } }}>
      <Box sx={{ p: 2.5 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>Evidence packet</Typography>
          <IconButton size="small" onClick={onClose} aria-label="Close evidence">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
        ) : !packet ? (
          <Alert severity="warning">No evidence for {recordRef}.</Alert>
        ) : (
          <Stack spacing={2.5}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>{title || packet.subject || packet.record_ref}</Typography>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{packet.record_ref}</Typography>
                <Chip
                  size="small"
                  icon={<GppGoodIcon sx={{ fontSize: 14 }} />}
                  color={packet.verify.ok ? 'success' : 'error'}
                  label={packet.verify.ok ? 'Audit chain intact' : `Chain broken @ ${packet.verify.broken_at}`}
                />
              </Stack>
              <Button
                size="small"
                startIcon={<OpenInNewIcon />}
                href={`/evidence/${encodeURIComponent(packet.record_ref)}`}
                target="_blank"
                rel="noopener"
                sx={{ mt: 1 }}
              >
                Open print-ready packet
              </Button>
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>Event history</Typography>
              {packet.events.length === 0 ? (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>No recorded events yet.</Typography>
              ) : packet.events.map((e) => (
                <Box key={e.id} sx={{ display: 'flex', gap: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Chip size="small" label={e.event_type} sx={{ fontWeight: 700, textTransform: 'capitalize', minWidth: 84 }} />
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
                            <TableCell sx={{ fontWeight: 600, width: 160 }}>{c.field}</TableCell>
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
                      <TableCell align="right">Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {packet.postings.map((r, i) => (
                      <TableRow key={`${r.BELNR}-${i}`}>
                        <TableCell>{r.BUDAT ?? '—'}</TableCell>
                        <TableCell>{r.BELNR}</TableCell>
                        <TableCell>{r.RACCT}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.HSL, r.RHCUR || 'USD')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}

            <Divider />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Composed from the append-only, hash-chained audit stream and the linked ACDOCA postings.
              Integrity verified at render — the §6662 contemporaneous-documentation export, assembled in one call.
            </Typography>
          </Stack>
        )}
      </Box>
    </Drawer>
  );
}
