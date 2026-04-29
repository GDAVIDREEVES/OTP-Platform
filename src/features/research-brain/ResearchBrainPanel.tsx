import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Paper,
  Box,
  Typography,
  IconButton,
  TextField,
  InputAdornment,
  Stack,
  Collapse,
  Slide } from
'@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import RemoveIcon from '@mui/icons-material/Remove';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import SendIcon from '@mui/icons-material/Send';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import PsychologyIcon from '@mui/icons-material/Psychology';
import { useResearchBrain } from './ResearchBrainContext';
import ResearchBrainConversation from './ResearchBrainConversation';
export default function ResearchBrainPanel() {
  const { open, closePanel, context } = useResearchBrain();
  const [minimized, setMinimized] = useState(false);
  const navigate = useNavigate();
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
              
              <ResearchBrainConversation />
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
                placeholder="Ask a transfer pricing or global trade question…"
                InputProps={{
                  startAdornment:
                  <InputAdornment position="start">
                      <Stack direction="row" spacing={0.5}>
                        <IconButton size="small" aria-label="Attach document">
                          <AttachFileIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" aria-label="Switch context">
                          <SwapHorizIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </InputAdornment>,

                  endAdornment:
                  <InputAdornment position="end">
                      <IconButton
                      size="small"
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