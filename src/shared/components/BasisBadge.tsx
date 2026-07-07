/**
 * BasisBadge — THE P&L-basis indicator for every margin-bearing surface.
 *
 * Generalizes OTP-20's PostChargeChip and adds the missing pre-charge warning
 * state: nobody should decide on a margin without knowing whether the
 * intercompany charges are in it. Two states:
 *  - post-charge (blue): the governed pl.use_post_charge toggle is ON and a
 *    waterfall run is applied — reads include the applied IC charges.
 *  - pre-charge (amber): anything else — the label and tooltip distinguish
 *    "no run applied" from "run applied but the basis toggle is off".
 * Clicking navigates to the waterfall console, where the fix lives.
 *
 * Data comes from the already-fetched close status (useBasis) — ZERO extra
 * fetches; renders nothing until the first close-status fetch lands, and
 * repaints live whenever a run is applied/rolled back or the toggle flips
 * (WorkSignalsProvider refresh).
 */
import type { FC, MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chip, Tooltip } from '@mui/material';
import { useBasis } from '@/shared/providers/WorkSignalsProvider';

interface Props {
  /** Chip size — default small; medium only where a surface needs the weight. */
  size?: 'small' | 'medium';
}

const BasisBadge: FC<Props> = ({ size = 'small' }) => {
  const navigate = useNavigate();
  const basis = useBasis();
  if (!basis) return null; // close status not fetched yet — say nothing rather than guess

  // Deliberately derive the EFFECTIVE basis (toggle on AND a run applied)
  // instead of trusting basis.mode: mode only reflects the parameter, so after
  // a rollback with the toggle still on it would claim post-charge while every
  // read is on the base P&L. Any surface echoing the basis must use this same
  // predicate so the platform never contradicts itself.
  const postCharge = basis.param_on && basis.applied_run_id !== null;
  const runApplied = basis.applied_run_id !== null;
  const label = postCharge
    ? `Post-charge P&L · ${basis.applied_run_id} applied`
    : runApplied
      ? 'Pre-charge P&L — basis toggle off'
      : 'Pre-charge P&L — waterfall not applied';
  const tooltip = postCharge
    ? `Margins and KPIs on this screen are on the POST-CHARGE P&L basis — base segment_pl plus waterfall ${basis.applied_run_id}'s applied IC charges (governed by pl.use_post_charge). Click to open the waterfall console.`
    : runApplied
      ? 'A waterfall run is applied but the post-charge basis toggle is off — reads are on the base P&L. Click to open the waterfall console.'
      : 'No waterfall run is applied — margins and KPIs are on the base P&L, before intercompany charges. Click to open the waterfall console.';

  const open = (e: MouseEvent) => {
    e.stopPropagation(); // the badge may sit inside clickable rows (close stepper)
    navigate('/calc-studio/waterfall');
  };

  return (
    // describeChild: the visible label IS the accessible name (no label-in-name
    // mismatch) and the tooltip reaches assistive tech as a description.
    <Tooltip title={tooltip} arrow describeChild>
      <Chip
        size={size}
        color={postCharge ? 'primary' : 'warning'}
        variant="outlined"
        label={label}
        onClick={open}
        sx={{ fontWeight: 700 }}
      />
    </Tooltip>
  );
};

export default BasisBadge;
