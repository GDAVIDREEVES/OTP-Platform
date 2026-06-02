import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  AppBar,
  Toolbar,
  IconButton,
  Badge,
  Avatar,
  Select,
  MenuItem,
  Menu,
  FormControl,
  Chip,
  Stack,
  Divider,
  Tooltip,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import DashboardIcon from '@mui/icons-material/SpaceDashboard';
import GridViewIcon from '@mui/icons-material/GridView';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import HomeIcon from '@mui/icons-material/Home';
import CalculateIcon from '@mui/icons-material/Calculate';
import PolicyIcon from '@mui/icons-material/Policy';
import PieChartIcon from '@mui/icons-material/PieChart';
import PaidIcon from '@mui/icons-material/Paid';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import PsychologyIcon from '@mui/icons-material/Psychology';
import SummarizeIcon from '@mui/icons-material/Summarize';
import SettingsIcon from '@mui/icons-material/Settings';
import NotificationsIcon from '@mui/icons-material/Notifications';
import MenuIcon from '@mui/icons-material/Menu';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import RefreshIcon from '@mui/icons-material/RestartAlt';
import ResearchBrainFab from '@/features/research-brain/ResearchBrainFab';
import ResearchBrainPanel from '@/features/research-brain/ResearchBrainPanel';
import {
  useLastFetchedAt,
  useRefetch,
  useRefreshing,
  usePeriod,
  useSetPeriod,
  useSetYear,
  useAvailableYears,
} from '@/shared/providers/DataProvider';
import { periodLabel } from '@/shared/utils/period';
import { useSession } from '@/shared/providers/SessionProvider';
import type { PeriodKey } from '@/shared/types/period';

