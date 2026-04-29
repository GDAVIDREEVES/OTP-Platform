import React, { useState } from 'react';
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
  Link as MuiLink,
  Divider } from
'@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PushPinIcon from '@mui/icons-material/PushPin';
import ExpandMoreIcon from '@mui/icons-material/ChevronRight';
import ShareIcon from '@mui/icons-material/Share';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import AddIcon from '@mui/icons-material/Add';
import SendIcon from '@mui/icons-material/Send';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import ResearchBrainConversation from '@/features/research-brain/ResearchBrainConversation';
interface SavedThread {
  id: string;
  title: string;
  date: string;
  tags: string[];
  pinned?: boolean;
}
const threads: SavedThread[] = [
{
  id: 't1',
  title: 'IE-002 Year-End Adjustment — Irish TCA Part 35A',
  date: 'Dec 10, 2025',
  tags: ['IE', 'LRD', 'TNMM'],
  pinned: true
},
{
  id: 't2',
  title: 'MX-002 Freight Cost Treatment — SAT Guidance',
  date: 'Dec 9, 2025',
  tags: ['MX', 'LRD', 'Cost']
},
{
  id: 't3',
  title: 'Royalty Rate Benchmarking — CH-001 to IE-001',
  date: 'Dec 5, 2025',
  tags: ['CH', 'IE', 'Royalties']
},
{
  id: 't4',
  title: 'CSA Buy-In Valuation — US-006 / CH-003',
  date: 'Nov 28, 2025',
  tags: ['US', 'CH', 'Cost Share']
},
{
  id: 't5',
  title: 'UK Safe Harbor — Low Value Services',
  date: 'Nov 20, 2025',
  tags: ['UK', 'Services']
}];

