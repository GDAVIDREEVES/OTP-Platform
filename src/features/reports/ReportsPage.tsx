import React, { useEffect, useState } from 'react';
import AppShell from '@/shared/components/layout/AppShell';
import {
  Paper,
  Typography,
  Grid,
  Stack,
  Button,
  Box,
  Chip,
  Avatar,
  Divider,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  CircularProgress,
  Alert,
} from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import PrintIcon from '@mui/icons-material/Print';
import HistoryIcon from '@mui/icons-material/History';
import DescriptionIcon from '@mui/icons-material/Description';
import TableChartIcon from '@mui/icons-material/TableChart';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import { api } from '@/shared/api/client';
import type {
  AuditEvent,
  PolicyOverride,
  SegmentPnlRow,
  SubmittedAdjustment,
} from '@/shared/api/types';
import type { TransactionFlow } from '@/shared/types/transaction';
import { tokens } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/format';
import { useLastFetchedAt, useToast } from '@/shared/providers/DataProvider';

const fmtTs = (ts: string) => {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
};

/** Client-side JSON download — the endpoint's data straight to a .json file,
 *  no server round-trip. */
function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Open the print window SYNCHRONOUSLY on the click gesture — before any
 *  await. Safari blocks a window opened after an async boundary even when
 *  pop-ups are enabled, so we must claim the handle inside the user gesture and
 *  fill it later. Returns null only when pop-ups are genuinely blocked; shows a
 *  placeholder until renderPrintWindow writes the built table. */