const DRAWER_WIDTH = 248;
const navItems = [
  { label: 'Home', icon: <HomeIcon />, path: '/home' },
  { label: 'Master Data', icon: <AccountTreeIcon />, path: '/master-data' },
  { label: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
  { label: 'Processes', icon: <GridViewIcon />, path: '/process' },
  { label: 'Review queue', icon: <FactCheckIcon />, path: '/review' },
  { label: 'Price Setting', icon: <CalculateIcon />, path: '/price-setting' },
  { label: 'Policy', icon: <PolicyIcon />, path: '/policy' },
  { label: 'Segmented P&L', icon: <PieChartIcon />, path: '/segmented-pnl' },
  { label: 'Royalties', icon: <PaidIcon />, path: '/royalties' },
  { label: 'Invoicing', icon: <ReceiptLongIcon />, path: '/invoicing' },
  { label: 'Research Brain', icon: <PsychologyIcon />, path: '/research-brain' },
  { label: 'Reports', icon: <SummarizeIcon />, path: '/reports' },
  { label: 'Settings', icon: <SettingsIcon />, path: '/settings' },
];

interface Props {
  pageTitle: string;
  children: React.ReactNode;
}

/** Render "Data as of …" using a relative phrase that auto-rolls. */
function formatAsOf(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function AppShell({ pageTitle, children }: Props) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const location = useLocation();
  const navigate = useNavigate();
  const { user, role, setRole, users } = useSession();
  const [roleAnchor, setRoleAnchor] = useState<null | HTMLElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const lastFetchedAt = useLastFetchedAt();
  const refetch = useRefetch();
  const refreshing = useRefreshing();
  const period = usePeriod();
  const setPeriod = useSetPeriod();
  const setYear = useSetYear();
  const availableYears = useAvailableYears();
  // re-render once a minute so the "as of" chip stays fresh without polling
  const [, forceTick] = useState(0);
  React.useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const drawer = (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: '#0F172A',
        color: '#E2E8F0',
      }}
    >
      <Box
        sx={{
          px: 2.5,
          py: 2.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: 1,
            bgcolor: '#2563EB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 800,
          }}
        >
          O
        </Box>
        <Box>
          <Typography
            variant="subtitle2"
            sx={{
              color: 'white',
              fontWeight: 700,
              lineHeight: 1.1,
            }}
          >
            OTP Platform
          </Typography>
          <Typography variant="caption" sx={{ color: '#94A3B8' }}>
            by Aperture Tax
          </Typography>
        </Box>
      </Box>
      <Divider sx={{ borderColor: '#1E293B' }} />

      <List sx={{ flex: 1, px: 1.5, py: 2 }}>
        {navItems.map((item) => {
          const active = location.pathname.startsWith(item.path);
          return (
            <ListItemButton
              key={item.path}
              component={Link}
              to={item.path}
              onClick={() => isMobile && setMobileOpen(false)}
              sx={{
                borderRadius: 1.5,
                mb: 0.5,
                py: 1,
                px: 1.5,
                color: active ? 'white' : '#94A3B8',
                bgcolor: active ? 'rgba(37, 99, 235, 0.18)' : 'transparent',
                '&:hover': {
                  bgcolor: active
                    ? 'rgba(37, 99, 235, 0.25)'
                    : 'rgba(255,255,255,0.04)',
                  color: 'white',
                },
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: 36,
                  color: active ? '#60A5FA' : '#64748B',
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{
                  fontSize: 14,
                  fontWeight: active ? 600 : 500,
                }}
              />
            </ListItemButton>
          );
        })}
      </List>
      <Divider sx={{ borderColor: '#1E293B' }} />

      <Box
        sx={{
          px: 2,
          py: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <Avatar
          sx={{
            bgcolor: '#2563EB',
            width: 36,
            height: 36,
            fontSize: 14,
          }}
        >
          {user.initials}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{ color: 'white', fontWeight: 600, lineHeight: 1.2 }}
          >
            {user.name}
          </Typography>
          <Typography variant="caption" sx={{ color: '#94A3B8' }}>
            {user.title}
          </Typography>
        </Box>
        <IconButton
          size="small"
          sx={{ color: '#64748B' }}
          onClick={() => navigate('/settings')}
          aria-label="Settings"
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#F8FAFC' }}>
      <Box
        component="nav"
        sx={{
          width: { md: DRAWER_WIDTH },
          flexShrink: { md: 0 },
        }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH, border: 0 },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              border: 0,
              position: 'fixed',
              height: '100vh',
            },
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <AppBar
          position="sticky"
          elevation={0}
          sx={{
            bgcolor: 'white',
            color: '#0F172A',
            borderBottom: '1px solid #E2E8F0',
          }}
        >
          <Toolbar
            sx={{
              gap: 2,
              minHeight: { xs: 60, md: 68 },
            }}
          >
            <IconButton
              edge="start"
              onClick={() => setMobileOpen(true)}
              sx={{ display: { md: 'none' } }}
              aria-label="Open navigation"
            >
              <MenuIcon />
            </IconButton>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                flex: 1,
                fontSize: { xs: 16, md: 18 },
              }}
            >
              {pageTitle}
            </Typography>

            <Stack direction="row" spacing={1.5} alignItems="center">
              {availableYears.length > 1 && (
                <FormControl
                  size="small"
                  sx={{
                    display: { xs: 'none', sm: 'block' },
                    minWidth: 110,
                  }}
                >
                  <Select
                    value={period.year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    disabled={refreshing}
                    sx={{ fontSize: 14, bgcolor: '#F8FAFC' }}
                  >
                    {availableYears.map((y) => (
                      <MenuItem key={y} value={y}>
                        FY{y}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <FormControl
                size="small"
                sx={{
                  display: { xs: 'none', sm: 'block' },
                  minWidth: 180,
                }}
              >
                <Select
                  value={period.key}
                  onChange={(e) => setPeriod(e.target.value as PeriodKey)}
                  disabled={refreshing}
                  sx={{ fontSize: 14, bgcolor: '#F8FAFC' }}
                >
                  {(['fy', 'q1', 'q2', 'q3', 'q4'] as const).map((k) => (
                    <MenuItem key={k} value={k}>
                      {availableYears.length > 1
                        ? periodLabel(k)
                        : `FY${period.year} — ${periodLabel(k)}`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Tooltip
                title={`Data fetched at ${lastFetchedAt.toLocaleTimeString()}`}
                arrow
              >
                <Chip
                  icon={
                    <CloudDoneIcon
                      sx={{ fontSize: 16, color: '#16A34A !important' }}
                    />
                  }
                  label={`As of ${formatAsOf(lastFetchedAt)}`}
                  size="small"
                  sx={{
                    display: { xs: 'none', lg: 'flex' },
                    bgcolor: '#F8FAFC',
                    color: '#475569',
                    border: '1px solid #E2E8F0',
                    fontWeight: 500,
                  }}
                />
              </Tooltip>

              <Tooltip
                title={refreshing ? 'Refreshing…' : 'Refresh data from SAP'}
                arrow
              >
                <span>
                  <IconButton
                    aria-label="Refresh data"
                    onClick={() => void refetch()}
                    disabled={refreshing}
                    sx={{
                      color: refreshing ? '#94A3B8' : '#475569',
                      '& svg': {
                        animation: refreshing
                          ? 'otp-spin 0.9s linear infinite'
                          : 'none',
                      },
                      '@keyframes otp-spin': {
                        '0%': { transform: 'rotate(0deg)' },
                        '100%': { transform: 'rotate(360deg)' },
                      },
                    }}
                  >
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip title="Notifications">
                <IconButton aria-label="Notifications">
                  <Badge badgeContent={3} color="error">
                    <NotificationsIcon />
                  </Badge>
                </IconButton>
              </Tooltip>

              <Tooltip title={`${user.name} — switch role`} arrow>
                <IconButton onClick={(e) => setRoleAnchor(e.currentTarget)} sx={{ p: 0.5 }} aria-label="Switch role">
                  <Avatar sx={{ bgcolor: '#2563EB', width: 36, height: 36, fontSize: 14 }}>{user.initials}</Avatar>
                </IconButton>
              </Tooltip>
              <Menu anchorEl={roleAnchor} open={!!roleAnchor} onClose={() => setRoleAnchor(null)}>
                {users.map((u) => (
                  <MenuItem
                    key={u.id}
                    selected={u.role === role}
                    onClick={() => {
                      setRole(u.role);
                      setRoleAnchor(null);
                    }}
                  >
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{u.name}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{u.title}</Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Menu>
            </Stack>
          </Toolbar>
        </AppBar>

        <Box
          component="main"
          sx={{
            flex: 1,
            p: { xs: 2, md: 3 },
            minWidth: 0,
          }}
        >
          {children}
        </Box>
      </Box>

      <ResearchBrainFab />
      <ResearchBrainPanel />
    </Box>
  );
}
