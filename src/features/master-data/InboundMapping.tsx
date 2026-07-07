import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import LifecycleChip from '@/shared/components/LifecycleChip';
import type { MdStagingItem } from '@/shared/api/types';
import { useMappingWorkflow } from './useMappingWorkflow';

export default function InboundMapping({ onChange }: { onChange?: () => void }) {
  const [items, setItems] = useState<MdStagingItem[] | null>(null);
  // The checker's rejection comment lives on the review row, not the staging row —
  // load rejected mdmap:* review items and keep the latest comment per staging id
  // so a returned mapping shows WHY, then re-enables its fix/resubmit affordances.
  const [rejectComment, setRejectComment] = useState<Record<string, string>>({});
  const refresh = () => {
    api.mdStaging().then(setItems).catch(() => setItems([]));
    api.reviewQueue('rejected')
      .then((rows) => {
        const byId: Record<string, string> = {};
        // Sort ascending by id so the highest-id (latest) comment wins per staging
        // item — don't rely on the server returning rows already id-ordered.
        for (const r of [...rows].sort((a, b) => a.id - b.id)) {
          if (!r.record_ref.startsWith('mdmap:') || !r.comments) continue;
          byId[r.record_ref.slice('mdmap:'.length)] = r.comments;
        }
        setRejectComment(byId);
      })
      .catch(() => setRejectComment({}));
  };
  useEffect(() => { refresh(); }, []);
  const wf = useMappingWorkflow(() => { refresh(); onChange?.(); });
  const [params] = useSearchParams();
  const focus = params.get('focus');
  const [rejecting, setRejecting] = useState<MdStagingItem | null>(null);
  const [comment, setComment] = useState('');

  const doReject = async () => {
    if (!rejecting) return;
    await wf.reject(rejecting.id, comment);
    setRejecting(null);
    setComment('');
  };

  const simulate = async () => { await api.mdSimulate(); refresh(); };

  if (items === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center">
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Inbound SAP mapping</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Unrecognised SAP items, characterised with AI assistance and applied only after human sign-off.
          </Typography>
        </Box>
        <Button variant="outlined" size="small" onClick={simulate}>⟳ Simulate SAP delta</Button>
      </Stack>

      {items.length === 0 && <Alert severity="success">All caught up — no unmapped items.</Alert>}

      {items.map((it) => {
        const p = wf.proposal[it.id];
        const proposed = p?.proposed ?? it.proposed;
        return (
          <Paper key={it.id} variant="outlined" sx={{ p: 2, borderColor: it.id === focus ? '#7C3AED' : undefined, borderWidth: it.id === focus ? 2 : 1 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Chip size="small" label={it.kind} />
              <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>{JSON.stringify(it.raw)}</Typography>
              <LifecycleChip status={it.status} />
            </Stack>

            {proposed && (
              <Box sx={{ mt: 1.5 }}>
                <AgenticHandoffMarker summary={(p?.rationale ?? it.rationale) || 'Research Brain proposed a mapping.'} />
                <Table size="small" sx={{ mt: 1, maxWidth: 520 }}>
                  <TableBody>
                    {Object.entries(proposed).map(([k, v]) => (
                      <TableRow key={k}>
                        <TableCell sx={{ color: 'text.secondary', width: 180 }}>{k}</TableCell>
                        <TableCell sx={{ bgcolor: '#FAF5FF', fontWeight: 600 }}>{String(v)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {p?.confidence && <Typography variant="caption" sx={{ color: 'text.secondary' }}>Confidence: {p.confidence}{p.live ? ' · live' : ' · offline'}</Typography>}
              </Box>
            )}

            {it.status === 'rejected' && rejectComment[it.id] && (
              <Alert severity="warning" variant="outlined" sx={{ mt: 1.5 }}>
                Returned for changes: <em>“{rejectComment[it.id]}”</em> — revise and re-submit.
              </Alert>
            )}

            <Stack direction="row" spacing={1.5} sx={{ mt: 1.5 }}>
              {(it.status === 'unmapped' || it.status === 'rejected') && (
                <Button variant="contained" disabled={wf.busyId === it.id} onClick={() => wf.propose(it.id)}
                  startIcon={wf.busyId === it.id ? <CircularProgress size={16} color="inherit" /> : undefined}>
                  🧠 {it.status === 'rejected' ? 'Re-propose mapping' : 'Propose mapping'}
                </Button>
              )}
              {(it.status === 'proposed' || (proposed && (it.status === 'unmapped' || it.status === 'rejected'))) && (
                <Button variant="contained" disabled={wf.busyId === it.id} onClick={() => wf.submit(it.id)}>
                  {it.status === 'rejected' ? 'Re-submit for review →' : 'Submit for review →'}
                </Button>
              )}
              {it.status === 'in_review' && (
                <>
                  <Button variant="contained" color="success" disabled={wf.busyId === it.id} onClick={() => wf.approve(it.id)}>
                    Approve &amp; apply (as {wf.user.name})
                  </Button>
                  <Button variant="outlined" color="error" disabled={wf.busyId === it.id}
                    onClick={() => { setRejecting(it); setComment(''); }}>
                    Return for changes
                  </Button>
                </>
              )}
            </Stack>
            {it.status === 'in_review' && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                Maker {it.maker} submitted. A different reviewer must approve (switch role from the avatar). The AI can never be the checker.
              </Typography>
            )}
          </Paper>
        );
      })}

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
          <Button color="error" variant="contained" disabled={!comment.trim() || wf.busyId != null} onClick={() => void doReject()}>
            Return
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
