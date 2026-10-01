import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '@/shared/components/layout/AppShell';
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
} from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
// Use Settings as a stand-in for the row menu icon since both are in the bundle
import SettingsIcon from '@mui/icons-material/Settings';
import { useInvoices, useSettings } from '@/shared/providers/DataProvider';
import type { Invoice } from '@/shared/types/transaction';
import { useAdjustmentLifecycle } from '@/shared/hooks/useAdjustmentLifecycle';

const statusStyle: Record<string, { bg: string; color: string }> = {
  Draft: { bg: '#F1F5F9', color: '#475569' },
  'Pending Approval': { bg: '#FEF3C7', color: '#B45309' },
  Approved: { bg: '#DCFCE7', color: '#15803D' },
  Exported: { bg: '#EFF6FF', color: '#1D4ED8' },
  Rejected: { bg: '#FEE2E2', color: '#B91C1C' },
  Reversed: { bg: '#F3E8FF', color: '#6D28D9' },
};

export default function Invoicing() {
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; invId: string } | null>(null);
  const [viewing, setViewing] = useState<Invoice | null>(null);
  /** Submitted rows ARE adjustments (their id is the adj id) — their record of
   *  truth is the evidence packet. Synthesized flow buckets open a detail view. */
  const view = (inv: Invoice) => {
    if (inv.submitted) navigate(`/evidence/${encodeURIComponent(`adj:${inv.id}`)}`);
    else setViewing(inv);
  };
  const invoices = useInvoices();
  const settings = useSettings();
  // No approve/reject here — the /review maker-checker queue is the ONLY approval
  // door (it promotes the adjustment server-side). Invoicing owns export/reverse/delete.
  const { markExported, reverse, remove, pending } = useAdjustmentLifecycle();

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
                        <Button size="small" variant="outlined" onClick={() => view(inv)}>
                          View
                        </Button>
                        {isSubmitted && inv.status === 'Pending Approval' && (
                          <Tooltip title="Approval is a maker-checker step — open the review queue">
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => navigate('/review')}>
                              Open in review
                            </Button>
                          </Tooltip>
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
      <Dialog open={!!viewing} onClose={() => setViewing(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {viewing?.id}
          <Typography variant="body2" sx={{ color: '#64748B' }}>
            {viewing?.type} · {viewing?.date}
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          {viewing && (
            <Stack spacing={1.25}>
              {[
                ['Payor', viewing.payor],
                ['Payee', viewing.payee],
                ['Period', viewing.period ? `${viewing.year ?? ''} · ${viewing.period}` : String(viewing.year ?? '—')],
                ['Material type', viewing.materialType ?? '—'],
                ['Status', viewing.status],
              ].map(([k, v]) => (
                <Stack key={k} direction="row" justifyContent="space-between">
                  <Typography variant="body2" sx={{ color: '#64748B' }}>{k}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{v}</Typography>
                </Stack>
              ))}
              <Divider />
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" sx={{ color: '#64748B' }}>Cost base</Typography>
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {viewing.costBase != null ? `${new Intl.NumberFormat('en-US').format(Math.round(viewing.costBase))} ${viewing.currency}` : '—'}
                </Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" sx={{ color: '#64748B' }}>Blended markup</Typography>
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {viewing.markup != null ? `${(viewing.markup * 100).toFixed(1)}%` : '—'}
                </Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" sx={{ color: '#64748B' }}>Source lines (supply_chain_flows)</Typography>
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{viewing.lines ?? '—'}</Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" sx={{ fontWeight: 700 }}>Invoice amount</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {new Intl.NumberFormat('en-US').format(Math.round(viewing.amount))} {viewing.currency}
                </Typography>
              </Stack>
              <Typography variant="caption" sx={{ color: '#94A3B8' }}>
                Synthesized from the warehouse supply-chain flows for the selected period (Σ standard cost × volume,
                marked up). Adjustment-backed invoices open their evidence packet instead.
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewing(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