function openPrintWindow(): Window | null {
  const w = window.open('', '_blank', 'width=1024,height=768');
  if (!w) return null;
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>Preparing report…</title>
    <style>body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#64748B;margin:48px;font-size:14px;}</style>
    </head><body>Preparing report…</body></html>`,
  );
  return w;
}

/** Fill an already-open print window (from openPrintWindow) with the built
 *  table and trigger the print dialog. */
function renderPrintWindow(
  w: Window,
  title: string,
  columns: string[],
  rows: (string | number)[][],
): void {
  const thead = columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const tbody = rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('');
  w.document.open();
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>
      body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0F172A;margin:32px;}
      h1{font-size:18px;margin:0 0 4px;}
      .meta{color:#64748B;font-size:12px;margin-bottom:16px;}
      table{border-collapse:collapse;width:100%;font-size:12px;}
      th,td{border:1px solid #E2E8F0;padding:6px 8px;text-align:left;vertical-align:top;}
      th{background:#F8FAFC;font-weight:700;}
      tbody tr:nth-child(even){background:#FBFCFE;}
      @media print{body{margin:0;}}
    </style></head><body>
    <h1>${esc(title)}</h1>
    <div class="meta">OTP Platform &middot; generated ${esc(new Date().toLocaleString())} &middot; ${rows.length} rows</div>
    <table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
    </body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
}

interface ReportSpec<T> {
  id: string;
  title: string;
  desc: string;
  filename: string;
  icon: React.ReactNode;
  /** Fetch the live payload — used verbatim for the JSON download and derived
   *  into the print table. */
  load: () => Promise<T>;
  toPrint: (data: T) => { columns: string[]; rows: (string | number)[][] };
}

/** Author a spec with `load` and `toPrint` type-linked (T inferred from
 *  `load`), then erase T so the heterogeneous registry array stays typeable.
 *  The single deliberate cast is here — call sites hand `toPrint` an `unknown`
 *  that only ever came from this spec's own `load`. */
function defineReport<T>(spec: ReportSpec<T>): ReportSpec<unknown> {
  return spec as ReportSpec<unknown>;
}

// Every card maps to a REAL endpoint. Excel/PDF exports were removed — the
// platform only produces what it can honestly generate client-side: the
// endpoint's structured JSON and a print-friendly table over the same data.
const REPORTS: ReportSpec<unknown>[] = [
  defineReport({
    id: 'policy',
    title: 'TP Policy Summary',
    desc: 'Every configured intercompany flow with its method, PLI and reviewer — governed policy overrides layered on top.',
    filename: 'otp-tp-policy-summary.json',
    icon: <DescriptionIcon />,
    load: async (): Promise<{ flows: TransactionFlow[]; overrides: Record<string, PolicyOverride> }> => {
      const [flows, overrides] = await Promise.all([api.flows(), api.policyOverrides()]);
      return { flows, overrides };
    },
    toPrint: (d) => ({
      columns: ['Flow', 'Type', 'Payors → Payees', 'Method', 'PLI', 'Reviewer', 'YTD volume'],
      rows: d.flows.map((f) => {
        const o = d.overrides[f.id];
        return [
          f.id,
          f.type,
          `${f.payors.join(', ')} → ${f.payees.join(', ')}`,
          o?.tpMethod ?? f.tpMethod,
          f.pli,
          o?.reviewer ?? '—',
          formatCurrency(f.ytdVolume, 'USD', true),
        ];
      }),
    }),
  }),
  defineReport({
    id: 'segment-pl',
    title: 'Segmented P&L',
    desc: 'Revenue, cost and operating profit by entity, role and segment — the tested-party basis for every margin.',
    filename: 'otp-segmented-pl.json',
    icon: <TableChartIcon />,
    load: () => api.segmentPnl(),
    toPrint: (rows: SegmentPnlRow[]) => ({
      columns: [
        'Entity',
        'Role',
        'Segment',
        'Year',
        'Period',
        'Revenue',
        'COGS',
        'Operating profit',
        'Margin',
      ],
      rows: rows.map((r) => [
        r.RBUKRS,
        r.ROLE_CODE,
        r.SEGMENT,
        r.GJAHR,
        r.POPER,
        formatCurrency(r.revenue),
        formatCurrency(r.cogs),
        formatCurrency(r.operating_profit),
        `${(r.operating_margin * 100).toFixed(1)}%`,
      ]),
    }),
  }),
  defineReport({
    id: 'adjustments',
    title: 'Adjustment History',
    desc: 'Every submitted year-end true-up and compensating adjustment with its full approval trail.',
    filename: 'otp-adjustment-history.json',
    icon: <ReceiptLongIcon />,
    load: () => api.submittedAdjustments(),
    toPrint: (rows: SubmittedAdjustment[]) => ({
      columns: ['ID', 'Entity', 'Amount', 'Mode', 'Status', 'Submitted by', 'Submitted', 'Approved by'],
      rows: rows.map((a) => [
        a.id,
        a.entityName ?? a.entityId,
        formatCurrency(a.amount, a.currency || 'USD'),
        a.mode,
        a.status,
        a.submittedBy,
        fmtTs(a.submittedAt),
        a.approvedBy ?? '—',
      ]),
    }),
  }),
  defineReport({
    id: 'audit',
    title: 'Audit Log',
    desc: 'The complete hash-chained event stream — every price-setting decision, policy change, adjustment and approval.',
    filename: 'otp-audit-log.json',
    icon: <FactCheckIcon />,
    load: () => api.audit(),
    toPrint: (rows: AuditEvent[]) => ({
      columns: ['Timestamp', 'Actor', 'Event', 'Record', 'Rationale'],
      rows: [...rows]
        .reverse()
        .map((e) => [
          fmtTs(e.ts),
          `${e.actor}${e.actor_kind === 'assistant' ? ' (assisted)' : ''}`,
          e.event_type,
          e.record_ref,
          e.rationale ?? '',
        ]),
    }),
  }),
];

function ReportCard({
  spec,
  onError,
}: {
  spec: ReportSpec<unknown>;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState<null | 'json' | 'print'>(null);

  const run = async (kind: 'json' | 'print') => {
    // The print window MUST be claimed inside the synchronous click gesture
    // (before the await below) or Safari blocks it even with pop-ups enabled.
    let win: Window | null = null;
    if (kind === 'print') {
      win = openPrintWindow();
      if (!win) {
        onError('Enable pop-ups to print this report.');
        return;
      }
    }
    setBusy(kind);
    try {
      const data = await spec.load();
      if (kind === 'json') {
        downloadJson(spec.filename, data);
      } else {
        const { columns, rows } = spec.toPrint(data);
        renderPrintWindow(win!, spec.title, columns, rows);
      }
    } catch (e) {
      win?.close();
      onError(`Could not build ${spec.title}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Paper sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="flex-start" spacing={1.5} sx={{ mb: 1.5 }}>
        <Avatar sx={{ bgcolor: '#EFF6FF', color: '#2563EB' }}>{spec.icon}</Avatar>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
            {spec.title}
          </Typography>
          <Chip
            size="small"
            label="Live data"
            sx={{ height: 18, fontSize: 10, fontWeight: 700, bgcolor: '#DCFCE7', color: '#15803D', mt: 0.5 }}
          />
        </Box>
      </Stack>
      <Typography variant="body2" sx={{ color: '#475569', flex: 1, mb: 2 }}>
        {spec.desc}
      </Typography>
      <Stack direction="row" spacing={0.75}>
        <Button
          size="small"
          variant="outlined"
          startIcon={busy === 'json' ? <CircularProgress size={14} /> : <CodeIcon />}
          disabled={busy !== null}
          onClick={() => void run('json')}
        >
          JSON
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={busy === 'print' ? <CircularProgress size={14} /> : <PrintIcon />}
          disabled={busy !== null}
          onClick={() => void run('print')}
        >
          Print
        </Button>
      </Stack>
    </Paper>
  );
}

