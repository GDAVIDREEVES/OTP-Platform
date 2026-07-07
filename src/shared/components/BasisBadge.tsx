/**
 * BasisBadge — THE P&L-basis indicator for every margin-bearing surface.
 *
 * Generalizes OTP-20's PostChargeChip and adds the missing pre-charge warning
 * state: nobody should decide on a margin without knowing whether the
 * intercompany charges are in it. Two states:
 *  - post-charge (blue): the governed pl.use_post_charge toggle is ON and a
 *    waterfall run is applied — reads include the applied IC charges.
 *  - pre-charge (amber): anything else — the tooltip distinguishes "no run
 *    applied" from "run applied but the basis toggle is off".
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

  const postCharge = basis.param_on && basis.applied_run_id !== null;
  const label = postCharge
    ? `Post-charge P&L · ${basis.applied_run_id} applied`
    : 'Pre-charge P&L — waterfall not applied';
  const tooltip = postCharge
    ? `Margins and KPIs on this screen are on the POST-CHARGE P&L basis — base segment_pl plus waterfall ${basis.applied_run_id}'s applied IC charges (governed by pl.use_post_charge). Click to open the waterfall console.`
    : basis.applied_run_id !== null
      ? 'A waterfall run is applied but the post-charge basis toggle is off — reads are on the base P&L. Click to open the waterfall console.'
      : 'No waterfall run is applied — margins and KPIs are on the base P&L, before intercompany charges. Click to open the waterfall console.';

  const open = (e: MouseEvent) => {
    e.stopPropagation(); // the badge may sit inside clickable rows (close stepper)
    navigate('/calc-studio/waterfall');
  };

  return (
    <Tooltip title={tooltip} arrow>
      <Chip
        size={size}
        clickable
        color={postCharge ? 'primary' : 'warning'}
        variant="outlined"
        label={label}
        onClick={open}
        aria-label={
          postCharge
            ? `P&L basis: post-charge — waterfall ${basis.applied_run_id} applied. Open the waterfall console.`
            : 'P&L basis: pre-charge — waterfall charges not applied. Open the waterfall console.'
        }
        sx={{ fontWeight: 700 }}
      />
    </Tooltip>
  );
};

export default BasisBadge;
