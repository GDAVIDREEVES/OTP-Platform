import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
} from '@mui/material';
import AppShell from '@/shared/components/layout/AppShell';
import { api } from '@/shared/api/client';
import { originRoute } from '@/kernel/workflow/originRoute';
import { useToast } from '@/shared/providers/DataProvider';
import { nextReviewerFor, useSession } from '@/shared/providers/SessionProvider';
import { useRefreshSignals } from '@/shared/providers/WorkSignalsProvider';
import type { ReviewItem } from '@/shared/api/types';

export default function ReviewQueuePage() {
  const toast = useToast();
  const { user, users, setRole } = useSession();
  const navigate = useNavigate();
  const refreshSignals = useRefreshSignals();

  // The one-click persona hop for the demo's SoD beat — the first OTHER
  // persona, preferring the reviewer (the same pick as ReviewHandoff).
  const nextPersona = useMemo(() => nextReviewerFor(users, user), [users, user]);
  const makerName = useCallback(
    (id: string) => users.find((u) => u.id === id)?.name ?? id,
    [users],
  );
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [returned, setReturned] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<ReviewItem | null>(null);
  const [comment, setComment] = useState('');

  const refresh = useCallback(() => {
    setLoading(true);
    // Loop 1.2 — rejected items the *current user* made are surfaced as a
    // "Returned to you" worklist so the maker can jump back to the originating
    // process and resubmit.
    Promise.all([
      api.reviewQueue('pending').catch(() => [] as ReviewItem[]),
      api.reviewQueue('rejected').catch(() => [] as ReviewItem[]),
    ])
      .then(([pending, rejected]) => {
        setItems(pending);
        // Keep only the LATEST rejected item per record_ref — a record bounced
        // twice shows one "Returned to you" row, not a pile-up.
        const latestByRef = new Map<string, ReviewItem>();
        for (const it of rejected) {
          if (it.maker !== user.id) continue;
          const prev = latestByRef.get(it.record_ref);
          if (!prev || it.id > prev.id) latestByRef.set(it.record_ref, it);
        }
        setReturned([...latestByRef.values()]);
      })
      .catch(() => {
        setItems([]);
        setReturned([]);
      })
      .finally(() => setLoading(false));
  }, [user.id]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const approve = async (it: ReviewItem) => {
    setBusy(it.id);
    try {
      await api.approveReview(it.id, { checker: user.id });
      toast.show(`Approved ${it.record_ref}`, 'success');
      refresh();
      void refreshSignals(); // bell badge / home Command Center / My work
    } catch (e) {
      toast.show(`Approve failed: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const doReject = async () => {
    if (!rejecting) return;
    setBusy(rejecting.id);
    try {
      await api.rejectReview(rejecting.id, { checker: user.id, comments: comment });
      toast.show(`Returned ${rejecting.record_ref}`, 'info');
      setRejecting(null);
      setComment('');
      refresh();
      void refreshSignals(); // bell badge / home Command Center / My work
    } catch (e) {
      toast.show(`Reject failed: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  // Only offer the persona hop when the current user actually can't act — i.e.
  // they submitted at least one of the pending items (so switching to the
  // reviewer unblocks an approval). Otherwise the reviewer would be nudged to
  // hop back to the operator for no reason.
  const blockedByOwnItem = items.some((it) => it.maker === user.id);

  return (
    <AppShell pageTitle="Review queue">
      <Stack spacing={2}>
        <Alert
          severity="info"
          variant="outlined"
          action={
            nextPersona && blockedByOwnItem ? (
              <Button color="inherit" size="small" onClick={() => setRole(nextPersona.role)}>
                Act as {nextPersona.name}
              </Button>
            ) : undefined
          }
        >
          Acting as <b>{user.name}</b> ({user.title}). A maker can&rsquo;t approve their own work —
          segregation of duties is enforced, and every decision is logged. Switch role from the avatar
          (top-right) to approve as a different person.
        </Alert>

        {!loading && returned.length > 0 && (
          <Alert severity="warning" variant="outlined">
            <Stack spacing={1.5}>
              <Box sx={{ fontWeight: 700 }}>Returned to you</Box>
              {returned.map((it) => {
                const route = originRoute(it.record_ref);
                return (
                  <Box key={it.id}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Chip size="small" label={it.process_id} sx={{ fontWeight: 700 }} />
                      <Box component="span">{it.record_ref}</Box>
                      {route && (
                        <Button size="small" variant="outlined" onClick={() => navigate(route)}>
                          Fix &amp; resubmit
                        </Button>
                      )}
                    </Stack>
                    {it.comments && (
                      <Box sx={{ mt: 0.5, fontStyle: 'italic', color: 'text.secondary' }}>
                        “{it.comments}”
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Stack>
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : items.length === 0 ? (
          <Alert severity="success" variant="outlined">
            Nothing awaiting review. Submit an adjustment from OTP-16 to populate the queue.
          </Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Process</TableCell>
                <TableCell>Record</TableCell>
                <TableCell>Maker</TableCell>
                <TableCell>Submitted</TableCell>
                <TableCell align="right">Decision</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((it) => {
                const selfMade = it.maker === user.id;
                return (
                  <TableRow key={it.id} hover>
                    <TableCell><Chip size="small" label={it.process_id} sx={{ fontWeight: 700 }} /></TableCell>
                    <TableCell>{it.record_ref}</TableCell>
                    <TableCell>{it.maker}</TableCell>
                    <TableCell>{new Date(it.created_at).toLocaleString()}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button size="small" onClick={() => navigate(`/evidence/${encodeURIComponent(it.record_ref)}`)}>
                          Evidence
                        </Button>
                        <Button size="small" color="error" disabled={busy === it.id} onClick={() => { setRejecting(it); setComment(''); }}>
                          Return
                        </Button>
                        <Tooltip
                          title={
                            selfMade
                              ? `Segregation of duties — you submitted this as ${makerName(it.maker)}. Switch persona (avatar, top right) to approve as someone else.`
                              : ''
                          }
                        >
                          {/* span: MUI tooltips need a live wrapper around a disabled button */}
                          <span>
                            <Button
                              size="small"
                              variant="contained"
                              disabled={busy === it.id || selfMade}
                              onClick={() => void approve(it)}
                            >
                              Approve
                            </Button>
                          </span>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Stack>

      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} fullWidth maxWidth="sm">
        <DialogTitle>Return for changes</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            label="Reason (required)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejecting(null)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={!comment.trim() || busy != null} onClick={() => void doReject()}>
            Return
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
