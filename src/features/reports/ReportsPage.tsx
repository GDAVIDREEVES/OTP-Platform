import React from 'react';
import AppShell from '@/shared/components/layout/AppShell';
import {
  Paper,
  Typography,
  Grid,
  Stack,
  Button,
  Box,
  Chip,
  Avatar,
  Divider,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell } from
'@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import TableChartIcon from '@mui/icons-material/TableChart';
import CodeIcon from '@mui/icons-material/Code';
import HistoryIcon from '@mui/icons-material/History';
const reports = [
{
  id: 'r1',
  title: 'TP Policy Summary',
  desc: "Overview of all configured intercompany flows, methods, arm's length ranges, and reviewers.",
  updated: 'Dec 10, 2025'
},
{
  id: 'r2',
  title: 'Deviation Log',
  desc: 'Complete history of deviations, resolutions, and time-to-remediation across all entities.',
  updated: 'Dec 10, 2025'
},
{
  id: 'r3',
  title: 'Segmented P&L',
  desc: 'Revenue, costs, and operating profit by entity, jurisdiction, and business line.',
  updated: 'Dec 10, 2025'
},
{
  id: 'r4',
  title: 'Royalty Reconciliation',
  desc: 'Calculated vs. invoiced royalty fees with benchmark comparison and WHT notes.',
  updated: 'Dec 09, 2025'
},
{
  id: 'r5',
  title: 'Adjustment History',
  desc: 'All year-end true-ups and compensating adjustments with approval trail.',
  updated: 'Dec 10, 2025'
},
{
  id: 'r6',
  title: 'Audit-Ready Data Package',
  desc: "Export bundle for handoff to the firm's compliance documentation teams (local file / master file).",
  updated: 'Dec 10, 2025'
}];

const auditEvents = [
{
  ts: 'Dec 10, 2025 — 09:14 AM',
  user: 'System',
  action: 'Deviation alert generated for IE-002 (OM 29% vs target 4%)'
},
{
  ts: 'Dec 10, 2025 — 09:22 AM',
  user: 'Maria Chen',
  action: 'Initiated year-end adjustment for IE-002 ($286,764,240)'
},
{
  ts: 'Dec 10, 2025 — 09:45 AM',
  user: 'Sam Rodriguez',
  action: 'Approved draft adjustment invoice INV-2025-1042'
},
{
  ts: 'Dec 09, 2025 — 03:47 PM',
  user: 'System',
  action: 'Deviation alert generated for MX-002 (approaching lower bound)'
},
{
  ts: 'Dec 08, 2025 — 11:22 AM',
  user: 'System',
  action: 'Deviation alert generated for CA-001'
},
{
  ts: 'Dec 07, 2025 — 02:10 PM',
  user: 'Maria Chen',
  action:
  'Updated TP policy TXN-005 — cost plus markup adjusted from 6% → 7%'
}];

export default function Reports() {
  return (
    <AppShell pageTitle="Reports & Audit Trail">
      <Typography
        variant="h5"
        sx={{
          fontWeight: 700,
          mb: 0.5
        }}>
        
        Report Library
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: '#64748B',
          mb: 3
        }}>
        
        Pre-built, audit-ready reports. Export to Excel, PDF, or structured JSON
        for handoff to compliance workflows.
      </Typography>

      <Grid container spacing={2}>
        {reports.map((r) =>
        <Grid item xs={12} sm={6} md={4} key={r.id}>
            <Paper
            sx={{
              p: 2.5,
              height: '100%',
              display: 'flex',
              flexDirection: 'column'
            }}>
            
              <Stack
              direction="row"
              alignItems="flex-start"
              spacing={1.5}
              sx={{
                mb: 1.5
              }}>
              
                <Avatar
                sx={{
                  bgcolor: '#EFF6FF',
                  color: '#2563EB'
                }}>
                
                  <DescriptionIcon />
                </Avatar>
                <Box
                sx={{
                  flex: 1
                }}>
                
                  <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 700,
                    lineHeight: 1.25
                  }}>
                  
                    {r.title}
                  </Typography>
                  <Typography
                  variant="caption"
                  sx={{
                    color: '#94A3B8'
                  }}>
                  
                    Updated {r.updated}
                  </Typography>
                </Box>
              </Stack>
              <Typography
              variant="body2"
              sx={{
                color: '#475569',
                flex: 1,
                mb: 2
              }}>
              
                {r.desc}
              </Typography>
              <Stack direction="row" spacing={0.75}>
                <Button
                size="small"
                variant="outlined"
                startIcon={<TableChartIcon />}>
                
                  Excel
                </Button>
                <Button
                size="small"
                variant="outlined"
                startIcon={<PictureAsPdfIcon />}>
                
                  PDF
                </Button>
                <Button
                size="small"
                variant="outlined"
                startIcon={<CodeIcon />}>
                
                  JSON
                </Button>
              </Stack>
            </Paper>
          </Grid>
        )}
      </Grid>

      <Paper
        sx={{
          p: 2.5,
          mt: 3
        }}>
        
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.5}
          sx={{
            mb: 2
          }}>
          
          <HistoryIcon
            sx={{
              color: '#2563EB'
            }} />
          
          <Box
            sx={{
              flex: 1
            }}>
            
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700
              }}>
              
              Audit Trail
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: '#64748B'
              }}>
              
              Immutable log of every price-setting decision, policy change,
              adjustment, approval, and invoice.
            </Typography>
          </Box>
          <Button size="small" variant="outlined">
            Export full trail
          </Button>
        </Stack>
        <Divider
          sx={{
            mb: 1.5
          }} />
        
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell
                sx={{
                  width: 220
                }}>
                
                Timestamp
              </TableCell>
              <TableCell
                sx={{
                  width: 160
                }}>
                
                User
              </TableCell>
              <TableCell>Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {auditEvents.map((e, i) =>
            <TableRow key={i} hover>
                <TableCell
                sx={{
                  color: '#64748B'
                }}>
                
                  {e.ts}
                </TableCell>
                <TableCell>
                  <Chip
                  size="small"
                  label={e.user}
                  sx={{
                    bgcolor: e.user === 'System' ? '#F1F5F9' : '#EFF6FF',
                    color: e.user === 'System' ? '#475569' : '#1D4ED8',
                    fontWeight: 600
                  }} />
                
                </TableCell>
                <TableCell>{e.action}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </AppShell>);

}