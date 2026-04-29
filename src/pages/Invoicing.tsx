import React, { useMemo, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import {
  Paper,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Box,
  Stack,
  Button,
  Grid,
  Checkbox,
  Tabs,
  Tab,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import CheckIcon from '@mui/icons-material/Check';
import MoreVertIcon from '@mui/icons-material/Add'; // Add icon already in deps; using as kebab placeholder is silly — use a simpler char marker
// Use Settings as a stand-in for the row menu icon since both are in the bundle
import SettingsIcon from '@mui/icons-material/Settings';
import { useInvoices, useAdjustmentLifecycle, useSettings } from '../data/DataProvider';

const statusStyle: Record<string, { bg: string; color: string }> = {
  Draft: { bg: '#F1F5F9', color: '#475569' },
  'Pending Approval': { bg: '#FEF3C7', color: '#B45309' },
  Approved: { bg: '#DCFCE7', color: '#15803D' },
  Exported: { bg: '#EFF6FF', color: '#1D4ED8' },
  Rejected: { bg: '#FEE2E2', color: '#B91C1C' },
  Reversed: { bg: '#F3E8FF', color: '#6D28D9' },
};

export default function Invoicing() {
  const [tab, setTab] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; invId: string } | null>(null);
  const invoices = useInvoices();
  const settings = useSettings();
  const { approve, markExported, reverse, remove, pending } = useAdjustmentLifecycle();

  const filtered = useMemo(() => invoices.filter((i) => {
    if (tab === 0) return true;
    if (tab === 1) return i.status === 'Pending Approval';
    if (tab === 2) return i.status === 'Approved';
    if (tab === 3) return i.status === 'Exported';
    return true;
  }), [invoices, tab]);

  // KPI cards now derived from live data instead of hardcoded
  const counts = useMemo(() => {
    let pendingN = 0, approvedN = 0, exportedN = 0;
    let totalValue = 0;
    for (const i of invoices) {
      if (i.status === 'Pending Approval') pendingN++;
      else if (i.status === 'Approved') approvedN++;
      else if (i.status === 'Exported') exportedN++;
      // Total value across non-reversed/rejected rows
      if (i.status !== 'Reversed' && i.status !== 'Rejected') totalValue += Math.abs(i.amount);
    }
    return { pendingN, approvedN, exportedN, totalValue };
  }, [invoices]);

  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((i) => i !== id) : [...s, id]
    );

  /** Selected ids that are submitted (i.e., real adjustments — actionable). */
  const selectedSubmitted = useMemo(
    () => invoices.filter((i) => selected.includes(i.id) && i.submitted),
    [invoices, selected]
  );

  const bulkApprove = async () => {
    const targets = selectedSubmitted.filter((i) => i.status === 'Pending Approval');
    for (const i of targets) {
      await approve(i.id, settings.defaultReviewer);
    }
    setSelected([]);
  };

  const bulkExport = async () => {
    const targets = selectedSubmitted.filter((i) => i.status === 'Approved');
    for (const i of targets) {
      await markExported(i.id, `EXP-${Date.now().toString(36).slice(-6).toUpperCase()}`);
    }
    setSelected([]);
  };

  const openMenu = (e: React.MouseEvent<HTMLElement>, invId: string) =>
    setMenu({ anchor: e.currentTarget, invId });
  const closeMenu = () => setMenu(null);

  const menuTarget = menu ? invoices.find((i) => i.id === menu.invId) : null;

  return (
    <AppShell pageTitle="Intercompany Invoicing">
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid item xs={6} md={3}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>
              Pending Approval
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, color: '#D97706' }}>
              {counts.pendingN}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>
              Approved
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, color: '#16A34A' }}>
              {counts.approvedN}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>
              Exported
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              {counts.exportedN}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>
              Total Active Value
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              ${(counts.totalValue / 1_000_000).toFixed(1)}M
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      <Paper sx={{ p: 2.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab label="All" />
            <Tab label="Pending approval" />
            <Tab label="Approved" />
            <Tab label="Exported" />
          </Tabs>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button variant="contained" startIcon={<PlayArrowIcon />} disabled>
              Generate invoices
            </Button>
            <Tooltip
              title={
                selectedSubmitted.length === 0
                  ? 'Select submitted (ADJ-) rows to approve'
                  : `Approve ${selectedSubmitted.filter((i) => i.status === 'Pending Approval').length} pending row(s)`
              }>
              <span>
                <Button
                  variant="outlined"
                  startIcon={<CheckIcon />}
                  disabled={
                    pending ||
                    !selectedSubmitted.some((i) => i.status === 'Pending Approval')
                  }
                  onClick={bulkApprove}>
                  Approve selected ({selectedSubmitted.filter((i) => i.status === 'Pending Approval').length})
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Mark approved adjustments as exported (booked to GL)">
              <span>
                <Button
                  variant="outlined"
                  startIcon={<FileDownloadIcon />}
                  disabled={
                    pending ||
                    !selectedSubmitted.some((i) => i.status === 'Approved')
                  }
                  onClick={bulkExport}>
                  Mark exported ({selectedSubmitted.filter((i) => i.status === 'Approved').length})
                </Button>
              </span>
            </Tooltip>
          </Stack>
        </Stack>

        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 900 }}>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox"></TableCell>
                <TableCell>Invoice ID</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Payor</TableCell>
                <TableCell>Payee</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Currency</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((inv) => {
                const style = statusStyle[inv.status] ?? statusStyle.Draft;
                const isSubmitted = !!inv.submitted;
                return (
                  <TableRow
                    key={inv.id}
                    hover
                    sx={isSubmitted ? { bgcolor: 'rgba(37, 99, 235, 0.04)' } : undefined}>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selected.includes(inv.id)}
                        onChange={() => toggle(inv.id)}
                        disabled={!isSubmitted} />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <span>{inv.id}</span>
                        {isSubmitted && (
                          <Chip
                            label="ADJ"
                            size="small"
                            sx={{
                              bgcolor: '#EFF6FF',
                              color: '#1D4ED8',
                              fontWeight: 700,
                              height: 18,
                              fontSize: 10
                            }} />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>{inv.date}</TableCell>
                    <TableCell>{inv.payor}</TableCell>
                    <TableCell>{inv.payee}</TableCell>
                    <TableCell>{inv.type}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {new Intl.NumberFormat('en-US').format(Math.round(inv.amount))}
                    </TableCell>
                    <TableCell>{inv.currency}</TableCell>
                    <TableCell>
                      <Chip
                        label={inv.status}
                        size="small"
                        sx={{
                          bgcolor: style.bg,
                          color: style.color,
                          fontWeight: 700
                        }} />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Button size="small" variant="outlined">
                          View
                        </Button>
                        {isSubmitted && inv.status === 'Pending Approval' && (
                          <Button
                            size="small"
                            variant="contained"
                            disabled={pending}
                            onClick={() => approve(inv.id, settings.defaultReviewer)}>
                            Approve
                          </Button>
                        )}
                        {isSubmitted && (
                          <IconButton
                            size="small"
                            aria-label="Row actions"
                            onClick={(e) => openMenu(e, inv.id)}>
                            <SettingsIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      </Paper>

      {/* Per-row action menu — only meaningful for submitted adjustments */}
      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={closeMenu}>
        <MenuItem
          disabled={!menuTarget || pending || menuTarget.status !== 'Approved'}
          onClick={async () => {
            if (menuTarget)
              await markExported(
                menuTarget.id,
                `EXP-${Date.now().toString(36).slice(-6).toUpperCase()}`
              );
            closeMenu();
          }}>
          Mark exported…
        </MenuItem>
        <MenuItem
          disabled={
            !menuTarget ||
            pending ||
            !(menuTarget.status === 'Approved' || menuTarget.status === 'Exported')
          }
          onClick={async () => {
            if (menuTarget) await reverse(menuTarget.id, settings.defaultReviewer);
            closeMenu();
          }}>
          Reverse (creates counter)
        </MenuItem>
        <MenuItem
          disabled={!menuTarget || pending || menuTarget.status !== 'Pending Approval'}
          onClick={async () => {
            if (menuTarget) await remove(menuTarget.id);
            closeMenu();
          }}
          sx={{ color: '#DC2626' }}>
          Delete (only while pending)
        </MenuItem>
      </Menu>
    </AppShell>
  );
}
