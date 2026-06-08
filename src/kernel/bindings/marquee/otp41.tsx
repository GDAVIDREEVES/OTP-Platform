import { useEffect, useState } from 'react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableRow, Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useToast } from '@/shared/providers/DataProvider';
import type { MdProposal, MdStagingItem } from '@/shared/api/types';
import type { StepDef } from '@/kernel/registry/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import WorkflowPath from '@/kernel/workflow/WorkflowPath';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import { useGuidedWorkflow } from '@/kernel/workflow/useGuidedWorkflow';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

/** OTP-41 — ERP master-data maintenance. A guided wizard over the EXISTING
 *  master-data staging pipeline: it drives off the inbound SAP delta (new entity
 *  3500 / GL account 417000…), the Research Brain characterises each item, and a
 *  human submits it into the same maker-checker review/approve flow used by the
 *  /master-data Inbound mapping workspace. No new figures — everything is read
 *  from md_staging and the AI proposer. */

const STEPS: StepDef[] = [
  { key: 'prepare', label: 'Characterise', actor: 'assistant', description: 'Research Brain proposes a master-data mapping for the SAP delta' },
  { key: 'review', label: 'Review', actor: 'human', description: 'Confirm the proposed characterisation' },
  { key: 'submit', label: 'Submit for review', actor: 'human', gate: true, description: 'Route into the master-data maker-checker queue' },
];

/** The master-data deltas OTP-41 maintains: definitional ERP records (entities,
 *  GL accounts, transaction templates) — not the unplanned IC flows (those are
 *  OTP-27's job, keyed by kind 'unplanned_transaction'). */
const MAINTENANCE_KINDS = new Set(['entity', 'account', 'transaction', 'field']);

function isMaintenance(it: MdStagingItem): boolean {
  return MAINTENANCE_KINDS.has(it.kind);
}

function rawLabel(it: MdStagingItem): string {
  const r = it.raw as Record<string, unknown>;
  if (it.kind === 'entity') return `${r.rbukrs ?? ''} · ${r.name ?? ''}`.trim();
  if (it.kind === 'account') return `${r.account ?? ''} · ${r.text ?? ''}`.trim();
  return String(r.label ?? it.id);
}

const STATUS_TONE: Record<string, 'ok' | 'watch' | 'risk' | 'neutral'> = {
  unmapped: 'risk', proposed: 'watch', in_review: 'watch', applied: 'ok', rejected: 'risk',
};

/** Alive-guarded fetch of the open master-data deltas (maintenance kinds only). */
function useDeltas() {
  const [items, setItems] = useState<MdStagingItem[] | null>(null);
  const refresh = () =>
    api.mdStaging()
      .then((s) => setItems(s.filter(isMaintenance)))
      .catch(() => setItems([]));
  useEffect(() => { refresh(); }, []);
  return { items, refresh };
}

const Kpis: FC<BindingCtx> = () => {
  const { items } = useDeltas();
  const open = (items ?? []).filter((i) => i.status !== 'applied' && i.status !== 'rejected');
  const inReview = (items ?? []).filter((i) => i.status === 'in_review');
  const applied = (items ?? []).filter((i) => i.status === 'applied');
  const kpis: KpiItem[] = [
    { key: 'open', label: 'Open SAP deltas', value: String(open.length), tone: open.length ? 'risk' : 'ok', provenance: 'md_staging' },
    { key: 'rev', label: 'Awaiting approval', value: String(inReview.length), tone: inReview.length ? 'watch' : 'neutral', provenance: 'review_items' },
    { key: 'app', label: 'Applied this cycle', value: String(applied.length), tone: 'ok', provenance: 'md_mapping' },
  ];
  return <KpiStrip items={kpis} />;
};

// ---------------- delta picker (none selected) ----------------

function Picker({ items, onPick }: { items: MdStagingItem[]; onPick: (id: string) => void }) {
  const navigate = useNavigate();
  const open = items.filter((i) => i.status !== 'applied' && i.status !== 'rejected');
  if (!open.length) {
    return (
      <Alert
        severity="success"
        action={<Button onClick={() => navigate('/master-data/mapping')}>Open Master Data</Button>}
      >
        No open ERP master-data deltas. New SAP records appear here as they arrive in the inbound feed.
      </Alert>
    );
  }
  return (
    <Stack spacing={2} sx={{ maxWidth: 760 }}>
      <Alert severity="info" variant="outlined">
        New ERP master-data records from the inbound SAP delta. Pick one to characterise it with the
        Research Brain and submit it into the master-data review queue.
      </Alert>
      {open.map((it) => (
        <Stack key={it.id} direction="row" alignItems="center" spacing={1.5} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Chip size="small" label={it.kind} />
          <Typography variant="body2" sx={{ flex: 1, fontWeight: 700 }}>{rawLabel(it)}</Typography>
          <Chip size="small" label={it.status} />
          <Button size="small" variant="outlined" onClick={() => onPick(it.id)}>Maintain</Button>
        </Stack>
      ))}
    </Stack>
  );
}

// ---------------- the guided maintenance flow ----------------

