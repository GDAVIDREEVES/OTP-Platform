import type { ReactNode } from 'react';
import DashboardIcon from '@mui/icons-material/SpaceDashboard';
import GridViewIcon from '@mui/icons-material/GridView';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import HomeIcon from '@mui/icons-material/Home';
import PolicyIcon from '@mui/icons-material/Policy';
import PieChartIcon from '@mui/icons-material/PieChart';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import PsychologyIcon from '@mui/icons-material/Psychology';
import SummarizeIcon from '@mui/icons-material/Summarize';
import SettingsIcon from '@mui/icons-material/Settings';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import FunctionsIcon from '@mui/icons-material/Functions';
import GppMaybeIcon from '@mui/icons-material/GppMaybe';
import type { Role } from '@/shared/providers/SessionProvider';

/** One entry in the nav rail.
 *
 *  `matchPrefixes` are extra path roots (beyond `path`) that should light this
 *  item up — orphan routes with no nav entry of their own highlight their
 *  parent (e.g. `/entities/:id` → Monitoring, `/evidence/:ref` → Processes).
 *
 *  `roles` gates VISIBILITY only; the route itself stays unconditional in
 *  App.tsx so deep links and role switching keep working. */
export interface NavItem {
  label: string;
  icon: ReactNode;
  path: string;
  matchPrefixes?: string[];
  roles?: Role[];
}

export interface NavSection {
  header: string;
  items: NavItem[];
}

/** The grouped nav rail. Sections read top-down as the working day: what's on
 *  my plate → the close itself → modeling → the data feeding it → the read-outs
 *  → admin. Price Setting & Royalties intentionally leave the rail (their routes
 *  remain in App.tsx); they are reached through the process shell. */
export const NAV_SECTIONS: NavSection[] = [
  {
    header: 'My work',
    items: [
      { label: 'Home', icon: <HomeIcon />, path: '/home' },
      { label: 'Review queue', icon: <FactCheckIcon />, path: '/review' },
    ],
  },
  {
    header: 'Close',
    items: [
      { label: 'Processes', icon: <GridViewIcon />, path: '/process', matchPrefixes: ['/process', '/evidence'] },
      { label: 'Monitoring', icon: <DashboardIcon />, path: '/dashboard', matchPrefixes: ['/dashboard', '/entities', '/adjustment'] },
      { label: 'Invoices', icon: <ReceiptLongIcon />, path: '/invoicing' },
      { label: 'Segmented P&L', icon: <PieChartIcon />, path: '/segmented-pnl' },
    ],
  },
  {
    header: 'Modeling',
    items: [
      { label: 'Calc Studio', icon: <FunctionsIcon />, path: '/calc-studio' },
    ],
  },
  {
    header: 'Data',
    items: [
      { label: 'Master Data', icon: <AccountTreeIcon />, path: '/master-data' },
      { label: 'Policies', icon: <PolicyIcon />, path: '/policy' },
    ],
  },
  {
    header: 'Insight',
    items: [
      { label: 'Reports', icon: <SummarizeIcon />, path: '/reports' },
      { label: 'Exposure & Risk', icon: <GppMaybeIcon />, path: '/director', roles: ['director'] },
      { label: 'Research Brain', icon: <PsychologyIcon />, path: '/research-brain' },
    ],
  },
  {
    header: 'Admin',
    items: [
      { label: 'Settings', icon: <SettingsIcon />, path: '/settings' },
    ],
  },
];

/** Longest-prefix winner across every item's `path` + `matchPrefixes`. A path
 *  matches a prefix when it equals it or sits beneath it (`prefix + '/'`), so
 *  `/reports` never matches `/review`, and `/director` resolves to Exposure &
 *  Risk rather than Monitoring. Returns null when nothing matches (e.g. login). */
export function activeNavItem(pathname: string): NavItem | null {
  let best: NavItem | null = null;
  let bestLen = -1;
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      const prefixes = [item.path, ...(item.matchPrefixes ?? [])];
      for (const prefix of prefixes) {
        const matches = pathname === prefix || pathname.startsWith(prefix + '/');
        if (matches && prefix.length > bestLen) {
          bestLen = prefix.length;
          best = item;
        }
      }
    }
  }
  return best;
}
