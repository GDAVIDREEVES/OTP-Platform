import { useEffect, useState } from 'react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import AppShell from '@/shared/components/layout/AppShell';
import CloseCommandCenter from '@/kernel/home/CloseCommandCenter';
import WorklistTable from '@/shared/components/WorklistTable';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useKpis } from '@/shared/providers/DataProvider';
import { useWorklist } from '@/shared/providers/WorkSignalsProvider';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';

function CloseMeter() {
  const k = useKpis();
  const pct = k.entityCount ? Math.round((k.entitiesInRange / k.entityCount) * 100) : 0;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Tested parties in range</Typography>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{pct}%</Typography>
      </Stack>
      <LinearProgress variant="determinate" value={pct} sx={{ height: 8, borderRadius: 4 }} />
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {k.entitiesInRange} in range · {k.entitiesWatch} watch · {k.entitiesOutOfRange} out of range
      </Typography>
    </Paper>
  );
}

const SectionCard: FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Paper variant="outlined" sx={{ p: 2 }}>
    <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>{title}</Typography>
    {children}
  </Paper>
);

/** The unified "what's on my plate" panel — every kind (exceptions, reviews,
 *  cases, drafts) in one grouped table, fed live by WorkSignalsProvider. */
function MyWork() {
  const navigate = useNavigate();
  const items = useWorklist();
  const toApprove = items.filter((it) => it.status === 'to approve').length;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>My work</Typography>
        {toApprove > 0 && (
          <Button
            size="small"
            variant="contained"
            startIcon={<FactCheckIcon />}
            onClick={() => navigate('/review')}
          >
            Open review queue ({toApprove})
          </Button>
        )}
      </Stack>
      <WorklistTable items={items} />
    </Paper>
  );
}

function DirectorHome() {
  const navigate = useNavigate();
  const k = useKpis();
  const [topUp, setTopUp] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    api.reference<{ rows: { top_up_tax: number }[] }>('pillar_two')
      .then((d) => alive && setTopUp((d.rows ?? []).reduce((s, r) => s + r.top_up_tax, 0)))
      .catch(() => alive && setTopUp(null));
    return () => { alive = false; };
  }, []);
  return (
    <SectionCard title="Group exposure at a glance">
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 3, mb: 1.5 }}>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Intercompany volume</Typography>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>{formatCurrency(k.totalICVolume, 'USD', true)}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Out of range</Typography>
          <Typography variant="h6" sx={{ fontWeight: 800, color: tokens.risk }}>{k.entitiesOutOfRange}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Pillar Two top-up</Typography>
          <Typography variant="h6" sx={{ fontWeight: 800, color: tokens.risk }}>{topUp == null ? '…' : formatCurrency(topUp, 'USD', true)}</Typography>
        </Box>
      </Stack>
      <Button variant="contained" onClick={() => navigate('/director')}>Open exposure dashboard</Button>
    </SectionCard>
  );
}

export default function OperatingCadenceHome() {
  const user = useSessionUser();
  return (
    <AppShell pageTitle="Home">
      <Stack spacing={3}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>Good morning, {user.name.split(' ')[0]}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Here&rsquo;s what your role owns this close. {user.title}.
          </Typography>
        </Box>
        <CloseCommandCenter />
        <CloseMeter />
        <MyWork />
        {user.role === 'director' && <DirectorHome />}
      </Stack>
    </AppShell>
  );
}
