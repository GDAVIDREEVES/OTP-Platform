import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Chip,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { useWorklist } from '@/shared/providers/WorkSignalsProvider';
import { SECTIONS } from '@/shared/components/WorklistTable';
import { WORKLIST_STATUS_AWAITING_CHECKER } from '@/shared/api/types';
import type { WorklistItem } from '@/shared/api/types';

/** Cap the dropdown at the top handful — the full plate lives on /home. */
const MAX_MENU_ITEMS = 7;

/** True when the item needs the current persona's attention. "awaiting checker"
 *  review rows are the maker's own submissions parked with someone else —
 *  passive, so they neither count toward the badge nor appear in the menu. */
const isActionable = (it: WorklistItem): boolean =>
  !(it.kind === 'review' && it.status === WORKLIST_STATUS_AWAITING_CHECKER);

/** Live notification bell: badge = actionable worklist items, dropdown = the
 *  top few with deep links, mirroring WorklistTable's kind iconography.
 *  While the worklist hasn't loaded yet (null) the bell shows with no badge. */
export default function NotificationBell() {
  const navigate = useNavigate();
  const worklist = useWorklist();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);

  const actionable = useMemo(
    () => (worklist ?? []).filter(isActionable),
    [worklist],
  );

  const go = (route: string | null) => {
    setAnchor(null);
    navigate(route ?? '/home');
  };

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton aria-label="Notifications" onClick={(e) => setAnchor(e.currentTarget)}>
          {/* badgeContent 0 auto-hides, which also covers the null (loading) state */}
          <Badge badgeContent={actionable.length} color="error">
            <NotificationsIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { width: 380, maxWidth: '90vw' } } }}
      >
        {actionable.length === 0 ? (
          <MenuItem disabled>Nothing needs your attention</MenuItem>
        ) : (
          actionable.slice(0, MAX_MENU_ITEMS).map((it) => {
            const section = SECTIONS.find((s) => s.kind === it.kind);
            return (
              <MenuItem key={`${it.kind}:${it.ref}`} onClick={() => go(it.route)}>
                <ListItemIcon sx={{ color: section?.color }}>{section?.icon}</ListItemIcon>
                <ListItemText
                  primary={it.title}
                  secondary={it.ref}
                  primaryTypographyProps={{ variant: 'body2', fontWeight: 600, noWrap: true }}
                  secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                />
                {it.process_id && (
                  <Chip size="small" label={it.process_id} sx={{ ml: 1.5, fontWeight: 700, flexShrink: 0 }} />
                )}
              </MenuItem>
            );
          })
        )}
        <Divider />
        <MenuItem onClick={() => go('/home')}>
          <ListItemText
            primary={`View all work (${actionable.length})`}
            primaryTypographyProps={{ variant: 'body2', fontWeight: 600, color: 'primary' }}
          />
        </MenuItem>
      </Menu>
    </>
  );
}
