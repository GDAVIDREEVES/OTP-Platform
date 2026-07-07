/**
 * ReviewHandoff — the one segregation-of-duties moment, everywhere.
 *
 * Every maker-checker flow ends the same way: something lands in the review
 * queue and a DIFFERENT person must approve it. This provider gives every
 * submit path one call — useReviewHandoff().notifySubmitted({...}) — that
 * opens a single app-wide dialog explaining the gate and offering the demo's
 * canonical next move: switch persona to the reviewer and jump to /review,
 * or stay put. No consumer is wired here (increment 1 does that); this is
 * only the shared primitive.
 *
 * nextReviewer = the first session user who is NOT the current persona,
 * preferring role === 'reviewer' (Sam), so the button names a real person.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { nextReviewerFor, useSession } from '@/shared/providers/SessionProvider';

export interface ReviewHandoffRequest {
  /** The audit record_ref now sitting in the queue (e.g. "scenario:3"). */
  recordRef: string;
  /** Owning process, when the caller knows it (e.g. "OTP-3") — shown as a
   *  small chip in the dialog. */
  processId?: string;
  /** Human name for the dialog; falls back to recordRef. */
  label?: string;
}

interface ReviewHandoffApi {
  /** Announce "this just went into the review queue" — opens the handoff dialog. */
  notifySubmitted: (req: ReviewHandoffRequest) => void;
}

const Ctx = createContext<ReviewHandoffApi | null>(null);

export function ReviewHandoffProvider({ children }: { children: React.ReactNode }) {
  const { user, users, setRole } = useSession();
  const navigate = useNavigate();
  const [pending, setPending] = useState<ReviewHandoffRequest | null>(null);
  const [open, setOpen] = useState(false);

  const notifySubmitted = useCallback((req: ReviewHandoffRequest) => {
    setPending(req);
    setOpen(true);
  }, []);
  // Close only hides the dialog; the request stays mounted until the fade-out
  // finishes (TransitionProps.onExited) so the content never blanks mid-fade.
  const close = useCallback(() => setOpen(false), []);
  const clearPending = useCallback(() => setPending(null), []);

  const nextReviewer = useMemo(() => nextReviewerFor(users, user), [users, user]);

  const switchAndOpenQueue = useCallback(() => {
    if (nextReviewer) setRole(nextReviewer.role);
    navigate('/review');
    close();
  }, [nextReviewer, setRole, navigate, close]);

  const value = useMemo<ReviewHandoffApi>(() => ({ notifySubmitted }), [notifySubmitted]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog
        open={open}
        onClose={close}
        maxWidth="sm"
        fullWidth
        TransitionProps={{ onExited: clearPending }}
      >
        <DialogTitle>Awaiting approval</DialogTitle>
        <DialogContent>
          {pending?.processId && (
            <Chip
              size="small"
              variant="outlined"
              label={pending.processId}
              sx={{ mb: 1, height: 20, fontSize: 11, fontWeight: 700 }}
            />
          )}
          <Typography variant="body2">
            <Box component="span" sx={{ fontWeight: 700 }}>
              {pending?.label ?? pending?.recordRef}
            </Box>{' '}
            is now in the review queue. Segregation of duties: a different person
            must approve — the AI can never be the checker.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>Stay here</Button>
          {nextReviewer && (
            <Button variant="contained" onClick={switchAndOpenQueue}>
              Switch to {nextReviewer.name} &amp; open Review queue
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Ctx.Provider>
  );
}

export function useReviewHandoff(): ReviewHandoffApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useReviewHandoff must be used within <ReviewHandoffProvider>');
  return v;
}
