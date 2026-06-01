import type { ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import AppShell from '@/shared/components/layout/AppShell';
import { useProcess } from '../registry/useProcesses';
import { getBinding } from '../bindings';
import type { BindableTab, BindingCtx, TabKey } from '../bindings/types';
import ProcessHeader from './ProcessHeader';
import EmptyTabState from './EmptyTabState';
import AuditTab from '../audit/AuditTab';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'worklist', label: 'Worklist' },
  { key: 'inputs', label: 'Inputs' },
  { key: 'calculation', label: 'Calculation' },
  { key: 'outputs', label: 'Outputs' },
  { key: 'audit', label: 'Audit' },
  { key: 'docs', label: 'Docs' },
];
const TAB_KEYS = TABS.map((t) => t.key);
const labelFor = (key: TabKey) => TABS.find((t) => t.key === key)?.label ?? key;

export default function ProcessShell() {
  const { otpId, tab } = useParams();
  const navigate = useNavigate();
  const { def, loading } = useProcess(otpId);

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

  const activeTab: TabKey = (tab && TAB_KEYS.includes(tab as TabKey) ? tab : 'overview') as TabKey;
  const binding = getBinding(def);
  const ctx: BindingCtx = { def };
  const KpisComp = binding.kpis;
  const primary = binding.primaryAction?.(ctx);

  let body: ReactNode;
  if (activeTab === 'audit') {
    body = <AuditTab def={def} />;
  } else {
    const TabComp = binding.tabs?.[activeTab as BindableTab];
    body = TabComp ? <TabComp def={def} /> : <EmptyTabState label={labelFor(activeTab)} />;
  }

  return (
    <AppShell pageTitle={`${def.id} · ${def.name}`}>
      <Stack spacing={2.5}>
        <ProcessHeader def={def} />
        {KpisComp && <KpisComp def={def} />}

        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs
            value={activeTab}
            onChange={(_, v) => navigate(`/process/${def.id}/${v}`)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
          >
            {TABS.map((t) => (
              <Tab key={t.key} value={t.key} label={t.label} sx={{ fontWeight: 600, textTransform: 'none' }} />
            ))}
          </Tabs>
        </Box>

        <Box>{body}</Box>

        {primary && (
          <Paper
            variant="outlined"
            sx={{ position: 'sticky', bottom: 16, p: 1.5, display: 'flex', justifyContent: 'flex-end', gap: 1.5, alignItems: 'center', bgcolor: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(4px)' }}
          >
            {primary.hint && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{primary.hint}</Typography>
            )}
            <Button variant="contained" size="large" disabled={primary.disabled}>
              {primary.label}
            </Button>
          </Paper>
        )}
      </Stack>
    </AppShell>
  );
}
