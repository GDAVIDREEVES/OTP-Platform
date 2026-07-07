import { useState, type ReactNode } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import AppShell from '@/shared/components/layout/AppShell';
import { useProcess, useProcesses } from '../registry/useProcesses';
import { FALLBACK_CATALOG } from '../registry/fallback';
import { getBinding } from '../bindings';
import type { BindableTab, TabKey } from '../bindings/types';
import ProcessHeader from './ProcessHeader';
import EmptyTabState from './EmptyTabState';
import AuditTab from '../audit/AuditTab';
import AuditRail from '../audit/AuditRail';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'worklist', label: 'Worklist' },
  { key: 'inputs', label: 'Inputs' },
  { key: 'calculation', label: 'Calculation' },
  { key: 'outputs', label: 'Outputs' },
  { key: 'audit', label: 'Audit' },
  { key: 'docs', label: 'Docs' },
];
const labelFor = (key: TabKey) => TABS.find((t) => t.key === key)?.label ?? key;

export default function ProcessShell() {
  const { otpId, tab } = useParams();
  const navigate = useNavigate();
  const { def, loading } = useProcess(otpId);
  const { catalog } = useProcesses();
  const [railOpen, setRailOpen] = useState(false);

  if (loading) {
    return (
      <AppShell pageTitle="Loading…">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress />
        </Box>
      </AppShell>
    );
  }

  if (!def) {
    return (
      <AppShell pageTitle="Unknown process">
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => navigate('/process')}>
              Library
            </Button>
          }
        >
          No process &ldquo;{otpId}&rdquo; in the catalog.
        </Alert>
      </AppShell>
    );
  }

  const binding = getBinding(def);
  // Only tabs a binding actually wires are shown; 'audit' is shell-owned
  // (keyed by process_id, not by binding.tabs) so it is ALWAYS visible.
  const visibleTabs = TABS.filter(
    (t) => t.key === 'audit' || !!binding.tabs?.[t.key as BindableTab],
  );
  const isVisible = (k: string) => visibleTabs.some((t) => t.key === k);
  // A deep-link (or now-hidden tab) that isn't visible normalizes to Overview.
  const activeTab: TabKey = tab && isVisible(tab) ? (tab as TabKey) : 'overview';
  if (tab && activeTab !== tab) {
    return <Navigate to={`/process/${def.id}/overview`} replace />;
  }

  const catLabel =
    catalog?.categories?.[def.category] ?? FALLBACK_CATALOG.categories[def.category] ?? def.category;
  const crumbs = [
    { label: 'Processes', to: '/process' },
    { label: catLabel, to: `/process?cat=${def.category}` },
    { label: `${def.id} · ${def.name}`, to: `/process/${def.id}/overview` },
    { label: labelFor(activeTab) },
  ];
  const KpisComp = binding.kpis;

  let body: ReactNode;
  if (activeTab === 'audit') {
    body = <AuditTab def={def} />;
  } else {
    const TabComp = binding.tabs?.[activeTab as BindableTab];
    body = TabComp ? <TabComp def={def} /> : <EmptyTabState label={labelFor(activeTab)} />;
  }

  return (
    <AppShell pageTitle={`${def.id} · ${def.name}`} breadcrumbs={crumbs}>
      <Stack spacing={2.5}>
        <ProcessHeader def={def} />
        {KpisComp && <KpisComp def={def} />}

        <Box sx={{ borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
          <Tabs
            value={activeTab}
            onChange={(_, v) => navigate(`/process/${def.id}/${v}`)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{ flex: 1, minWidth: 0 }}
          >
            {visibleTabs.map((t) => (
              <Tab key={t.key} value={t.key} label={t.label} sx={{ fontWeight: 600, textTransform: 'none' }} />
            ))}
          </Tabs>
          <Tooltip title="Audit & provenance" arrow>
            <IconButton onClick={() => setRailOpen((o) => !o)} aria-label="Toggle audit rail" color={railOpen ? 'primary' : 'default'}>
              <HistoryIcon />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>{body}</Box>
          {railOpen && <AuditRail def={def} onClose={() => setRailOpen(false)} />}
        </Box>
      </Stack>
    </AppShell>
  );
}