function ProposalTable({ proposed }: { proposed: Record<string, unknown> }) {
  return (
    <Table size="small" sx={{ mt: 1, maxWidth: 520 }}>
      <TableBody>
        {Object.entries(proposed).map(([k, v]) => (
          <TableRow key={k}>
            <TableCell sx={{ color: 'text.secondary', width: 180 }}>{k}</TableCell>
            <TableCell sx={{ bgcolor: '#FAF5FF', fontWeight: 600 }}>{String(v)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Maintenance({ item, onDone }: { item: MdStagingItem; onDone: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const user = useSessionUser();
  const recordRef = `mdmap:${item.id}`;
  const g = useGuidedWorkflow('OTP-41', recordRef, STEPS);
  const [proposal, setProposal] = useState<MdProposal | null>(null);

  const prepared = !!g.wf.payload.prepared;
  const proposed = (proposal?.proposed ?? item.proposed) as Record<string, unknown> | null;

  if (g.submitted) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        <Alert icon={<CheckCircleIcon />} severity="success">
          ERP delta <b>{rawLabel(item)}</b> submitted into the master-data review queue. A different
          reviewer must approve and apply it — a maker can&rsquo;t approve their own work, and the AI is
          never the checker.
        </Alert>
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button variant="contained" onClick={() => navigate('/master-data/mapping')}>Open Master Data to review</Button>
          <Button variant="outlined" onClick={() => navigate(`/evidence/${encodeURIComponent(recordRef)}`)}>Evidence packet</Button>
          <Button variant="outlined" onClick={() => navigate('/review')}>Open review queue</Button>
          <Button onClick={onDone}>Back to deltas</Button>
        </Stack>
      </Stack>
    );
  }

  if (!g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const key = STEPS[g.wf.stepIndex]?.key;
  const canContinue = key === 'prepare' ? prepared : key === 'review' ? !!proposed : true;

  const runPrepare = async () => {
    // Characterise the delta through the SAME AI proposer the master-data
    // workspace uses (writes the proposal into md_staging), and log the agentic
    // hand-off to the audit trail via the Research Brain prepare endpoint.
    try {
      const p = await api.mdPropose(item.id);
      setProposal(p);
      await g.prepare({ summary: `Characterised SAP delta ${rawLabel(item)} (${item.kind}): ${p.rationale}` });
    } catch (e) {
      toast.show(`Prepare failed: ${String(e)}`, 'error');
    }
  };

  const submit = async () => {
    try {
      await api.mdSubmitMapping(item.id, user.id);
    } catch (e) {
      toast.show(`Submit failed: ${String(e)}`, 'error');
      return;
    }
    // Enqueue review + clear the draft via the shared guided submit.
    await g.submit();
  };

  const renderStep = (step: StepDef) => {
    if (step.key === 'prepare') {
      return prepared ? (
        <Stack spacing={1.5}>
          <AgenticHandoffMarker summary={String(g.wf.payload.rbSummary || '')} />
          {proposed && <ProposalTable proposed={proposed} />}
        </Stack>
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2">
            The Research Brain reads the inbound SAP record for <b>{rawLabel(item)}</b>, characterises it
            by analogy to the existing master data (function / transaction type), and proposes a mapping.
            You then review and submit it — applying it stays a human, maker-checker decision.
          </Typography>
          <Box>
            <Button
              variant="contained"
              disabled={g.preparing}
              startIcon={g.preparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void runPrepare()}
            >
              {g.preparing ? 'Characterising…' : 'Run Research Brain characterisation'}
            </Button>
          </Box>
        </Stack>
      );
    }
    if (step.key === 'review') {
      return (
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Chip size="small" label={item.kind} />
              <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>{rawLabel(item)}</Typography>
              <Chip size="small" label={proposal?.confidence ?? item.confidence ?? '—'} />
            </Stack>
            {proposed ? <ProposalTable proposed={proposed} /> : (
              <Alert severity="warning" sx={{ mt: 1 }}>No proposal yet — go back and run the characterisation.</Alert>
            )}
          </Paper>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {proposal?.rationale ?? item.rationale}
          </Typography>
        </Stack>
      );
    }
    // submit (gate)
    return (
      <Stack spacing={2}>
        <Typography variant="body2">
          Submitting routes <b>{rawLabel(item)}</b> into the master-data maker-checker queue (the same
          flow as the Inbound mapping workspace). It is applied to the master only after a different
          reviewer approves it.
        </Typography>
        <Alert severity="info" variant="outlined" sx={{ maxWidth: 560 }}>
          You can also drive the full propose → submit → approve → apply cycle from{' '}
          <Button size="small" onClick={() => navigate('/master-data/mapping')}>Master Data → Inbound mapping</Button>.
        </Alert>
      </Stack>
    );
  };

  return (
    <Stack spacing={2}>
      <Chip
        size="small"
        label={`status: ${item.status}`}
        sx={{ alignSelf: 'flex-start' }}
        color={STATUS_TONE[item.status] === 'ok' ? 'success' : STATUS_TONE[item.status] === 'risk' ? 'error' : 'default'}
      />
      <WorkflowPath
        steps={STEPS}
        stepIndex={g.wf.stepIndex}
        setStepIndex={g.wf.setStepIndex}
        canContinue={canContinue}
        onComplete={() => void submit()}
        completing={g.submitting}
        renderStep={renderStep}
        lastSavedAt={g.wf.lastSavedAt}
      />
    </Stack>
  );
}

const Overview: FC<BindingCtx> = () => {
  const { items, refresh } = useDeltas();
  const [picked, setPicked] = useState<string | null>(null);
  if (items === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const item = picked ? items.find((i) => i.id === picked) : undefined;
  if (item) return <Maintenance item={item} onDone={() => { setPicked(null); refresh(); }} />;
  return <Picker items={items} onPick={setPicked} />;
};

export const otp41: ProcessBinding = {
  kpis: Kpis,
  tabs: { overview: Overview },
};
