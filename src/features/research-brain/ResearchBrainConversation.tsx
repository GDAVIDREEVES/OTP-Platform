import React from 'react';
import {
  Box,
  Typography,
  Stack,
  Chip,
  Button,
  LinearProgress,
  Paper } from
'@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReplyIcon from '@mui/icons-material/Reply';

/** What a response's action button does. The host (full page or side panel)
 *  decides how: `run-adjustment` opens OTP-16 for the entity, `export`
 *  downloads the thread as an evidence note, `follow-up` focuses the ask box. */
export type ConversationAction = 'run-adjustment' | 'export' | 'follow-up';
function UserBubble({ text }: {text: string;}) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'flex-end',
        mb: 2
      }}>
      
      <Box
        sx={{
          maxWidth: '85%',
          bgcolor: '#2563EB',
          color: 'white',
          px: 2,
          py: 1.25,
          borderRadius: '12px 12px 2px 12px'
        }}>
        
        <Typography
          variant="body2"
          sx={{
            lineHeight: 1.5
          }}>
          
          {text}
        </Typography>
      </Box>
    </Box>);

}
interface RBMessageProps {
  summary: string;
  detail: string;
  rangeNote?: {
    label: string;
    text: string;
  };
  citations: string[];
  confidence: number;
  actions?: {
    label: string;
    icon?: React.ReactNode;
    action: ConversationAction;
  }[];
  onAction?: (action: ConversationAction) => void;
}
function BrainResponse({
  summary,
  detail,
  rangeNote,
  citations,
  confidence,
  actions,
  onAction
}: RBMessageProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        mb: 2
      }}>
      
      <Paper
        elevation={0}
        sx={{
          maxWidth: '95%',
          border: '1px solid #E2E8F0',
          borderRadius: '12px 12px 12px 2px',
          p: 2
        }}>
        
        <Typography
          variant="body2"
          sx={{
            fontWeight: 700,
            color: '#0F172A',
            mb: 1
          }}>
          
          Summary
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: '#0F172A',
            mb: 1.5,
            lineHeight: 1.55
          }}>
          
          {summary}
        </Typography>

        <Typography
          variant="body2"
          sx={{
            fontWeight: 700,
            color: '#0F172A',
            mb: 0.5
          }}>
          
          Detail
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: '#334155',
            mb: 1.5,
            lineHeight: 1.55
          }}>
          
          {detail}
        </Typography>

        {rangeNote &&
        <Box
          sx={{
            bgcolor: '#F1F5F9',
            border: '1px solid #E2E8F0',
            borderRadius: 1.5,
            p: 1.5,
            mb: 1.5
          }}>
          
            <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              color: '#0F172A',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}>
            
              {rangeNote.label}
            </Typography>
            <Typography
            variant="body2"
            sx={{
              color: '#334155',
              mt: 0.5,
              lineHeight: 1.5
            }}>
            
              {rangeNote.text}
            </Typography>
          </Box>
        }

        <Stack
          direction="row"
          spacing={0.75}
          flexWrap="wrap"
          useFlexGap
          sx={{
            mb: 1.5
          }}>
          
          {citations.map((c) =>
          <Chip
            key={c}
            label={c}
            size="small"
            sx={{
              bgcolor: '#EFF6FF',
              color: '#1D4ED8',
              fontSize: 11,
              fontWeight: 600,
              mb: 0.5
            }} />

          )}
        </Stack>

        <Box
          sx={{
            mb: 1.5
          }}>
          
          <Stack
            direction="row"
            justifyContent="space-between"
            sx={{
              mb: 0.5
            }}>
            
            <Typography
              variant="caption"
              sx={{
                color: '#475569',
                fontWeight: 600
              }}>
              
              Confidence
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: '#16A34A',
                fontWeight: 700
              }}>
              
              High ({confidence}%)
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={confidence}
            sx={{
              height: 6,
              borderRadius: 3,
              bgcolor: '#DCFCE7',
              '& .MuiLinearProgress-bar': {
                bgcolor: '#16A34A'
              }
            }} />
          
        </Box>

        {actions &&
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {actions.map((a, i) =>
          <Button
            key={i}
            size="small"
            variant={i === 0 ? 'contained' : 'outlined'}
            startIcon={a.icon}
            onClick={() => onAction?.(a.action)}
            sx={{
              fontSize: 12
            }}>
            
                {a.label}
              </Button>
          )}
          </Stack>
        }
      </Paper>
    </Box>);

}
export default function ResearchBrainConversation({
  onAction
}: {onAction?: (action: ConversationAction) => void;}) {
  return (
    <Box>
      <UserBubble text="Does the IE-002 operating margin overshoot of 29% vs. our 4% TNMM target require a mandatory year-end compensating adjustment under Irish transfer pricing rules?" />

      <BrainResponse
        summary="Yes — Irish transfer pricing legislation requires a compensating adjustment where actual results exceed the arm's length range established in the taxpayer's TP policy."
        detail="Under Irish Tax Consolidation Act 1997, Part 35A (as amended by Finance Act 2022), the arm's length principle applies to all controlled transactions. Where actual results are outside the agreed arm's length range, the Revenue Commissioners expect a year-end true-up adjustment reflected in the entity's accounts and supported by contemporaneous documentation."
        rangeNote={{
          label: "Arm's Length Range Note",
          text: 'For TNMM-tested distributors in Ireland, the typical operating margin IQR based on current benchmarking is 2.1%–6.8%. IE-002 at 29% is significantly above the upper quartile. The TP adjustment to bring IE-002 to the median (4%) implies an upward intercompany charge of approximately $286.8M.'
        }}
        citations={[
        'Firm TP Handbook — Ireland §7.2',
        'Irish TCA 1997, Part 35A',
        'OECD TP Guidelines 2022, Ch. I',
        'Firm EMEA TP Precedent — FY2023']
        }
        confidence={94}
        onAction={onAction}
        actions={[
        {
          label: 'Run Adjustment',
          icon: <PlayArrowIcon />,
          action: 'run-adjustment'
        },
        {
          label: 'Export to Audit File',
          icon: <FileDownloadIcon />,
          action: 'export'
        },
        {
          label: 'Ask Follow-Up',
          icon: <ReplyIcon />,
          action: 'follow-up'
        }]
        } />
      

      <UserBubble text="What is the deadline for filing the Irish transfer pricing disclosure and does the adjustment need to be reflected in the statutory accounts?" />

      <BrainResponse
        summary="The Irish TP disclosure (Form CT1 supplementary schedule) is due with the corporation tax return, typically 9 months after fiscal year-end. Compensating adjustments should be reflected in the statutory accounts for the period in which the controlled transaction occurs."
        detail="For calendar-year filers with a December 31, 2025 year-end, the CT1 return including the TP supplementary schedule is due by September 23, 2026 (Revenue Online Service deadline). The IE-002 compensating adjustment should be booked in the FY2025 statutory accounts as an accrued intercompany payable/receivable, and reflected in the Schedule D Case I trading computation. Supporting contemporaneous documentation (local file) must be available within 30 days of Revenue request."
        citations={[
        'Irish Revenue TP Guidance — October 2023',
        'Firm Ireland Country Brief — 2025',
        'Finance Act 2022 §27']
        }
        confidence={96}
        onAction={onAction}
        actions={[
        {
          label: 'Export to Audit File',
          icon: <FileDownloadIcon />,
          action: 'export'
        },
        {
          label: 'Ask Follow-Up',
          icon: <ReplyIcon />,
          action: 'follow-up'
        }]
        } />
      
    </Box>);

}