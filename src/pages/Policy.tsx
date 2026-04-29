import React, { useState } from 'react';
import AppShell from '../components/layout/AppShell';
import {
  Paper,
  Typography,
  Box,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Stack,
  Button,
  IconButton,
  Drawer,
  TextField,
  MenuItem,
  Divider,
  FormControl,
  InputLabel,
  Select,
  Grid,
  Alert } from
'@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import PsychologyIcon from '@mui/icons-material/Psychology';
import { TransactionFlow } from '../components/data/transactions';
import { statusColor, statusLabel } from '../components/data/entities';
import { useFlows, useSavePolicyOverride, useSettings } from '../data/DataProvider';
import { formatCurrency } from '../components/theme';
import { useResearchBrain } from '../components/research-brain/ResearchBrainContext';
export default function Policy() {
  const [editing, setEditing] = useState<TransactionFlow | null>(null);
  const [draftMethod, setDraftMethod] = useState<string>('');
  const [draftReviewer, setDraftReviewer] = useState<string>('');
  const [draftNotes, setDraftNotes] = useState<string>('');
  const { openPanel } = useResearchBrain();
  const transactionFlows = useFlows();
  const settings = useSettings();
  const { save: savePolicy, pending: savingPolicy } = useSavePolicyOverride();

  // Reset drawer fields whenever the user opens a different row
  React.useEffect(() => {
    if (editing) {
      setDraftMethod(editing.tpMethod);
      setDraftReviewer(settings.defaultReviewer);
      setDraftNotes('');
    }
  }, [editing, settings.defaultReviewer]);
  return (
    <AppShell pageTitle="Policy Configuration">
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{
          mb: 2.5
        }}>
        
        <Box>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 700
            }}>
            
            Intercompany flows & pricing methods
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: '#64748B'
            }}>
            
            Define the arm's length range, method, and reviewers for each flow.
            Unassigned flows are flagged on the dashboard.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />}>
          New flow
        </Button>
      </Stack>

      <Paper
        sx={{
          p: 2.5
        }}>
        
        <Box
          sx={{
            overflowX: 'auto'
          }}>
          
          <Table
            size="small"
            sx={{
              minWidth: 900
            }}>
            
            <TableHead>
              <TableRow>
                <TableCell>Flow ID</TableCell>
                <TableCell>Transaction type</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Method</TableCell>
                <TableCell>PLI</TableCell>
                <TableCell align="right">YTD Volume</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {transactionFlows.map((t) =>
              <TableRow key={t.id} hover>
                  <TableCell
                  sx={{
                    fontWeight: 700
                  }}>
                  
                    {t.id}
                  </TableCell>
                  <TableCell>{t.type}</TableCell>
                  <TableCell
                  sx={{
                    color: '#475569',
                    maxWidth: 320
                  }}>
                  
                    {t.description}
                  </TableCell>
                  <TableCell>{t.tpMethod}</TableCell>
                  <TableCell>{t.pli}</TableCell>
                  <TableCell align="right">
                    {formatCurrency(t.ytdVolume, 'USD', true)}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip
                        label={statusLabel[t.status]}
                        size="small"
                        sx={{
                          bgcolor: `${statusColor[t.status]}18`,
                          color: statusColor[t.status],
                          fontWeight: 700
                        }} />
                      {t.apa && (
                        <Chip
                          label="APA"
                          size="small"
                          title="Covered by an Advance Pricing Agreement"
                          sx={{
                            bgcolor: '#EFF6FF',
                            color: '#1D4ED8',
                            fontWeight: 700,
                            border: '1px solid #BFDBFE'
                          }} />
                      )}
                      {t.challenged && (
                        <Chip
                          label="Challenged"
                          size="small"
                          title="Position challenged by a tax authority"
                          sx={{
                            bgcolor: '#FEF2F2',
                            color: '#B91C1C',
                            fontWeight: 700,
                            border: '1px solid #FECACA'
                          }} />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                    size="small"
                    onClick={() => setEditing(t)}
                    aria-label="Edit flow">
                    
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Paper>

      <Drawer
        anchor="right"
        open={!!editing}
        onClose={() => setEditing(null)}
        PaperProps={{
          sx: {
            width: {
              xs: '100%',
              sm: 480
            }
          }
        }}>
        
        {editing &&
        <Box
          sx={{
            p: 3
          }}>
          
            <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            sx={{
              mb: 2
            }}>
            
              <Typography
              variant="h6"
              sx={{
                fontWeight: 700
              }}>
              
                Edit flow {editing.id}
              </Typography>
              <IconButton onClick={() => setEditing(null)} aria-label="Close">
                <CloseIcon />
              </IconButton>
            </Stack>
            <Typography
            variant="body2"
            sx={{
              color: '#64748B',
              mb: 2
            }}>
            
              {editing.description}
            </Typography>
            <Alert
            severity="info"
            icon={<PsychologyIcon />}
            sx={{
              mb: 2.5
            }}
            action={
            <Button
              size="small"
              onClick={() =>
              openPanel({
                transactionType: editing.type,
                method: editing.tpMethod
              })
              }>
              
                  Ask
                </Button>
            }>
            
              Research Brain can suggest jurisdiction-specific benchmarks for
              this flow.
            </Alert>
            <Stack spacing={2}>
              <FormControl size="small" fullWidth>
                <InputLabel>Pricing method</InputLabel>
                <Select
                  value={draftMethod}
                  onChange={(ev) => setDraftMethod(ev.target.value as string)}
                  label="Pricing method">
                  {[
                'CUP',
                'TNMM',
                'Cost Plus',
                'Resale Price',
                'Profit Split',
                'CUT / CUP',
                'Berry Ratio'].
                map((m) =>
                <MenuItem key={m} value={m}>
                      {m}
                    </MenuItem>
                )}
                </Select>
              </FormControl>
              <TextField
              label="PLI / Metric"
              size="small"
              defaultValue={editing.pli}
              fullWidth />
            
              <Grid container spacing={1.5}>
                <Grid item xs={6}>
                  <TextField
                  label="Range lower bound"
                  size="small"
                  defaultValue="4"
                  InputProps={{
                    endAdornment: '%'
                  }}
                  fullWidth />
                
                </Grid>
                <Grid item xs={6}>
                  <TextField
                  label="Range upper bound"
                  size="small"
                  defaultValue="7"
                  InputProps={{
                    endAdornment: '%'
                  }}
                  fullWidth />
                
                </Grid>
              </Grid>
              <TextField
              label="Deviation threshold (pp)"
              size="small"
              defaultValue="2"
              fullWidth />
            
              <TextField
              label="Primary reviewer"
              size="small"
              value={draftReviewer}
              onChange={(ev) => setDraftReviewer(ev.target.value)}
              fullWidth />

              <TextField
              label="Approver"
              size="small"
              defaultValue="Sam Rodriguez — Tax Director"
              fullWidth />

              <TextField
              label="Notes"
              size="small"
              multiline
              rows={3}
              placeholder="Documentation source, benchmarking study ID, etc."
              value={draftNotes}
              onChange={(ev) => setDraftNotes(ev.target.value)}
              fullWidth />

            </Stack>
            <Divider
            sx={{
              my: 3
            }} />

            <Stack direction="row" spacing={1.5} justifyContent="flex-end">
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button
                variant="contained"
                disabled={savingPolicy}
                onClick={async () => {
                  if (!editing) return;
                  const result = await savePolicy(editing.id, {
                    tpMethod: draftMethod,
                    reviewer: draftReviewer,
                    notes: draftNotes,
                    updatedBy: settings.defaultReviewer,
                  });
                  if (result) setEditing(null);
                }}>
                {savingPolicy ? 'Saving…' : 'Save policy'}
              </Button>
            </Stack>
          </Box>
        }
      </Drawer>
    </AppShell>);

}