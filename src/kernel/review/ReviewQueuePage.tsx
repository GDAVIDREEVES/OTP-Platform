import { useCallback, useEffect, useState } from 'react';
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
} from '@mui/material';
import AppShell from '@/shared/components/layout/AppShell';
import { api } from '@/shared/api/client';
import { useToast } from '@/shared/providers/DataProvider';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import type { ReviewItem } from '@/shared/api/types';

export default function ReviewQueuePage() {
  const toast = useToast();
  const user = useSessionUser();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<ReviewItem | null>(null);
  const [comment, setComment] = useState('');

  const refresh = useCallback(() => {
    setLoading(true);
    api
      .reviewQueue('pending')
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const approve = async (it: ReviewItem) => {
    setBusy(it.id);
    try {
      await api.approveReview(it.id, { checker: user.id });
      toast.show(`Approved ${it.record_ref}`, 'success');
      refresh();
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
    } catch (e) {
      toast.show(`Reject failed: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <AppShell pageTitle="Review queue">
      <Stack spacing={2}>
        <Alert severity="info" variant="outlined">
          Acting as <b>{user.name}</b> ({user.title}). A maker can&rsquo;t approve their own work —
          segregation of duties is enforced, and every decision is logged. Switch role from the avatar
          (top-right) to approve as a different person.
        </Alert>

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
              {items.map((it) => (
                <TableRow key={it.id} hover>
                  <TableCell><Chip size="small" label={it.process_id} sx={{ fontWeight: 700 }} /></TableCell>
                  <TableCell>{it.record_ref}</TableCell>
                  <TableCell>{it.maker}</TableCell>
                  <TableCell>{new Date(it.created_at).toLocaleString()}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button size="small" color="error" disabled={busy === it.id} onClick={() => { setRejecting(it); setComment(''); }}>
                        Return
                      </Button>
                      <Button size="small" variant="contained" disabled={busy === it.id} onClick={() => void approve(it)}>
                        Approve
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
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
