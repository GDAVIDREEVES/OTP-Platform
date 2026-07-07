/**
 * LifecycleChip — THE status chip for every governed-object lifecycle.
 *
 * The app grew five separate status vocabularies (scenarios, authored pools,
 * inbound mapping, waterfall runs, cases); this chip unifies them onto MUI's
 * semantic colors so a status reads the same on every surface:
 *
 *  - default          = inert, nothing governed yet (draft, unmapped)
 *  - info             = machine-produced / in-flight, not yet human-gated
 *                       (proposed, tested, running, in_progress)
 *  - warning          = a human must act (in_review, pending, open, submitted)
 *  - success          = live governed effect (active, applied, promoted, approved)
 *  - error            = the gate said no (rejected → "Returned", failed)
 *  - default outlined = terminal and inert — pushed into the background
 *                       (discarded, superseded, rolled_back, closed)
 *
 * Mapping decisions (surveyed conventions, and the deliberate deviations):
 *  - draft=default: ScenariosTab STATUS_CHIP and PoolBuilder STATUS_COLOR both
 *    already color draft 'default'; unmapped joins as "nothing governed yet"
 *    (InboundMapping paints it an amber hex, but that palette predates the
 *    MUI-semantic convention used everywhere since).
 *  - proposed/tested=info: PoolBuilder tested='info'; InboundMapping proposed
 *    uses the assist violet #7C3AED — folded into info here: machine-produced,
 *    in-flight, awaiting its human gate.
 *  - in_review/pending=warning: unanimous — ScenariosTab and PoolBuilder both
 *    color in_review 'warning'; review-queue pending is the same gate.
 *  - active/applied/promoted/approved=success: unanimous — PoolBuilder active,
 *    WaterfallTab applied, ScenariosTab promoted, InboundMapping applied.
 *  - rejected/failed=error: WaterfallTab + AllocationsTab failed='error';
 *    InboundMapping rejected=#DC2626. Label "Returned" because the review
 *    queue guides work back to the maker — nothing is deleted.
 *  - discarded/superseded/rolled_back/closed=default outlined: ScenariosTab
 *    discarded and WaterfallTab rolled_back/superseded are already 'default';
 *    outlined recedes them further. closed deviates from caseWorkspace's green
 *    tokens.ok — in the unified vocabulary success is reserved for states with
 *    a LIVE governed effect, and a closed case has none.
 *  - running=info: deviates from WaterfallTab's 'warning' — here warning means
 *    "a human must act", and a machine in flight asks nothing of anyone.
 *  - open/submitted/in_progress (from caseWorkspace STATUS): submitted =
 *    tokens.watch (amber) → warning; in_progress = tokens.action (blue) → info;
 *    open = tokens.ink (slate) has no MUI twin — warning chosen because an open
 *    case sits on someone's plate (the worklist treats it as actionable),
 *    matching the "a human must act" family.
 *
 * Unknown statuses degrade gracefully to a default chip with the raw label —
 * a new backend status can never crash a surface.
 */
import type { FC } from 'react';
import { Chip } from '@mui/material';
import type { ChipProps } from '@mui/material';

export interface StatusMeta {
  label: string;
  color: NonNullable<ChipProps['color']>;
  variant?: 'outlined' | 'filled';
}

export const STATUS_META: Record<string, StatusMeta> = {
  // inert — nothing governed yet
  draft: { label: 'Draft', color: 'default' },
  unmapped: { label: 'Unmapped', color: 'default' },
  // machine-produced / in-flight
  proposed: { label: 'Proposed', color: 'info' },
  tested: { label: 'Tested', color: 'info' },
  running: { label: 'Running', color: 'info' },
  in_progress: { label: 'In progress', color: 'info' },
  // a human must act
  in_review: { label: 'In review', color: 'warning' },
  pending: { label: 'Pending', color: 'warning' },
  open: { label: 'Open', color: 'warning' },
  submitted: { label: 'Submitted', color: 'warning' },
  // live governed effect
  active: { label: 'Active', color: 'success' },
  applied: { label: 'Applied', color: 'success' },
  promoted: { label: 'Promoted', color: 'success' },
  approved: { label: 'Approved', color: 'success' },
  // the gate said no
  rejected: { label: 'Returned', color: 'error' },
  failed: { label: 'Failed', color: 'error' },
  // terminal and inert
  discarded: { label: 'Discarded', color: 'default', variant: 'outlined' },
  superseded: { label: 'Superseded', color: 'default', variant: 'outlined' },
  rolled_back: { label: 'Rolled back', color: 'default', variant: 'outlined' },
  closed: { label: 'Closed', color: 'default', variant: 'outlined' },
};

interface Props {
  status: string;
  /** Chip size — default small (the app's compact 20px table chip). */
  size?: 'small' | 'medium';
}

const LifecycleChip: FC<Props> = ({ status, size = 'small' }) => {
  const meta = STATUS_META[status];
  return (
    <Chip
      size={size}
      color={meta?.color ?? 'default'}
      variant={meta?.variant ?? 'filled'}
      label={meta?.label ?? status}
      sx={size === 'small' ? { height: 20, fontSize: 11, fontWeight: 700 } : { fontWeight: 700 }}
    />
  );
};

export default LifecycleChip;
