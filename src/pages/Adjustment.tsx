import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import {
  Paper,
  Typography,
  Grid,
  Box,
  Stack,
  Button,
  Breadcrumbs,
  Link as MuiLink,
  Stepper,
  Step,
  StepLabel,
  Divider,
  Alert,
  Table,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  RadioGroup,
  Radio,
  FormControlLabel,
  TextField,
  Snackbar } from
'@mui/material';
import PsychologyIcon from '@mui/icons-material/Psychology';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useEntity, useJournalEntries, useSubmitAdjustment, useSettings } from '../data/DataProvider';
import { formatCurrency } from '../components/theme';
import { useResearchBrain } from '../components/research-brain/ResearchBrainContext';
export default function Adjustment() {
  const { id } = useParams();
  const navigate = useNavigate();
  const e = useEntity(id);
  const journal = useJournalEntries({ entity: id, limit: 25 });
  const settings = useSettings();
  const { submit, pending: submitting } = useSubmitAdjustment();
  const { openPanel } = useResearchBrain();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'median' | 'upper' | 'custom'>('median');
  const [customMargin, setCustomMargin] = useState(4);
  const [submitted, setSubmitted] = useState(false);
  if (!e)
  return (
    <AppShell pageTitle="Entity not found">
        <Paper
        sx={{
          p: 3
        }}>
        
          Entity {id} not found.
        </Paper>
      </AppShell>);

  const median = (e.targetMarginLow + e.targetMarginHigh) / 2;
  const actual = e.actualMargin ?? 0;
  const targetMargin =
  mode === 'median' ?
  median :
  mode === 'upper' ?
  e.targetMarginHigh :
  customMargin;
  const adjustmentAmount = Math.round(
    e.ytdVolume * ((actual - targetMargin) / 100)
  );
  return (
    <AppShell pageTitle={`Adjustment — ${e.id}`}>
      <Breadcrumbs
        sx={{
          mb: 2,
          fontSize: 13
        }}>
        
        <MuiLink
          underline="hover"
          color="inherit"
          onClick={() => navigate('/dashboard')}
          sx={{
            cursor: 'pointer'
          }}>
          
          Dashboard
        </MuiLink>
        <MuiLink
          underline="hover"
          color="inherit"
          onClick={() => navigate(`/entities/${e.id}`)}
          sx={{
            cursor: 'pointer'
          }}>
          
          {e.id}
        </MuiLink>
        <Typography
          variant="body2"
          sx={{
            color: '#0F172A',
            fontWeight: 600
          }}>
          
          Adjustment
        </Typography>
      </Breadcrumbs>

      <Paper
        sx={{
          p: 3,
          mb: 2.5
        }}>
        
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{
            mb: 2
          }}>
          
          <Box>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 700
              }}>
              
              Propose year-end adjustment
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: '#64748B'
              }}>
              
              Bring {e.name} within the arm's length range.
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={<PsychologyIcon />}
            onClick={() =>
            openPanel({
              entityId: e.id,
              entityName: e.name,
              jurisdiction: e.country,
              function: e.function,
              method: e.tpMethod,
              transactionType: 'Tangible Goods'
            })
            }>
            
            Ask Research Brain
          </Button>
        </Stack>

        <Stepper
          activeStep={step}
          sx={{
            mb: 3
          }}>
          
          <Step>
            <StepLabel>Select method</StepLabel>
          </Step>
          <Step>
            <StepLabel>Review & confirm</StepLabel>
          </Step>
          <Step>
            <StepLabel>Submit for approval</StepLabel>
          </Step>
        </Stepper>

        {step === 0 &&
        <Grid container spacing={3}>
            <Grid item xs={12} md={7}>
              <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                mb: 1
              }}>
              
                Adjustment target
              </Typography>
              <RadioGroup
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}>
              
                <Paper
                variant="outlined"
                sx={{
                  p: 1.5,
                  mb: 1
                }}>
                
                  <FormControlLabel
                  value="median"
                  control={<Radio />}
                  label={
                  <Box>
                        <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 600
                      }}>
                      
                          Adjust to median ({median}%)
                        </Typography>
                        <Typography
                      variant="caption"
                      sx={{
                        color: '#64748B'
                      }}>
                      
                          Firm-recommended — aligns with most jurisdictions'
                          expectations.
                        </Typography>
                      </Box>
                  } />
                
                </Paper>
                <Paper
                variant="outlined"
                sx={{
                  p: 1.5,
                  mb: 1
                }}>
                
                  <FormControlLabel
                  value="upper"
                  control={<Radio />}
                  label={
                  <Box>
                        <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 600
                      }}>
                      
                          Adjust to upper quartile ({e.targetMarginHigh}%)
                        </Typography>
                        <Typography
                      variant="caption"
                      sx={{
                        color: '#64748B'
                      }}>
                      
                          Smaller adjustment; still within defensible range.
                        </Typography>
                      </Box>
                  } />
                
                </Paper>
                <Paper
                variant="outlined"
                sx={{
                  p: 1.5
                }}>
                
                  <FormControlLabel
                  value="custom"
                  control={<Radio />}
                  label={
                  <Box>
                        <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 600
                      }}>
                      
                          Custom target
                        </Typography>
                      </Box>
                  } />
                
                  {mode === 'custom' &&
                <TextField
                  size="small"
                  value={customMargin}
                  onChange={(ev) =>
                  setCustomMargin(Number(ev.target.value))
                  }
                  sx={{
                    mt: 1,
                    ml: 4
                  }}
                  InputProps={{
                    endAdornment: '%'
                  }} />

                }
                </Paper>
              </RadioGroup>
            </Grid>
            <Grid item xs={12} md={5}>
              <Paper
              variant="outlined"
              sx={{
                p: 2.5,
                bgcolor: '#F8FAFC'
              }}>
              
                <Typography
                variant="caption"
                sx={{
                  color: '#64748B',
                  fontWeight: 600,
                  textTransform: 'uppercase'
                }}>
                
                  Calculated adjustment
                </Typography>
                <Typography
                variant="h4"
                sx={{
                  fontWeight: 800,
                  color: '#DC2626',
                  my: 1
                }}>
                
                  {formatCurrency(Math.abs(adjustmentAmount), 'USD')}
                </Typography>
                <Typography
                variant="body2"
                sx={{
                  color: '#475569',
                  mb: 2
                }}>
                
                  Upward intercompany charge from {e.id} to IE-001 (principal
                  manufacturer), reducing operating margin from {actual}% →{' '}
                  {targetMargin}%.
                </Typography>
                <Divider
                sx={{
                  my: 2
                }} />
              
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell
                      sx={{
                        border: 0,
                        color: '#64748B'
                      }}>
                      
                        YTD Volume
                      </TableCell>
                      <TableCell
                      sx={{
                        border: 0
                      }}
                      align="right">
                      
                        {formatCurrency(e.ytdVolume, 'USD', true)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell
                      sx={{
                        border: 0,
                        color: '#64748B'
                      }}>
                      
                        Current OM
                      </TableCell>
                      <TableCell
                      sx={{
                        border: 0
                      }}
                      align="right">
                      
                        {actual}%
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell
                      sx={{
                        border: 0,
                        color: '#64748B'
                      }}>
                      
                        Target OM
                      </TableCell>
                      <TableCell
                      sx={{
                        border: 0
                      }}
                      align="right">
                      
                        {targetMargin}%
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell
                      sx={{
                        border: 0,
                        color: '#64748B'
                      }}>
                      
                        Basis pp
                      </TableCell>
                      <TableCell
                      sx={{
                        border: 0
                      }}
                      align="right">
                      
                        {(actual - targetMargin).toFixed(1)}pp
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </Grid>

            {/* Supporting journal entries — audit trail from ACDOCA */}
            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="flex-end"
                  sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Supporting journal entries
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#64748B' }}>
                      Recent ACDOCA postings for {e.id} — these are the line items the adjustment will sit alongside.
                    </Typography>
                  </Box>
                  {journal.data && (
                    <Chip
                      label={`${journal.data.length} of latest 25 lines`}
                      size="small"
                      sx={{ bgcolor: '#F1F5F9', color: '#475569', fontWeight: 600 }}
                    />
                  )}
                </Stack>
                {journal.loading ? (
                  <Typography variant="body2" sx={{ color: '#64748B', py: 1.5 }}>
                    Loading journal entries…
                  </Typography>
                ) : journal.error ? (
                  <Alert severity="warning">{journal.error.message}</Alert>
                ) : journal.data && journal.data.length > 0 ? (
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small" sx={{ minWidth: 720 }}>
                      <TableBody>
                        {journal.data.slice(0, 12).map((j, i) => (
                          <TableRow key={`${j.BELNR}-${j.DOCLN}-${i}`} hover>
                            <TableCell sx={{ color: '#64748B', fontSize: 12 }}>
                              {j.BUDAT}
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                              {j.BELNR}/{j.DOCLN}
                            </TableCell>
                            <TableCell sx={{ fontSize: 12 }}>
                              <Box sx={{ fontWeight: 600 }}>{j.RACCT}</Box>
                              {j.RASSC && (
                                <Box sx={{ color: '#64748B', fontSize: 11 }}>
                                  TP: {j.RASSC}
                                </Box>
                              )}
                            </TableCell>
                            <TableCell sx={{ color: '#475569', fontSize: 12 }}>
                              {j.SGTXT || '—'}
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700, fontSize: 12 }}>
                              {formatCurrency(j.HSL, j.RHCUR || 'USD', false)}
                            </TableCell>
                            <TableCell sx={{ fontSize: 11, color: '#64748B' }}>
                              {j.BLART}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                ) : (
                  <Typography variant="body2" sx={{ color: '#64748B', py: 1.5 }}>
                    No journal entries found for this entity.
                  </Typography>
                )}
              </Paper>
            </Grid>
          </Grid>
        }

        {step === 1 &&
        <Box>
            <Alert
            severity="warning"
            sx={{
              mb: 2
            }}>
            
              This adjustment will generate invoice <b>INV-2025-1042</b> and
              route to Sam Rodriguez (Tax Director) for approval. A full audit
              trail will be recorded.
            </Alert>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Paper
                variant="outlined"
                sx={{
                  p: 2
                }}>
                
                  <Typography
                  variant="subtitle2"
                  sx={{
                    fontWeight: 700,
                    mb: 1.5
                  }}>
                  
                    Adjustment summary
                  </Typography>
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell
                        sx={{
                          color: '#64748B'
                        }}>
                        
                          Payor
                        </TableCell>
                        <TableCell align="right">{e.id}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell
                        sx={{
                          color: '#64748B'
                        }}>
                        
                          Payee
                        </TableCell>
                        <TableCell align="right">IE-001</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell
                        sx={{
                          color: '#64748B'
                        }}>
                        
                          Currency
                        </TableCell>
                        <TableCell align="right">EUR</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell
                        sx={{
                          color: '#64748B'
                        }}>
                        
                          Amount
                        </TableCell>
                        <TableCell
                        align="right"
                        sx={{
                          fontWeight: 700
                        }}>
                        
                          {formatCurrency(Math.abs(adjustmentAmount), 'USD')}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell
                        sx={{
                          color: '#64748B'
                        }}>
                        
                          Posting period
                        </TableCell>
                        <TableCell align="right">FY2025 — Dec 31</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </Paper>
              </Grid>
              <Grid item xs={12} md={6}>
                <Paper
                variant="outlined"
                sx={{
                  p: 2
                }}>
                
                  <Typography
                  variant="subtitle2"
                  sx={{
                    fontWeight: 700,
                    mb: 1.5
                  }}>
                  
                    Supporting documentation
                  </Typography>
                  <Stack spacing={1}>
                    <Chip
                    label="Firm TP Handbook — Ireland §7.2"
                    size="small"
                    sx={{
                      alignSelf: 'flex-start'
                    }} />
                  
                    <Chip
                    label="Irish TCA 1997, Part 35A"
                    size="small"
                    sx={{
                      alignSelf: 'flex-start'
                    }} />
                  
                    <Chip
                    label="OECD TP Guidelines 2022, Ch. I"
                    size="small"
                    sx={{
                      alignSelf: 'flex-start'
                    }} />
                  
                    <Chip
                    label="IE-002 Benchmark Study — FY2025"
                    size="small"
                    sx={{
                      alignSelf: 'flex-start'
                    }} />
                  
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        }

        {step === 2 &&
        <Box
          sx={{
            textAlign: 'center',
            py: 4
          }}>
          
            <CheckCircleIcon
            sx={{
              fontSize: 56,
              color: '#16A34A',
              mb: 2
            }} />
          
            <Typography
            variant="h5"
            sx={{
              fontWeight: 700,
              mb: 1
            }}>
            
              Adjustment submitted
            </Typography>
            <Typography
            variant="body2"
            sx={{
              color: '#64748B',
              mb: 3
            }}>
            
              Routed to Sam Rodriguez (Tax Director) for approval. You will be
              notified once reviewed.
            </Typography>
            <Stack direction="row" spacing={1.5} justifyContent="center">
              <Button variant="outlined" onClick={() => navigate('/invoicing')}>
                View invoice
              </Button>
              <Button
              variant="contained"
              onClick={() => navigate('/dashboard')}>
              
                Back to dashboard
              </Button>
            </Stack>
          </Box>
        }

        {step < 2 &&
        <>
            <Divider
            sx={{
              my: 3
            }} />
          
            <Stack direction="row" justifyContent="space-between">
              <Button
              onClick={() =>
              step === 0 ?
              navigate(`/entities/${e.id}`) :
              setStep((s) => s - 1)
              }>
              
                {step === 0 ? 'Cancel' : 'Back'}
              </Button>
              <Button
              variant="contained"
              disabled={submitting}
              onClick={async () => {
                if (step === 1) {
                  const result = await submit({
                    entityId: e.id,
                    entityName: e.name,
                    amount: Math.abs(adjustmentAmount),
                    currency: e.currency || 'USD',
                    mode,
                    targetMargin,
                    actualMargin: actual,
                    notes:
                      mode === 'custom'
                        ? `Custom target ${customMargin}%`
                        : undefined,
                    submittedBy: settings.defaultReviewer || 'You',
                  });
                  if (result) {
                    setSubmitted(true);
                    setStep(2);
                  }
                } else {
                  setStep((s) => s + 1);
                }
              }}>

                {submitting
                  ? 'Submitting…'
                  : step === 1
                  ? 'Submit for approval'
                  : 'Continue'}
              </Button>
            </Stack>
          </>
        }
      </Paper>

      <Snackbar
        open={submitted}
        autoHideDuration={4000}
        onClose={() => setSubmitted(false)}
        message="Adjustment submitted to Tax Director for approval" />
      
    </AppShell>);

}