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
import { formatCurrency } from '@/shared/utils/format';
import type { MdMatrixRow, MdProposal } from '@/shared/api/types';
import type { StepDef } from '@/kernel/registry/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import WorkflowPath from '@/kernel/workflow/WorkflowPath';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import { useGuidedWorkflow } from '@/kernel/workflow/useGuidedWorkflow';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

/** OTP-27 — New IC flow onboarding. A guided wizard over the EXISTING
 *  unplanned-flow detection in master_data: it drives off ACDOCA intercompany
 *  flows with no planned/mapped coverage (matrix rows with status 'unmapped'),
 *  the Research Brain characterises the flow and proposes a covered transaction,
 *  and a human maps + submits it into the master-data maker-checker queue. No new
 *  figures — flows + amounts come from /api/master-data/matrix. */

const STEPS: StepDef[] = [
  { key: 'prepare', label: 'Characterise', actor: 'assistant', description: 'Research Brain maps the new IC flow to a covered transaction type' },
  { key: 'map', label: 'Map', actor: 'human', description: 'Confirm the proposed covered transaction' },
  { key: 'submit', label: 'Submit for review', actor: 'human', gate: true, description: 'Route into the master-data maker-checker queue' },
];

function flowLabel(r: MdMatrixRow): string {
  return `${r.payer.name} → ${r.payee.name}`;
}

/** Alive-guarded fetch of uncovered IC flows from the transaction matrix. */
function useUnplanned() {
  const [rows, setRows] = useState<MdMatrixRow[] | null>(null);
  const refresh = () =>
    api.mdMatrix()
      .then((m) => setRows(m.filter((r) => r.status === 'unmapped')))
      .catch(() => setRows([]));
  useEffect(() => { refresh(); }, []);
  return { rows, refresh };
}

const Kpis: FC<BindingCtx> = () => {
  const { rows } = useUnplanned();
  const all = rows ?? [];
  const staged = all.filter((r) => r.staging_id);       // already promoted into staging
  const detected = all.filter((r) => r.flow_id && !r.staging_id); // straight from actuals
  const exposure = all.reduce((s, r) => s + (r.actual_amount ?? 0), 0);
  const kpis: KpiItem[] = [
    { key: 'open', label: 'Uncovered IC flows', value: String(all.length), tone: all.length ? 'risk' : 'ok', provenance: 'master-data/matrix' },
    { key: 'det', label: 'Detected in actuals', value: String(detected.length), tone: detected.length ? 'watch' : 'neutral', provenance: 'ACDOCA · unplanned_flows' },
    { key: 'stg', label: 'In intake', value: String(staged.length), tone: 'neutral', provenance: 'md_staging' },
    { key: 'exp', label: 'Uncovered exposure', value: exposure ? formatCurrency(exposure, 'USD', true) : '—', tone: 'watch', hint: 'magnitude across uncovered flows' },
  ];
  return <KpiStrip items={kpis} />;
};

// ---------------- flow picker (none selected) ----------------

function Picker({ rows, onPick }: { rows: MdMatrixRow[]; onPick: (key: string) => void }) {
  const navigate = useNavigate();
  if (!rows.length) {
    return (
      <Alert
        severity="success"
        action={<Button onClick={() => navigate('/master-data/matrix')}>Open transaction matrix</Button>}
      >
        No uncovered intercompany flows. New flows surface here when they appear in the actuals without a
        planned or mapped covered transaction.
      </Alert>
    );
  }
  return (
    <Stack spacing={2} sx={{ maxWidth: 820 }}>
      <Alert severity="info" variant="outlined">
        Intercompany flows in the actuals with no covered transaction. Onboard one: the Research Brain
        proposes a covered transaction, then you map and submit it for review.
      </Alert>
      {rows.map((r) => {
        const key = r.staging_id ?? r.flow_id ?? r.ctx_id;
        return (
          <Stack key={key} direction="row" alignItems="center" spacing={1.5} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Chip size="small" color="warning" label="uncovered" />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{flowLabel(r)}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {r.txn_label}{r.staging_id ? ' · in intake' : ' · detected in actuals'}
              </Typography>
            </Box>
            {r.actual_amount != null && (
              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                {formatCurrency(r.actual_amount, 'USD', true)}
              </Typography>
            )}
            <Button size="small" variant="outlined" onClick={() => onPick(key)}>Onboard</Button>
          </Stack>
        );
      })}
    </Stack>
  );
}

// ---------------- the guided onboarding flow ----------------

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

