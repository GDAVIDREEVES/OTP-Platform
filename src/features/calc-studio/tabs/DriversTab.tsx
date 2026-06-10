import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useToast } from '@/shared/providers/DataProvider';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import type { Parameter } from '@/shared/api/types';
import { provKind, valueText, PROV_META, useParameters } from '../lib';

/** Drivers & Assumptions — the governed parameter store. Every parameter edit
 *  PATCHes /api/parameters/{key} and is hash-chained at record_ref=
 *  "param:{key}", so the per-key evidence packet lights up automatically.
 *  Moved out of the OTP-49 binding (which still re-uses it) when the console
 *  grew into the Calc Studio module. */

function EditDialog({
  param, onClose, onSaved,
}: {
  param: Parameter;
  onClose: () => void;
  onSaved: () => void;
}) {
  const user = useSessionUser();
  const toast = useToast();
  const navigate = useNavigate();
  const [value, setValue] = useState<string>(valueText(param.value));
  const [rationale, setRationale] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const isStructured = param.type === 'list' || param.type === 'dict';
  const isFabricated = param.provenance === 'fabricated';

  // Parse the edited text back to the parameter's JSON shape.
  const parsed = useMemo<{ ok: boolean; value: unknown; err?: string }>(() => {
    const raw = value.trim();
    try {
      if (param.type === 'number') {
        if (raw === '' || Number.isNaN(Number(raw))) return { ok: false, value: null, err: 'Enter a number' };
        return { ok: true, value: Number(raw) };
      }
      if (param.type === 'string') return { ok: true, value: raw };
      // list / dict / unknown → parse as JSON
      return { ok: true, value: JSON.parse(raw) };
    } catch (e) {
      return { ok: false, value: null, err: `Invalid JSON: ${String(e)}` };
    }
  }, [value, param.type]);

  const save = async () => {
    if (!parsed.ok) return;
    setSaving(true);
    try {
      await api.patchParameter(param.key, {
        value: parsed.value,
        actor: user.id,
        rationale: rationale.trim() || `Edited ${param.key} via the management console`,
      });
      toast.show(`Saved ${param.key} — recorded at param:${param.key}`, 'success');
      onSaved();
      onClose();
    } catch (e) {
      toast.show(`Save failed: ${String(e)}`, 'error');
    } finally {
      setSaving(false);
      setConfirm(false);
    }
  };

  const onSaveClick = () => {
    if (isFabricated) { setConfirm(true); return; }
    void save();
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          <Typography variant="h6" component="span" sx={{ fontFamily: 'monospace' }}>{param.key}</Typography>
          <ProvenanceChip source={param.provenance ?? 'assumed'} kind={provKind(param.provenance)} />
          {param.category && <Chip size="small" label={param.category} />}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {param.rationale && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{param.rationale}</Typography>
          )}
          <TextField
            label={isStructured ? `Value (JSON ${param.type})` : `Value (${param.type ?? 'text'})`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            fullWidth
            multiline={isStructured}
            minRows={isStructured ? 3 : undefined}
            error={!parsed.ok}
            helperText={!parsed.ok ? parsed.err : `Default: ${valueText(param.default)}`}
            sx={isStructured ? { '& textarea': { fontFamily: 'monospace', fontSize: 13 } } : undefined}
          />
          {(param.min_value != null || param.max_value != null) && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Bounds: {param.min_value ?? '−∞'} … {param.max_value ?? '∞'}
            </Typography>
          )}
          <TextField
            label="Rationale (recorded in the audit trail)"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            fullWidth
            placeholder="Why is this changing?"
          />
          <Alert severity="info" variant="outlined">
            Saving hash-chains the change at <b>param:{param.key}</b>. The Audit tab and the{' '}
            <Button size="small" onClick={() => navigate(`/evidence/${encodeURIComponent(`param:${param.key}`)}`)}>
              evidence packet
            </Button>{' '}
            update automatically.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          onClick={onSaveClick}
          disabled={!parsed.ok || saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>

      {/* Light maker-checker guard for fabricated magnitudes — a confirm gate. */}
      <Dialog open={confirm} onClose={() => setConfirm(false)} maxWidth="xs">
        <DialogTitle>Edit a fabricated magnitude?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            <b>{param.key}</b> is a <b>fabricated</b> demo magnitude (no warehouse source). Editing it
            changes every figure derived from it. The change is recorded against you at param:{param.key}.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={() => void save()}>Confirm &amp; save</Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

export default function DriversTab() {
  const { params, refresh } = useParameters();
  const user = useSessionUser();
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Parameter | null>(null);

  if (params === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const reset = async (p: Parameter) => {
    try {
      await api.resetParameter(p.key, { actor: user.id });
      toast.show(`Reset ${p.key} to default`, 'success');
      void refresh();
    } catch (e) {
      toast.show(`Reset failed: ${String(e)}`, 'error');
    }
  };

  const isChanged = (p: Parameter) => valueText(p.value) !== valueText(p.default);

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        The governed parameter store — every calc magnitude that used to be a hardcoded literal scattered
        across routers (CSA growth/PCT, the BEAT §59A thresholds and RACCT→payment-type map, the
        reconciliation tolerance, …) lives here as one editable, auditable row. Each edit hash-chains at{' '}
        <b>param:&#123;key&#125;</b>; the Audit tab and the per-key evidence packet light up automatically.
      </Alert>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Parameter</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Provenance</TableCell>
              <TableCell>Current value</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {params.map((p) => (
              <TableRow key={p.key} hover>
                <TableCell sx={{ maxWidth: 280 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{p.key}</Typography>
                  {p.process_id && (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{p.process_id}</Typography>
                  )}
                </TableCell>
                <TableCell>{p.category && <Chip size="small" label={p.category} />}</TableCell>
                <TableCell>
                  <ProvenanceChip
                    source={p.provenance ?? 'assumed'}
                    kind={provKind(p.provenance)}
                    tooltip={PROV_META[provKind(p.provenance)].hint}
                  />
                </TableCell>
                <TableCell sx={{ maxWidth: 260 }}>
                  <Typography
                    variant="body2"
                    sx={{ fontFamily: 'monospace', fontWeight: 600, overflowWrap: 'anywhere' }}
                  >
                    {valueText(p.value)}
                  </Typography>
                  {isChanged(p) && (
                    <Chip size="small" color="warning" label="changed" sx={{ height: 18, fontSize: 10, mt: 0.5 }} />
                  )}
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button size="small" variant="outlined" onClick={() => setEditing(p)}>Edit</Button>
                    {isChanged(p) && (
                      <Button size="small" onClick={() => void reset(p)}>Reset</Button>
                    )}
                    <Button
                      size="small"
                      onClick={() => navigate(`/evidence/${encodeURIComponent(`param:${p.key}`)}`)}
                    >
                      Audit
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {editing && (
        <EditDialog param={editing} onClose={() => setEditing(null)} onSaved={() => void refresh()} />
      )}
    </Stack>
  );
}