export default function ResearchBrain() {
  const [active, setActive] = useState('t1');
  const contextChips = [
  'IE-002',
  'Ireland',
  'LRD',
  'Tangible Goods',
  'TNMM',
  'FY2025'];

  return (
    <AppShell pageTitle="Research Brain">
      <Grid
        container
        spacing={2.5}
        sx={{
          height: {
            md: 'calc(100vh - 116px)'
          }
        }}>
        
        {/* Left: Research Library */}
        <Grid item xs={12} md={4} lg={3.5}>
          <Paper
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              p: 2
            }}>
            
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                mb: 1.5
              }}>
              
              My Research Library
            </Typography>
            <TextField
              size="small"
              placeholder="Search saved threads…"
              fullWidth
              sx={{
                mb: 2
              }}
              InputProps={{
                startAdornment:
                <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>

              }} />
            
            <Box
              sx={{
                flex: 1,
                overflowY: 'auto',
                mx: -1,
                px: 1
              }}>
              
              <Stack spacing={1}>
                {threads.map((t) =>
                <Paper
                  key={t.id}
                  variant="outlined"
                  onClick={() => setActive(t.id)}
                  sx={{
                    p: 1.5,
                    cursor: 'pointer',
                    borderColor: active === t.id ? '#2563EB' : '#E2E8F0',
                    bgcolor: active === t.id ? '#EFF6FF' : 'white',
                    '&:hover': {
                      borderColor: '#2563EB'
                    }
                  }}>
                  
                    <Stack direction="row" alignItems="flex-start" spacing={1}>
                      <Box
                      sx={{
                        flex: 1,
                        minWidth: 0
                      }}>
                      
                        <Stack
                        direction="row"
                        spacing={0.5}
                        alignItems="center"
                        sx={{
                          mb: 0.5
                        }}>
                        
                          {t.pinned &&
                        <PushPinIcon
                          sx={{
                            fontSize: 12,
                            color: '#2563EB'
                          }} />

                        }
                          <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 600,
                            lineHeight: 1.3
                          }}>
                          
                            {t.title}
                          </Typography>
                        </Stack>
                        <Typography
                        variant="caption"
                        sx={{
                          color: '#64748B',
                          display: 'block',
                          mb: 0.75
                        }}>
                        
                          Saved {t.date}
                        </Typography>
                        <Stack
                        direction="row"
                        spacing={0.5}
                        flexWrap="wrap"
                        useFlexGap>
                        
                          {t.tags.map((tag) =>
                        <Chip
                          key={tag}
                          label={tag}
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: 10,
                            bgcolor: '#F1F5F9',
                            color: '#475569'
                          }} />

                        )}
                        </Stack>
                      </Box>
                      <IconButton size="small">
                        <ExpandMoreIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Paper>
                )}
              </Stack>
            </Box>
            <Divider
              sx={{
                my: 2
              }} />
            
            <Button variant="outlined" startIcon={<AddIcon />} fullWidth>
              New Query Thread
            </Button>
          </Paper>
        </Grid>

        {/* Right: Active Conversation */}
        <Grid item xs={12} md={8} lg={8.5}>
          <Paper
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column'
            }}>
            
            {/* Header */}
            <Box
              sx={{
                px: 3,
                py: 2,
                borderBottom: '1px solid #E2E8F0'
              }}>
              
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                spacing={2}
                sx={{
                  mb: 1.5
                }}>
                
                <Breadcrumbs
                  sx={{
                    fontSize: 13
                  }}>
                  
                  <MuiLink underline="hover" color="inherit" href="#">
                    Research Brain
                  </MuiLink>
                  <Typography
                    variant="body2"
                    sx={{
                      color: '#0F172A',
                      fontWeight: 600
                    }}>
                    
                    IE-002 — Irish TP Adjustment Thread
                  </Typography>
                </Breadcrumbs>
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<ShareIcon />}>
                    
                    Share Thread
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<PictureAsPdfIcon />}>
                    
                    Export PDF
                  </Button>
                </Stack>
              </Stack>

              {/* Context chips */}
              <Stack
                direction="row"
                spacing={0.75}
                flexWrap="wrap"
                useFlexGap
                alignItems="center">
                
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B',
                    fontWeight: 600,
                    mr: 0.5
                  }}>
                  
                  Context:
                </Typography>
                {contextChips.map((c) =>
                <Chip
                  key={c}
                  label={c}
                  size="small"
                  onDelete={() => {}}
                  sx={{
                    bgcolor: '#EFF6FF',
                    color: '#1D4ED8',
                    fontWeight: 600
                  }} />

                )}
                <Chip
                  icon={<AddIcon />}
                  label="Add context"
                  size="small"
                  variant="outlined"
                  sx={{
                    cursor: 'pointer'
                  }} />
                
              </Stack>
            </Box>

            {/* Conversation */}
            <Box
              sx={{
                flex: 1,
                overflowY: 'auto',
                px: 3,
                py: 3,
                bgcolor: '#F8FAFC'
              }}>
              
              <Box
                sx={{
                  maxWidth: 900,
                  mx: 'auto'
                }}>
                
                <ResearchBrainConversation />
              </Box>
            </Box>

            {/* Input */}
            <Box
              sx={{
                borderTop: '1px solid #E2E8F0',
                p: 2,
                bgcolor: 'white'
              }}>
              
              <Box
                sx={{
                  maxWidth: 900,
                  mx: 'auto'
                }}>
                
                <TextField
                  fullWidth
                  placeholder="Ask a transfer pricing or global trade question…"
                  InputProps={{
                    startAdornment:
                    <InputAdornment position="start">
                        <Stack direction="row" spacing={0.5}>
                          <IconButton size="small" aria-label="Attach">
                            <AttachFileIcon />
                          </IconButton>
                          <IconButton size="small" aria-label="Switch context">
                            <SwapHorizIcon />
                          </IconButton>
                        </Stack>
                      </InputAdornment>,

                    endAdornment:
                    <InputAdornment position="end">
                        <Button variant="contained" endIcon={<SendIcon />}>
                          Send
                        </Button>
                      </InputAdornment>

                  }} />
                
                <Typography
                  variant="caption"
                  sx={{
                    color: '#94A3B8',
                    display: 'block',
                    mt: 1
                  }}>
                  
                  Answers are sourced from the firm's proprietary TP IP corpus
                  and are for informational purposes. Consult your TP advisor
                  for formal guidance.
                </Typography>
              </Box>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </AppShell>);

}