import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '@/shared/components/layout/AppShell';
import {
  Box,
  Grid,
  Paper,
  Typography,
  TextField,
  InputAdornment,
  Stack,
  Chip,
  IconButton,
  Button,
  Breadcrumbs,
  Divider,
  CircularProgress,
  Snackbar,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PushPinIcon from '@mui/icons-material/PushPin';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ShareIcon from '@mui/icons-material/Share';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import AddIcon from '@mui/icons-material/Add';
import SendIcon from '@mui/icons-material/Send';
import ResearchBrainConversation, {
  type ConversationAction,
} from '@/features/research-brain/ResearchBrainConversation';
import { api, type ResearchBrainAnswer, type ResearchBrainStatus } from '@/shared/api/client';
import { ModeChip, MODE_STYLE, modeOf } from '@/features/research-brain/modeChip';
import { adjustmentRoute } from '@/kernel/workflow/originRoute';
import { downloadJson } from '@/shared/utils/download';

interface SavedThread {
  id: string;
  title: string;
  date: string;
  tags: string[];
  pinned?: boolean;
}

type LiveMsg = ResearchBrainAnswer & { q: string };

/** Seeded library. `t1` carries the worked IE-002 example conversation; the
 *  others are saved headers you continue by asking a follow-up. */
const SEED_THREADS: SavedThread[] = [
  { id: 't1', title: 'IE-002 Year-End Adjustment — Irish TCA Part 35A', date: 'Dec 10, 2025', tags: ['IE', 'LRD', 'TNMM'], pinned: true },
  { id: 't2', title: 'MX-002 Freight Cost Treatment — SAT Guidance', date: 'Dec 9, 2025', tags: ['MX', 'LRD', 'Cost'] },
  { id: 't3', title: 'Royalty Rate Benchmarking — CH-001 to IE-001', date: 'Dec 5, 2025', tags: ['CH', 'IE', 'Royalties'] },
  { id: 't4', title: 'CSA Buy-In Valuation — US-006 / CH-003', date: 'Nov 28, 2025', tags: ['US', 'CH', 'Cost Share'] },
  { id: 't5', title: 'UK Safe Harbor — Low Value Services', date: 'Nov 20, 2025', tags: ['UK', 'Services'] },
];

const SEED_CONTEXT = ['IE-002', 'Ireland', 'LRD', 'Tangible Goods', 'TNMM', 'FY2025'];

/** Context chips that steer retrieval: a recognised method is passed as
 *  `tp_method`, a recognised country as `jurisdiction`. Everything else is a
 *  label for the human. */
const METHODS = ['TNMM', 'CUP', 'CPM', 'RPM', 'PSM', 'TNMM/CPM', 'Cost Plus', 'Profit Split'];


export default function ResearchBrain() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [threads, setThreads] = useState<SavedThread[]>(SEED_THREADS);
  const [active, setActive] = useState<string>(() => {
    const t = params.get('thread');
    return t && SEED_THREADS.some((s) => s.id === t) ? t : 't1';
  });
  const [search, setSearch] = useState('');
  const [contextChips, setContextChips] = useState<string[]>(SEED_CONTEXT);
  const [addingContext, setAddingContext] = useState(false);
  const [newContext, setNewContext] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState<Record<string, LiveMsg[]>>({});
  const [snack, setSnack] = useState<string | null>(null);
  const [status, setStatus] = useState<ResearchBrainStatus | null>(null);

  // Connection badge: which answer path the backend will take right now.
  useEffect(() => {
    let alive = true;
    const refresh = () => api.researchBrainStatus().then((s) => alive && setStatus(s)).catch(() => alive && setStatus(null));
    refresh();
    const t = window.setInterval(refresh, 30_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const activeThread = threads.find((t) => t.id === active) ?? threads[0];
  const msgs = live[active] ?? [];

  // Keep the URL shareable: /research-brain?thread=<id>
  useEffect(() => {
    if (params.get('thread') !== active) {
      const next = new URLSearchParams(params);
      next.set('thread', active);
      setParams(next, { replace: true });
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs.length, loading]);

  const visibleThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(
      (t) => t.title.toLowerCase().includes(q) || t.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [threads, search]);

  const newThread = () => {
    const id = `t${Date.now()}`;
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    setThreads((ts) => [{ id, title: 'New query thread', date: today, tags: [] }, ...ts]);
    setActive(id);
    setSearch('');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setLoading(true);
    const method = contextChips.find((c) => METHODS.includes(c));
    const jurisdiction = contextChips.find(
      (c) => !METHODS.includes(c) && /^[A-Z][a-z]+( [A-Z][a-z]+)*$/.test(c),
    );
    try {
      const res = await api.researchBrainAsk({ question: q, tp_method: method, jurisdiction });
      setLive((m) => ({ ...m, [active]: [...(m[active] ?? []), { q, ...res }] }));
      // A fresh thread takes its title from the first question.
      setThreads((ts) =>
        ts.map((t) => (t.id === active && t.title === 'New query thread' ? { ...t, title: q.slice(0, 72) } : t)),
      );
    } catch {
      setLive((m) => ({
        ...m,
        [active]: [...(m[active] ?? []), { q, answer: 'Request failed — the assistant is unavailable.', citations: [], live: false, mode: 'offline', note: null }],
      }));
    } finally {
      setLoading(false);
    }
  };

  const shareThread = async () => {
    const url = `${window.location.origin}/research-brain?thread=${encodeURIComponent(active)}`;
    try {
      await navigator.clipboard.writeText(url);
      setSnack('Thread link copied to clipboard');
    } catch {
      setSnack(`Share this link: ${url}`);
    }
  };

  const exportThread = () => {
    downloadJson(`research-brain-${active}.json`, {
      thread: activeThread,
      context: contextChips,
      exportedAt: new Date().toISOString(),
      messages: msgs,
      note: active === 't1' ? 'Includes the seeded IE-002 worked example shown on screen.' : undefined,
    });
    setSnack('Thread exported as JSON');
  };

  const onConversationAction = (action: ConversationAction) => {
    if (action === 'run-adjustment') navigate(adjustmentRoute('3400'));
    else if (action === 'export') exportThread();
    else if (action === 'follow-up') inputRef.current?.focus();
  };

  const commitContext = () => {
    const v = newContext.trim();
    if (v && !contextChips.includes(v)) setContextChips((c) => [...c, v]);
    setNewContext('');
    setAddingContext(false);
  };

  return (
    <AppShell pageTitle="Research Brain">
      <Grid container spacing={2.5} sx={{ height: { md: 'calc(100vh - 116px)' } }}>
        {/* Left: Research Library */}
        <Grid item xs={12} md={4} lg={3.5}>
          <Paper sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
              My Research Library
            </Typography>
            <TextField
              size="small"
              placeholder="Search saved threads…"
              fullWidth
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ mb: 2 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <Box sx={{ flex: 1, overflowY: 'auto', mx: -1, px: 1 }}>
              <Stack spacing={1}>
                {visibleThreads.length === 0 && (
                  <Typography variant="body2" sx={{ color: '#64748B', px: 0.5, py: 1 }}>
                    No saved threads match “{search}”.
                  </Typography>
                )}
                {visibleThreads.map((t) => (
                  <Paper
                    key={t.id}
                    variant="outlined"
                    role="button"
                    tabIndex={0}
                    onClick={() => setActive(t.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setActive(t.id);
                    }}
                    sx={{
                      p: 1.5,
                      cursor: 'pointer',
                      borderColor: active === t.id ? '#2563EB' : '#E2E8F0',
                      bgcolor: active === t.id ? '#EFF6FF' : 'white',
                      '&:hover': { borderColor: '#2563EB' },
                    }}>
                    <Stack direction="row" alignItems="flex-start" spacing={1}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
                          {t.pinned && <PushPinIcon sx={{ fontSize: 12, color: '#2563EB' }} />}
                          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                            {t.title}
                          </Typography>
                        </Stack>
                        <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 0.75 }}>
                          Saved {t.date}
                          {(live[t.id]?.length ?? 0) > 0 && ` · ${live[t.id].length} live`}
                        </Typography>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {t.tags.map((tag) => (
                            <Chip
                              key={tag}
                              label={tag}
                              size="small"
                              sx={{ height: 20, fontSize: 10, bgcolor: '#F1F5F9', color: '#475569' }}
                            />
                          ))}
                        </Stack>
                      </Box>
                      <ChevronRightIcon fontSize="small" sx={{ color: '#94A3B8', mt: 0.25 }} />
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </Box>
            <Divider sx={{ my: 2 }} />
            <Button variant="outlined" startIcon={<AddIcon />} fullWidth onClick={newThread}>
              New Query Thread
            </Button>
          </Paper>
        </Grid>

        {/* Right: Active Conversation */}
        <Grid item xs={12} md={8} lg={8.5}>
          <Paper sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <Box sx={{ px: 3, py: 2, borderBottom: '1px solid #E2E8F0' }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2} sx={{ mb: 1.5 }}>
                <Breadcrumbs sx={{ fontSize: 13, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ color: '#64748B' }}>
                    Research Brain
                  </Typography>
                  <Typography variant="body2" noWrap sx={{ color: '#0F172A', fontWeight: 600, maxWidth: 420 }}>
                    {activeThread?.title}
                  </Typography>
                </Breadcrumbs>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
                  {status && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={
                        status.mode === 'researchbrain'
                          ? 'Knowledge base connected'
                          : status.mode === 'claude'
                            ? `Claude direct · ${status.claude.model ?? ''}`
                            : 'Assistant offline'
                      }
                      title={
                        status.mode === 'researchbrain'
                          ? `researchbrain at ${status.researchbrain.url}`
                          : `${status.researchbrain.detail} — set RESEARCH_BRAIN_BASE_URL / RESEARCH_BRAIN_API_KEY${status.claude.configured ? '' : ' and ANTHROPIC_API_KEY'} in backend/.env`
                      }
                      sx={{
                        height: 24,
                        fontSize: 11,
                        fontWeight: 700,
                        color: MODE_STYLE[status.mode].color,
                        borderColor: MODE_STYLE[status.mode].color,
                        '& .MuiChip-icon': { color: 'inherit' },
                      }}
                      icon={
                        <Box
                          component="span"
                          sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: MODE_STYLE[status.mode].color, ml: '8px !important' }}
                        />
                      }
                    />
                  )}
                  <Button variant="outlined" size="small" startIcon={<ShareIcon />} onClick={() => void shareThread()}>
                    Share Thread
                  </Button>
                  <Button variant="outlined" size="small" startIcon={<PictureAsPdfIcon />} onClick={() => window.print()}>
                    Export PDF
                  </Button>
                </Stack>
              </Stack>

              {/* Context chips */}
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600, mr: 0.5 }}>
                  Context:
                </Typography>
                {contextChips.map((c) => (
                  <Chip
                    key={c}
                    label={c}
                    size="small"
                    onDelete={() => setContextChips((chips) => chips.filter((x) => x !== c))}
                    sx={{ bgcolor: '#EFF6FF', color: '#1D4ED8', fontWeight: 600 }}
                  />
                ))}
                {addingContext ? (
                  <TextField
                    autoFocus
                    size="small"
                    placeholder="e.g. Germany, CUP, FY2026"
                    value={newContext}
                    onChange={(e) => setNewContext(e.target.value)}
                    onBlur={commitContext}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitContext();
                      if (e.key === 'Escape') {
                        setNewContext('');
                        setAddingContext(false);
                      }
                    }}
                    inputProps={{ 'aria-label': 'New context tag' }}
                    sx={{ width: 200, '& .MuiInputBase-root': { height: 24, fontSize: 12 } }}
                  />
                ) : (
                  <Chip
                    icon={<AddIcon />}
                    label="Add context"
                    size="small"
                    variant="outlined"
                    onClick={() => setAddingContext(true)}
                    sx={{ cursor: 'pointer' }}
                  />
                )}
              </Stack>
            </Box>

            {/* Conversation */}
            <Box ref={scrollRef} sx={{ flex: 1, overflowY: 'auto', px: 3, py: 3, bgcolor: '#F8FAFC' }}>
              <Box sx={{ maxWidth: 900, mx: 'auto' }}>
                {active === 't1' ? (
                  <ResearchBrainConversation onAction={onConversationAction} />
                ) : msgs.length === 0 && !loading ? (
                  <Paper
                    elevation={0}
                    sx={{ border: '1px dashed #CBD5E1', borderRadius: 2, p: 3, textAlign: 'center', color: '#64748B' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: '#334155', mb: 0.5 }}>
                      {activeThread?.title}
                    </Typography>
                    <Typography variant="body2">
                      {activeThread?.tags.length
                        ? 'This saved thread has no cached transcript. Ask a follow-up below to continue it against the knowledge base.'
                        : 'Start by asking a transfer pricing or global trade question below.'}
                    </Typography>
                  </Paper>
                ) : null}

                {msgs.length > 0 && active === 't1' && (
                  <Divider sx={{ my: 2, fontSize: 11, color: '#94A3B8' }}>Live</Divider>
                )}
                {msgs.map((m, i) => (
                  <Box key={i} sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                      <Box sx={{ maxWidth: '85%', bgcolor: '#2563EB', color: 'white', px: 2, py: 1.25, borderRadius: '12px 12px 2px 12px' }}>
                        <Typography variant="body2" sx={{ lineHeight: 1.5 }}>{m.q}</Typography>
                      </Box>
                    </Box>
                    <Paper elevation={0} sx={{ maxWidth: '95%', border: '1px solid #E2E8F0', borderRadius: '12px 12px 12px 2px', p: 2 }}>
                      <ModeChip mode={modeOf(m)} title={m.note ?? undefined} sx={{ mb: 1 }} />
                      <Typography variant="body2" sx={{ color: '#0F172A', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                        {m.answer}
                      </Typography>
                      {m.citations.length > 0 && (
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                          {m.citations.map((c, j) => (
                            <Chip
                              key={j}
                              label={c.ref ? `${c.source} · ${c.ref}` : c.source}
                              size="small"
                              title={c.snippet}
                              sx={{ bgcolor: '#EFF6FF', color: '#1D4ED8', fontSize: 11, fontWeight: 600 }}
                            />
                          ))}
                        </Stack>
                      )}
                      {m.note && modeOf(m) !== 'researchbrain' && (
                        <Typography variant="caption" sx={{ color: '#94A3B8', display: 'block', mt: 1 }}>
                          {m.note}
                        </Typography>
                      )}
                    </Paper>
                  </Box>
                ))}
                {loading && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                    <CircularProgress size={20} />
                  </Box>
                )}
              </Box>
            </Box>

            {/* Input */}
            <Box sx={{ borderTop: '1px solid #E2E8F0', p: 2, bgcolor: 'white' }}>
              <Box sx={{ maxWidth: 900, mx: 'auto' }}>
                <TextField
                  fullWidth
                  inputRef={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Ask a transfer pricing or global trade question…"
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <Button
                          variant="contained"
                          endIcon={<SendIcon />}
                          onClick={() => void send()}
                          disabled={loading || !input.trim()}>
                          Send
                        </Button>
                      </InputAdornment>
                    ),
                  }}
                />
                <Typography variant="caption" sx={{ color: '#94A3B8', display: 'block', mt: 1 }}>
                  Answers are sourced from the firm's proprietary TP IP corpus and are for informational
                  purposes. Consult your TP advisor for formal guidance.
                </Typography>
              </Box>
            </Box>
          </Paper>
        </Grid>
      </Grid>
      <Snackbar
        open={!!snack}
        autoHideDuration={3500}
        onClose={() => setSnack(null)}
        message={snack}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </AppShell>
  );
}
