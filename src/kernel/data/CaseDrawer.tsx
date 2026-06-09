import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { api } from '@/shared/api/client';
import type { Case } from '@/shared/api/types';
import { formatCurrency } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';

const ACTOR = 'u_demo';

/** Case kinds whose defense rests on the §6662 / Local File documentation pack
 *  (OTP-37) — the controversy side of the documentation ⇄ cases loop. */
const DOC_LINKED_KINDS = new Set(['apa', 'audit_defense']);

const STATUS_COLOR: Record<Case['status'], string> = {
  open: tokens.ink,
  in_progress: tokens.action,
  submitted: tokens.watch,
  closed: tokens.ok,
};

/** Status enum in workflow order, with human labels for the toggle control. */
const STATUS_STEPS: { value: Case['status']; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'closed', label: 'Closed' },
];

/** One label/value cell in the metadata grid. */
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{value}</Typography>
    </Box>
  );
}

/** Case workspace drawer: case metadata, a status control, an interactive
 *  checklist, and the evidence packet — each mutation is hash-chained into the
 *  audit trail (full history on the process Audit tab). Cloned from DrillDrawer.
 *
 *  Holds a local `current` copy seeded from the prop and replaced by each
 *  mutation's response, so the drawer reflects its own edits immediately while
 *  `onChanged` refreshes the parent worklist. */
export default function CaseDrawer({
  open,
  onClose,
  caseItem,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  caseItem: Case | null;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<Case | null>(caseItem);
  useEffect(() => {
    setCurrent(caseItem);
  }, [caseItem]);

  const setStatus = async (status: Case['status']) => {
    if (!current || status === current.status) return;
    setBusy(true);
    try {
      const updated = await api.setCaseStatus(current.id, { status, actor: ACTOR });
      setCurrent(updated);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const toggleStep = async (stepKey: string, done: boolean) => {
    if (!current) return;
    setBusy(true);
    try {
      const updated = await api.setCaseStep(current.id, { step_key: stepKey, done, actor: ACTOR });
      setCurrent(updated);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  /** Jump to the §6662 / Local File documentation pack (OTP-37), logging the
   *  cross-process link as a handoff on this case's record_ref so it rides the
   *  audit chain (surfaces on the Audit tab + evidence packet automatically). */
  const linkDocumentation = async () => {
    if (!current) return;
    void api
      .recordHandoff({
        record_ref: `case:${current.id}`,
        from_process: 'OTP-37',
        to_process: 'OTP-40',
        actor: ACTOR,
        summary: 'Local File / §6662 packet linked to controversy case',
      })
      .catch(() => undefined);
    navigate('/process/OTP-37/docs');
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 660 } } }}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" alignItems="flex-start" sx={{ mb: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>
              Case workspace
            </Typography>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                {current?.title ?? '—'}
              </Typography>
              {current && (
                <Chip
                  size="small"
                  label={STATUS_STEPS.find((s) => s.value === current.status)?.label ?? current.status}
                  sx={{ bgcolor: STATUS_COLOR[current.status], color: 'white', fontWeight: 700, height: 22 }}
                />
              )}
            </Stack>
          </Box>
          <IconButton onClick={onClose} aria-label="Close">
            <CloseIcon />
          </IconButton>
        </Stack>

        {!current ? null : (
          <Stack spacing={2.5}>
            {/* Metadata grid */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
              <Meta label="Kind" value={current.kind} />
              <Meta label="Owner" value={current.owner} />
              <Meta label="Counterparty" value={current.counterparty ?? '—'} />
              <Meta label="Jurisdiction" value={current.jurisdiction ?? '—'} />
              <Meta label="Opened" value={current.opened_at} />
              <Meta label="Due" value={current.due_at ?? '—'} />
              <Meta label="Exposure" value={current.exposure == null ? '—' : formatCurrency(current.exposure, 'USD', true)} />
            </Box>

            <Divider />

            {/* Status control */}
            <Box>
              <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                Status
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={current.status}
                disabled={busy}
                onChange={(_e, v) => v && setStatus(v as Case['status'])}
              >
                {STATUS_STEPS.map((s) => (
                  <ToggleButton key={s.value} value={s.value}>
                    {s.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>

            <Divider />

            {/* Checklist */}
            <Box>
              <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                Checklist
              </Typography>
              {current.checklist.length ? (
                <Stack>
                  {current.checklist.map((step) => (
                    <FormControlLabel
                      key={step.key}
                      control={
                        <Checkbox
                          checked={step.done}
                          disabled={busy}
                          onChange={() => toggleStep(step.key, !step.done)}
                        />
                      }
                      label={step.label}
                    />
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>No checklist on this case.</Typography>
              )}
            </Box>

            {current.notes && (
              <>
                <Divider />
                <Box>
                  <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                    Notes
                  </Typography>
                  <Typography variant="body2">{current.notes}</Typography>
                </Box>
              </>
            )}

            <Divider />

            {/* Evidence packet */}
            <Stack spacing={0.5}>
              <Button
                variant="outlined"
                startIcon={busy ? <CircularProgress size={16} /> : <DescriptionOutlinedIcon />}
                onClick={() => navigate(`/evidence/${encodeURIComponent('case:' + current.id)}`)}
                sx={{ alignSelf: 'flex-start' }}
              >
                Evidence packet
              </Button>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Full history on the Audit tab.
              </Typography>
            </Stack>

            {/* Supporting documentation — only for the kinds whose defense rests
                on the §6662 / Local File pack (closes the docs ⇄ cases loop). */}
            {DOC_LINKED_KINDS.has(current.kind) && (
              <Stack spacing={0.5}>
                <Button
                  variant="outlined"
                  startIcon={<DescriptionOutlinedIcon />}
                  onClick={linkDocumentation}
                  disabled={busy}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  Supporting documentation
                </Button>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Local File / §6662 workpaper (OTP-37). Linking logs a handoff on this case.
                </Typography>
              </Stack>
            )}
          </Stack>
        )}
      </Box>
    </Drawer>
  );
}
