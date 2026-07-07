import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Divider, Stack, TextField, Typography,
} from '@mui/material';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useToast } from '@/shared/providers/DataProvider';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import { HistoryButton } from '@/kernel/audit/HistoryDrawer';
import type { AuditEvent, Parameter } from '@/shared/api/types';
import { provKind, valueText } from '../lib';

/** ParamEditDialog (GP5) — the ONE hardened dialog for a DIRECT governed-parameter
 *  edit. Both the Drivers & Assumptions table and the cockpit palette pencil open
 *  it, replacing their two divergent edit paths (a confirm-only dialog and a
 *  canned-rationale inline PATCH). The reviewed path — scenario promotion — is
 *  deliberately NOT collapsed in here; it stays the maker-checker route and this
 *  dialog points the user toward it.
 *
 *  Guardrails (mirrored by the backend so the user sees them before any 400):
 *   - a non-empty rationale is REQUIRED (Save disabled until then);
 *   - a numeric param's governed min/max is validated client-side;
 *   - a fabricated magnitude keeps its confirm gate;
 *   - the last few param:{key} audit events are shown inline, with a
 *     HistoryButton (GP0) for the full drawer.
 */
export default function ParamEditDialog({
  open, param, onClose, onSaved,
}: {
  open: boolean;
  param: Parameter | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const user = useSessionUser();
  const toast = useToast();
  const navigate = useNavigate();
  const [value, setValue] = useState<string>(() => (param ? valueText(param.value) : ''));
  const [rationale, setRationale] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);

  const key = param?.key ?? '';
  const isStructured = param?.type === 'list' || param?.type === 'dict';
  const isFabricated = param?.provenance === 'fabricated';

  // Re-sync the form to the target param whenever the dialog (re)opens onto a
  // (possibly different) param — a controlled dialog can be reused in place.
  useEffect(() => {
    if (open && param) {
      setValue(valueText(param.value));
      setRationale('');
      setConfirm(false);
    }
  }, [open, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compact inline history: the param:{key} evidence packet's events (last 3).
  useEffect(() => {
    if (!open || !param) { setEvents(null); return undefined; }
    let alive = true;
    setEvents(null);
    api.evidence(`param:${param.key}`)
      .then((p) => { if (alive) setEvents(p.events); })
      .catch(() => { if (alive) setEvents([]); });
    return () => { alive = false; };
  }, [open, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Parse the edited text back to the parameter's JSON shape.
  const parsed = useMemo<{ ok: boolean; value: unknown; err?: string }>(() => {
    if (!param) return { ok: false, value: null };
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
  }, [value, param?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Client-side bounds mirror of the backend rule — numeric scalars only.
  const boundsError = useMemo<string | null>(() => {
    if (!param || !parsed.ok || typeof parsed.value !== 'number') return null;
    if (param.min_value != null && parsed.value < param.min_value) return `Below the minimum ${param.min_value}`;
    if (param.max_value != null && parsed.value > param.max_value) return `Above the maximum ${param.max_value}`;
    return null;
  }, [parsed, param?.min_value, param?.max_value]); // eslint-disable-line react-hooks/exhaustive-deps

  const rationaleOk = rationale.trim() !== '';
  const formValid = parsed.ok && !boundsError && rationaleOk;

  const save = async () => {
    if (!param || !formValid) return;
    setSaving(true);
    try {
      await api.patchParameter(param.key, {
        value: parsed.value,
        actor: user.id,
        rationale: rationale.trim(),
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

  const goToScenario = () => {
    if (!param) return;
    onClose();
    navigate(`/calc-studio/scenarios?param=${encodeURIComponent(param.key)}`);
  };

  if (!param) return null;

  const recent = (events ?? []).slice(-3).reverse(); // newest first

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
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
            error={!parsed.ok || Boolean(boundsError)}
            helperText={!parsed.ok ? parsed.err : boundsError ?? `Default: ${valueText(param.default)}`}
            sx={isStructured ? { '& textarea': { fontFamily: 'monospace', fontSize: 13 } } : undefined}
          />
          {(param.min_value != null || param.max_value != null) && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Bounds: {param.min_value ?? '−∞'} … {param.max_value ?? '∞'}
            </Typography>
          )}
          <TextField
            label="Rationale (required — recorded in the audit trail)"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            fullWidth
            required
            error={!rationaleOk && rationale !== ''}
            helperText={!rationaleOk ? 'A rationale is required for a direct edit.' : ' '}
            placeholder="Why is this changing?"
          />

          {/* Direct-edit governance notice — the scenario route is the reviewed one. */}
          <Alert severity="info" variant="outlined" icon={<ScienceOutlinedIcon fontSize="small" />}>
            <Typography variant="body2">
              Direct edit — bypasses scenario review; each save is audited at <b>param:{param.key}</b>.
            </Typography>
            <Button size="small" onClick={goToScenario} sx={{ mt: 0.5, ml: -0.75 }}>
              What-if first → create a Scenario
            </Button>
          </Alert>

          <Divider />

          {/* Inline history — the last few edits, plus the full drawer (GP0). */}
          <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="overline" sx={{ color: 'text.secondary' }}>Recent changes</Typography>
              <HistoryButton recordRef={`param:${param.key}`} />
            </Stack>
            {events === null ? (
              <Box sx={{ display: 'flex', py: 1 }}><CircularProgress size={16} /></Box>
            ) : recent.length === 0 ? (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                No prior edits recorded.
              </Typography>
            ) : (
              recent.map((e) => (
                <Stack key={e.id} direction="row" spacing={1} alignItems="baseline" sx={{ py: 0.25 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                    {new Date(e.ts).toLocaleDateString()}
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{e.actor}</Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {e.event_type}{e.rationale ? ` — ${e.rationale}` : ''}
                  </Typography>
                </Stack>
              ))
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          onClick={onSaveClick}
          disabled={!formValid || saving}
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
