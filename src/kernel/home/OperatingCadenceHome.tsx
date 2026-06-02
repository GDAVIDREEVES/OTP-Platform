import { useEffect, useState } from 'react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import HistoryIcon from '@mui/icons-material/History';
import AppShell from '@/shared/components/layout/AppShell';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useEntities, useKpis } from '@/shared/providers/DataProvider';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import { statusColor, statusLabel } from '@/shared/utils/status';
import { tokens } from '@/shared/theme';
import type { Draft, ReviewItem } from '@/shared/api/types';

const CYCLE: { label: string; route: string }[] = [
  { label: 'Master Data', route: '/master-data' },
  { label: 'Price Setting', route: '/process/OTP-3' },
  { label: 'Royalty Calculation', route: '/process/OTP-9' },
  { label: 'Service Allocations', route: '/process/OTP-10' },
  { label: 'Monitor margins', route: '/process/OTP-20' },
  { label: 'Adjust & true-up', route: '/process/OTP-16' },
  { label: 'Reserve & provision', route: '/process/OTP-45' },
];
const CURRENT = 4; // demo period sits in monitoring / adjustment

function timeAgo(iso: string): string {
  try {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  } catch {
    return '';
  }
}

function LifecycleStepper() {
  const navigate = useNavigate();
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="overline" sx={{ color: 'text.secondary' }}>Close cycle · FY2026</Typography>
      <Stack direction="row" alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap' }}>
        {CYCLE.map((step, i) => {
          const done = i < CURRENT;
          const active = i === CURRENT;
          const color = active ? tokens.action : done ? tokens.ok : '#CBD5E1';
          return (
            <Box key={step.label} sx={{ display: 'flex', alignItems: 'center', flex: i < CYCLE.length - 1 ? 1 : '0 0 auto', minWidth: 0 }}>
              <Stack
                direction="row" spacing={0.75} alignItems="center"
                onClick={() => navigate(step.route)}
                sx={{ minWidth: 0, cursor: 'pointer', borderRadius: 1, p: 0.5, '&:hover': { bgcolor: '#F1F5F9' } }}
              >
                <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{i + 1}</Box>
                <Typography variant="body2" noWrap sx={{ fontWeight: active ? 700 : 500, color: active ? 'text.primary' : 'text.secondary' }}>{step.label}</Typography>
              </Stack>
              {i < CYCLE.length - 1 && <Box sx={{ flex: 1, height: 2, bgcolor: i < CURRENT ? tokens.ok : '#E2E8F0', mx: 1 }} />}
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}

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

function ResumeSurface({ userId }: { userId: string }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const navigate = useNavigate();
  useEffect(() => {
    let alive = true;
    api.drafts(userId).then((d) => alive && setDrafts(d)).catch(() => alive && setDrafts([]));
    return () => { alive = false; };
  }, [userId]);
  if (!drafts.length) return null;
  const resume = (d: Draft) => {
    const entity = d.record_ref.startsWith('OTP16-') ? d.record_ref.slice(6) : '';
    navigate(`/process/${d.process_id}/overview${entity ? `?entity=${entity}` : ''}`);
  };
  return (
    <SectionCard title="Pick up where you left off">
      <Stack spacing={1}>
        {drafts.map((d) => (
          <Stack key={d.id} direction="row" alignItems="center" spacing={1.5} sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
            <HistoryIcon sx={{ color: '#94A3B8' }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{d.process_id} · {d.record_ref}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>Step {d.step_index + 1} · {d.step} · saved {timeAgo(d.updated_at)}</Typography>
            </Box>
            <Button size="small" variant="outlined" endIcon={<TrendingFlatIcon />} onClick={() => resume(d)}>Resume</Button>
          </Stack>
        ))}
      </Stack>
    </SectionCard>
  );
}

function OperatorHome({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const flagged = useEntities().filter((e) => e.status === 'out-of-range' || e.status === 'watch');
  return (
    <Stack spacing={2}>
      <ResumeSurface userId={userId} />
      <SectionCard title={`Your worklist — ${flagged.length} flagged tested parties`}>
        <Stack spacing={1}>
          {flagged.map((e) => (
            <Stack key={e.id} direction="row" alignItems="center" spacing={1.5} sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Chip size="small" label={statusLabel[e.status]} sx={{ bgcolor: statusColor[e.status], color: 'white', fontWeight: 700 }} />
              <Typography variant="body2" sx={{ flex: 1, fontWeight: 700 }}>
                {e.name}{' '}
                <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>
                  · {e.actualMargin?.toFixed(1) ?? '—'}% vs {e.targetMarginLabel}
                </Typography>
              </Typography>
              <Button size="small" variant="outlined" endIcon={<TrendingFlatIcon />} onClick={() => navigate(`/process/OTP-16/overview?entity=${e.id}`)}>Adjust</Button>
            </Stack>
          ))}
        </Stack>
      </SectionCard>
    </Stack>
  );
}

function ReviewerHome() {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  useEffect(() => {
    let alive = true;
    api.reviewQueue('pending').then((q) => alive && setQueue(q)).catch(() => alive && setQueue([]));
    return () => { alive = false; };
  }, []);
  return (
    <SectionCard title={`Sign-off queue — ${queue.length} awaiting your review`}>
      {queue.length === 0 ? (
        <Alert severity="success" variant="outlined">Nothing awaiting review.</Alert>
      ) : (
        <Stack spacing={1}>
          {queue.map((it) => (
            <Stack key={it.id} direction="row" alignItems="center" spacing={1.5} sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Chip size="small" label={it.process_id} sx={{ fontWeight: 700 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{it.record_ref}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>maker {it.maker} · {timeAgo(it.created_at)}</Typography>
              </Box>
            </Stack>
          ))}
          <Box>
            <Button variant="contained" startIcon={<FactCheckIcon />} onClick={() => navigate('/review')}>Open review queue</Button>
          </Box>
        </Stack>
      )}
    </SectionCard>
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
        <LifecycleStepper />
        <CloseMeter />
        {user.role === 'operator' && <OperatorHome userId={user.id} />}
        {user.role === 'reviewer' && <ReviewerHome />}
        {user.role === 'director' && <DirectorHome />}
      </Stack>
    </AppShell>
  );
}