export default function Reports() {
  const toast = useToast();
  const lastFetchedAt = useLastFetchedAt();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .audit()
      .then((e) => alive && setEvents(e))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  const recent = events ? [...events].slice(-50).reverse() : [];

  const exportTrail = () => {
    if (!events) return;
    downloadJson('otp-audit-trail.json', events);
  };

  return (
    <AppShell pageTitle="Reports & Audit Trail">
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        Report Library
      </Typography>
      <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
        Every report reads live from the platform. Download the endpoint&apos;s structured JSON
        or print a clean tabular copy — data as of {lastFetchedAt.toLocaleString()}.
      </Typography>

      <Grid container spacing={2}>
        {REPORTS.map((spec) => (
          <Grid item xs={12} sm={6} md={3} key={spec.id}>
            <ReportCard spec={spec} onError={(m) => toast.show(m, 'error')} />
          </Grid>
        ))}
      </Grid>

      <Paper sx={{ p: 2.5, mt: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
          <HistoryIcon sx={{ color: '#2563EB' }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Audit Trail
            </Typography>
            <Typography variant="caption" sx={{ color: '#64748B' }}>
              Immutable, hash-chained log of every price-setting decision, policy change,
              adjustment, approval and invoice.
              {events && ` Showing the ${recent.length} most recent of ${events.length} events.`}
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={<CodeIcon />}
            disabled={!events || events.length === 0}
            onClick={exportTrail}
          >
            Export full trail
          </Button>
        </Stack>
        <Divider sx={{ mb: 1.5 }} />

        {error ? (
          <Alert severity="error" variant="outlined">
            Could not load the audit trail: {error}
          </Alert>
        ) : !events ? (
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 3, px: 1 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" sx={{ color: '#64748B' }}>
              Loading the event stream…
            </Typography>
          </Stack>
        ) : events.length === 0 ? (
          <Alert severity="info" variant="outlined">
            No events recorded yet. The trail is a by-product of the work — events are written
            automatically as records move through the workflow.
          </Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 190 }}>Timestamp</TableCell>
                <TableCell sx={{ width: 170 }}>Actor</TableCell>
                <TableCell sx={{ width: 130 }}>Event</TableCell>
                <TableCell sx={{ width: 190 }}>Record</TableCell>
                <TableCell>Rationale</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {recent.map((e) => (
                <TableRow key={e.id} hover>
                  <TableCell sx={{ color: '#64748B', whiteSpace: 'nowrap' }}>{fmtTs(e.ts)}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {e.actor}
                      </Typography>
                      {e.actor_kind === 'assistant' && (
                        <Chip
                          size="small"
                          label="assisted"
                          sx={{
                            height: 18,
                            fontSize: 10,
                            fontWeight: 700,
                            bgcolor: '#EDE9FE',
                            color: tokens.assist,
                          }}
                        />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={e.event_type}
                      sx={{ fontWeight: 600, textTransform: 'capitalize', bgcolor: '#F1F5F9', color: '#475569' }}
                    />
                  </TableCell>
                  <TableCell sx={{ color: '#94A3B8', fontFamily: 'monospace', fontSize: 12 }}>
                    {e.record_ref}
                  </TableCell>
                  <TableCell sx={{ color: '#475569' }}>{e.rationale ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
    </AppShell>
  );
}
