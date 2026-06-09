import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import EditNoteIcon from '@mui/icons-material/EditNote';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial';
import AppShell from '@/shared/components/layout/AppShell';
import { api } from '@/shared/api/client';
import { tokens } from '@/shared/theme';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import type { WorklistItem } from '@/shared/api/types';

type Kind = WorklistItem['kind'];

/** Section ordering + presentation, keyed by item kind. The order here is the
 *  order sections render in: act-now exceptions and approvals first, then your
 *  own in-flight work. Each kind picks an icon + accent color (meaning-coded). */
const SECTIONS: { kind: Kind; label: string; icon: JSX.Element; color: string }[] = [
  { kind: 'exception', label: 'Exceptions', icon: <WarningAmberIcon fontSize="small" />, color: tokens.risk },
  { kind: 'review', label: 'Review queue', icon: <FactCheckIcon fontSize="small" />, color: tokens.action },
  { kind: 'case', label: 'Open cases', icon: <FolderSpecialIcon fontSize="small" />, color: tokens.watch },
  { kind: 'draft', label: 'In-progress drafts', icon: <EditNoteIcon fontSize="small" />, color: tokens.ink },
];

const PRIORITY_TONE: Record<WorklistItem['priority'], string> = {
  high: tokens.risk,
  medium: tokens.watch,
  low: tokens.ink,
};

const isOverdue = (due: string | null): boolean => !!due && Date.parse(due) < Date.now();
const fmtDue = (due: string | null): string => due ?? '—';

export default function InboxPage() {
  const user = useSessionUser();
  const navigate = useNavigate();
  const [items, setItems] = useState<WorklistItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .worklist(user.id)
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [user.id]);

  // Group once; the backend already returns items overdue-first, so each
  // section preserves that order.
  const byKind = useMemo(() => {
    const m = new Map<Kind, WorklistItem[]>();
    for (const it of items) {
      const list = m.get(it.kind) ?? [];
      list.push(it);
      m.set(it.kind, list);
    }
    return m;
  }, [items]);

  return (
    <AppShell pageTitle="Inbox">
      <Stack spacing={2}>
        <Alert severity="info" variant="outlined">
          Your unified worklist as <b>{user.name}</b> ({user.title}) — exceptions to resolve, items to
          approve, open cases, and drafts to resume, gathered from every process. Each row deep-links to
          the work surface that owns it.
        </Alert>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : items.length === 0 ? (
          <Alert severity="success" variant="outlined">
            Nothing on your plate. Exceptions, approvals, cases, and drafts will surface here as they arrive.
          </Alert>
        ) : (
          SECTIONS.map((section) => {
            const rows = byKind.get(section.kind) ?? [];
            if (rows.length === 0) return null;
            return (
              <Box key={section.kind}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, color: section.color }}>
                  {section.icon}
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary' }}>
                    {section.label}
                  </Typography>
                  <Chip size="small" label={rows.length} sx={{ bgcolor: section.color, color: 'white', fontWeight: 700, height: 20 }} />
                </Stack>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Item</TableCell>
                      <TableCell>Process</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Due</TableCell>
                      <TableCell align="right">Priority</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((it) => {
                      const overdue = isOverdue(it.due_at);
                      const clickable = !!it.route;
                      return (
                        <TableRow
                          key={`${it.kind}:${it.ref}`}
                          hover={clickable}
                          onClick={() => it.route && navigate(it.route)}
                          sx={{ cursor: clickable ? 'pointer' : 'default' }}
                        >
                          <TableCell sx={{ fontWeight: 600 }}>{it.title}</TableCell>
                          <TableCell>
                            {it.process_id ? (
                              <Chip size="small" label={it.process_id} sx={{ fontWeight: 700 }} />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>{it.status}</TableCell>
                          <TableCell sx={{ color: overdue ? tokens.risk : 'inherit', fontWeight: overdue ? 700 : 400 }}>
                            {fmtDue(it.due_at)}
                          </TableCell>
                          <TableCell align="right">
                            <Chip
                              size="small"
                              label={it.priority}
                              variant="outlined"
                              sx={{ borderColor: PRIORITY_TONE[it.priority], color: PRIORITY_TONE[it.priority], fontWeight: 700, height: 20, textTransform: 'capitalize' }}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Box>
            );
          })
        )}
      </Stack>
    </AppShell>
  );
}
