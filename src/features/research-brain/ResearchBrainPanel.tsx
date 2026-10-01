import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Paper,
  Box,
  Typography,
  IconButton,
  TextField,
  InputAdornment,
  Stack,
  Chip,
  CircularProgress,
  Divider,
  Collapse,
  Slide } from
'@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import RemoveIcon from '@mui/icons-material/Remove';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import SendIcon from '@mui/icons-material/Send';
import PsychologyIcon from '@mui/icons-material/Psychology';
import { useResearchBrain } from './ResearchBrainContext';
import ResearchBrainConversation, { type ConversationAction } from './ResearchBrainConversation';
import { adjustmentRoute } from '@/kernel/workflow/originRoute';
import { api, type ResearchBrainAnswer } from '@/shared/api/client';
import { ModeChip, modeOf } from './modeChip';

type LiveMsg = ResearchBrainAnswer & { q: string };

export default function ResearchBrainPanel() {
  const { open, closePanel, context } = useResearchBrain();
  const [minimized, setMinimized] = useState(false);
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<LiveMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onConversationAction = (action: ConversationAction) => {
    if (action === 'run-adjustment') {
      closePanel();
      navigate(adjustmentRoute(context?.entityId || '3400'));
    } else if (action === 'export') {
      const blob = new Blob(
        [JSON.stringify({ context, exportedAt: new Date().toISOString(), messages: msgs }, null, 2)],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'research-brain-thread.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } else if (action === 'follow-up') {
      inputRef.current?.focus();
    }
  };
  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setLoading(true);
    try {
      const res = await api.researchBrainAsk({
        question: q,
        jurisdiction: context?.jurisdiction,
        tp_method: context?.method,
      });
      setMsgs((m) => [...m, { q, ...res }]);
    } catch {
      setMsgs((m) => [...m, { q, answer: 'Request failed — the assistant is unavailable.', citations: [], live: false, mode: 'offline', note: null }]);
    } finally {
      setLoading(false);
    }
  };
  const contextLabel = context ?
  `Context loaded: ${context.entityId || ''} — ${context.entityName || ''} — ${context.function || ''} — ${context.transactionType || ''} — ${context.method || ''}`.
  replace(/— ($|—)/g, '').
  replace(/ — —/g, ' —') :
  'Context loaded: IE-002 — Ireland Distribution Co. — LRD — Tangible Goods — TNMM';
  return (
    <Slide direction="up" in={open} mountOnEnter unmountOnExit>
      <Paper
        elevation={12}
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 1300,
          width: {
            xs: 'calc(100vw - 32px)',
            sm: 420
          },
          height: minimized ? 56 : 600,
          maxHeight: 'calc(100vh - 48px)',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 2,
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.35)',
          border: '1px solid #E2E8F0'
        }}
        role="dialog"
        aria-label="Research Brain chat">
        
        {/* Header */}
        <Box
          sx={{
            px: 2,
            py: 1.5,
            bgcolor: '#0F172A',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            gap: 1
          }}>
          
          <Box
            sx={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center'
            }}>
            
            <PsychologyIcon
              sx={{
                color: '#60A5FA'
              }} />
            
            <Box
              className="rb-pulse-dot"
              sx={{
                position: 'absolute',
                top: 0,
                right: -3,
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: '#22C55E',
                border: '2px solid #0F172A'
              }} />
            
          </Box>
          <Box
            sx={{
              flex: 1,
              minWidth: 0
            }}>
            
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                lineHeight: 1.1
              }}>
              
              Research Brain
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: '#94A3B8',
                fontSize: 10
              }}>
              
              Powered by Aperture TP IP
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={() => setMinimized((m) => !m)}
            sx={{
              color: 'white'
            }}
            aria-label="Minimize">
            
            <RemoveIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => {
              closePanel();
              navigate('/research-brain');
            }}
            sx={{
              color: 'white'
            }}
            aria-label="Expand to full screen">
            
            <OpenInFullIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={closePanel}
            sx={{
              color: 'white'
            }}
            aria-label="Close">
            
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <Collapse
          in={!minimized}
          sx={{
            flex: 1,
            minHeight: 0,
            display: minimized ? 'none' : 'flex',
            flexDirection: 'column',
            '& .MuiCollapse-wrapper': {
              height: '100%'
            },
            '& .MuiCollapse-wrapperInner': {
              display: 'flex',
              flexDirection: 'column',
              height: '100%'
            }
          }}>
          
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%'
            }}>
            
            {/* Context banner */}
            <Box
              sx={{
                px: 1.5,
                py: 1,
                bgcolor: '#EFF6FF',
                borderBottom: '1px solid #DBEAFE'
              }}>
              
              <Typography
                variant="caption"
                sx={{
                  color: '#1D4ED8',
                  fontWeight: 600,
                  fontSize: 11
                }}>
                
                {contextLabel}
              </Typography>
            </Box>

            {/* Conversation */}
            <Box
              sx={{
                flex: 1,
                overflowY: 'auto',
                px: 1.5,
                py: 2,
                bgcolor: '#F8FAFC'
              }}>
              
              <ResearchBrainConversation onAction={onConversationAction} />
              {msgs.length > 0 && <Divider sx={{ my: 2, fontSize: 11, color: '#94A3B8' }}>Live</Divider>}
              {msgs.map((m, i) => (
                <Box key={i} sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                    <Box sx={{ maxWidth: '85%', bgcolor: '#2563EB', color: 'white', px: 2, py: 1.25, borderRadius: '12px 12px 2px 12px' }}>
                      <Typography variant="body2" sx={{ lineHeight: 1.5 }}>{m.q}</Typography>
                    </Box>
                  </Box>
                  <Paper elevation={0} sx={{ border: '1px solid #E2E8F0', borderRadius: '12px 12px 12px 2px', p: 2 }}>
                    <ModeChip mode={modeOf(m)} title={m.note ?? undefined} sx={{ mb: 1 }} />
                    <Typography variant="body2" sx={{ color: '#0F172A', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{m.answer}</Typography>
                    {m.citations.length > 0 && (
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                        {m.citations.map((c, j) => (
                          <Chip key={j} label={c.ref ? `${c.source} · ${c.ref}` : c.source} size="small" sx={{ bgcolor: '#EFF6FF', color: '#1D4ED8', fontSize: 11, fontWeight: 600 }} />
                        ))}
                      </Stack>
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

            {/* Input */}
            <Box
              sx={{
                borderTop: '1px solid #E2E8F0',
                p: 1.25,
                bgcolor: 'white'
              }}>
              
              <TextField
                fullWidth
                size="small"
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
                  endAdornment:
                  <InputAdornment position="end">
                      <IconButton
                      size="small"
                      onClick={() => void send()}
                      disabled={loading}
                      sx={{
                        bgcolor: '#2563EB',
                        color: 'white',
                        '&:hover': {
                          bgcolor: '#1D4ED8'
                        }
                      }}
                      aria-label="Send">

                        <SendIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>

                }} />
              
              <Typography
                variant="caption"
                sx={{
                  color: '#94A3B8',
                  display: 'block',
                  mt: 0.75,
                  fontSize: 10,
                  lineHeight: 1.4
                }}>
                
                Answers are sourced from the firm's proprietary TP IP corpus and
                are for informational purposes. Consult your TP advisor for
                formal guidance.
              </Typography>
            </Box>
          </Box>
        </Collapse>
      </Paper>
    </Slide>);

}