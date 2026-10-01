import { useParams, useNavigate } from 'react-router-dom';
import { Box, Tabs, Tab, Typography, Chip, Stack } from '@mui/material';
import { useEffect, useState } from 'react';
import AppShell from '@/shared/components/layout/AppShell';
import { api } from '@/shared/api/client';
import EntityMaster from './EntityMaster';
import TransactionMaster from './TransactionMaster';
import TransactionMatrix from './TransactionMatrix';
import InboundMapping from './InboundMapping';
import MasterDataAudit from './MasterDataAudit';

const TABS = [
  { key: 'matrix', label: 'Transaction matrix' },
  { key: 'entities', label: 'Entities' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'mapping', label: 'Inbound mapping' },
  { key: 'audit', label: 'Audit' },
] as const;

export default function MasterDataWorkspace() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const active = TABS.find((t) => t.key === tab)?.key ?? 'matrix';
  const activeLabel = TABS.find((t) => t.key === active)?.label ?? '';
  const [unmapped, setUnmapped] = useState(0);

  const refreshCount = () =>
    api.mdStaging()
      .then((s) => setUnmapped(s.filter((i) => i.status !== 'applied' && i.status !== 'rejected').length))
      .catch(() => { /* badge is best-effort */ });

  useEffect(() => { refreshCount(); }, [active]);

  return (
    <AppShell
      pageTitle="Master Data"
      breadcrumbs={[{ label: 'Master Data', to: '/master-data' }, { label: activeLabel }]}
    >
      <Box sx={{ mb: 2 }}>
        <Typography variant="overline" sx={{ color: 'text.secondary' }}>Front of the close cycle</Typography>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Master Data</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          The entities, transactions and policies every downstream calculation reads from.
        </Typography>
      </Box>
      <Tabs value={active} onChange={(_, v) => navigate(`/master-data/${v}`)} sx={{ mb: 2 }}>
        {TABS.map((t) => (
          <Tab
            key={t.key}
            value={t.key}
            label={
              t.key === 'mapping' && unmapped > 0 ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <span>{t.label}</span>
                  <Chip size="small" color="warning" label={unmapped} sx={{ height: 18 }} />
                </Stack>
              ) : t.label
            }
          />
        ))}
      </Tabs>
      {active === 'matrix' && <TransactionMatrix />}
      {active === 'entities' && <EntityMaster />}
      {active === 'transactions' && <TransactionMaster />}
      {active === 'mapping' && <InboundMapping onChange={refreshCount} />}
      {active === 'audit' && <MasterDataAudit />}
    </AppShell>
  );
}