function Onboarding({ row, onDone }: { row: MdMatrixRow; onDone: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const user = useSessionUser();
  // The staging id is the record key. Detected-from-actuals flows have no staging
  // id yet — promote() creates one with id == flow_id, matching the seeded UNPL-… ids.
  const [stagingId, setStagingId] = useState<string | null>(row.staging_id);
  const recordRef = `mdmap:${stagingId ?? row.flow_id ?? row.ctx_id}`;
  const g = useGuidedWorkflow('OTP-27', recordRef, STEPS);
  const [proposal, setProposal] = useState<MdProposal | null>(null);

  const prepared = !!g.wf.payload.prepared;
  const proposed = proposal?.proposed as Record<string, unknown> | undefined;

  if (g.submitted) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        <Alert icon={<CheckCircleIcon />} severity="success">
          New IC flow <b>{flowLabel(row)}</b> mapped to a covered transaction and submitted for review.
          A different reviewer approves and applies it — the maker can&rsquo;t self-approve, and the AI is
          never the checker.
        </Alert>
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button variant="contained" onClick={() => navigate('/master-data/mapping')}>Open Master Data to review</Button>
          <Button variant="outlined" onClick={() => navigate(`/evidence/${encodeURIComponent(recordRef)}`)}>Evidence packet</Button>
          <Button variant="outlined" onClick={() => navigate('/master-data/matrix')}>Transaction matrix</Button>
          <Button onClick={onDone}>Back to flows</Button>
        </Stack>
      </Stack>
    );
  }

  if (!g.wf.loaded) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const key = STEPS[g.wf.stepIndex]?.key;
  const canContinue = key === 'prepare' ? prepared : key === 'map' ? !!proposed : true;

  const runPrepare = async () => {
    try {
      // Detected-from-actuals flow: promote it into the existing staging pipeline
      // first (creates an 'unplanned_transaction' staging item keyed by flow_id).
      let sid = stagingId;
      if (!sid && row.flow_id) {
        const res = await api.mdPromoteFlow({
          flow_id: row.flow_id,
          payer_rbukrs: row.payer.rbukrs,
          counterparty_rbukrs: row.payee.rbukrs,
          label: row.txn_label ?? undefined,
          amount: row.actual_amount ?? undefined,
        });
        sid = res.id;
        setStagingId(sid);
      }
      if (!sid) { toast.show('Could not resolve a staging record for this flow', 'error'); return; }
      const p = await api.mdPropose(sid);
      setProposal(p);
      await g.prepare({ summary: `Characterised uncovered IC flow ${flowLabel(row)}: ${p.rationale}` });
    } catch (e) {
      toast.show(`Prepare failed: ${String(e)}`, 'error');
    }
  };

  const submit = async () => {
    if (!stagingId) { toast.show('Run the characterisation first', 'error'); return; }
    try {
      await api.mdSubmitMapping(stagingId, user.id);
    } catch (e) {
      toast.show(`Submit failed: ${String(e)}`, 'error');
      return;
    }
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
            The Research Brain reads the uncovered IC flow <b>{flowLabel(row)}</b>
            {row.actual_amount != null ? <> ({formatCurrency(row.actual_amount, 'USD', true)})</> : null}, matches
            it to a covered transaction type by analogy, and proposes the mapping (tested party, policy /
            ICA / APA refs assigned on review). Mapping and submitting stay yours.
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
    if (step.key === 'map') {
      return (
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>{flowLabel(row)}</Typography>
              <Chip size="small" label={proposal?.confidence ?? '—'} />
            </Stack>
            {proposed ? <ProposalTable proposed={proposed} /> : (
              <Alert severity="warning" sx={{ mt: 1 }}>No proposal yet — go back and run the characterisation.</Alert>
            )}
          </Paper>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{proposal?.rationale}</Typography>
        </Stack>
      );
    }
    // submit (gate)
    return (
      <Stack spacing={2}>
        <Typography variant="body2">
          Submitting routes <b>{flowLabel(row)}</b> into the master-data maker-checker queue. On approval
          it becomes a covered transaction in the matrix — closing the coverage gap.
        </Typography>
        <Alert severity="info" variant="outlined" sx={{ maxWidth: 560 }}>
          You can also drive the full propose → submit → approve → apply cycle from{' '}
          <Button size="small" onClick={() => navigate('/master-data/mapping')}>Master Data → Inbound mapping</Button>.
        </Alert>
      </Stack>
    );
  };

  return (
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
  );
}

const Overview: FC<BindingCtx> = () => {
  const { rows, refresh } = useUnplanned();
  const [picked, setPicked] = useState<string | null>(null);
  if (rows === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const row = picked ? rows.find((r) => (r.staging_id ?? r.flow_id ?? r.ctx_id) === picked) : undefined;
  if (row) return <Onboarding row={row} onDone={() => { setPicked(null); refresh(); }} />;
  return <Picker rows={rows} onPick={setPicked} />;
};

export const otp27: ProcessBinding = {
  kpis: Kpis,
  tabs: { overview: Overview },
};
