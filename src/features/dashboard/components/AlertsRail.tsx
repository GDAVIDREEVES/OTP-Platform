import {
  Box,
  Button,
  Chip,
  IconButton,
  Link as MuiLink,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ErrorIcon from '@mui/icons-material/Error';
import PsychologyIcon from '@mui/icons-material/Psychology';
import WarningIcon from '@mui/icons-material/Warning';
import { useNavigate } from 'react-router-dom';
import { adjustmentRoute } from '@/kernel/workflow/originRoute';
import type { Entity } from '@/shared/types/entity';
import { useResearchBrain } from '@/features/research-brain/ResearchBrainContext';

export interface DashboardAlert {
  id: string;
  entityId: string;
  severity: 'HIGH' | 'MEDIUM';
  title: string;
  body: string;
  timestamp: string;
  primaryAction: string;
}

/** Build live alerts from the entities array — surface the 3 worst variance offenders. */
export function buildAlerts(entities: Entity[]): DashboardAlert[] {
  const candidates = entities
    .filter((e) => e.status !== 'in-range' && e.variance != null)
    .slice()
    .sort((a, b) => Math.abs(b.variance ?? 0) - Math.abs(a.variance ?? 0));
  return candidates.slice(0, 3).map((e, i) => {
    const v = e.variance ?? 0;
    const direction = v > 0 ? 'over' : 'below';
    const sign = v > 0 ? '+' : '';
    return {
      id: `a${i + 1}`,
      entityId: e.id,
      severity: e.status === 'out-of-range' ? 'HIGH' : 'MEDIUM',
      title: `${e.id} ${
        direction === 'over'
          ? 'Operating Margin Overshoot'
          : 'Below Lower Threshold'
      }`,
      body:
        `${e.name} YTD operating margin is ${e.actualMargin?.toFixed(1)}%, ` +
        `${direction} the ${e.targetMarginLabel} ${e.tpMethod} target by ${sign}${v.toFixed(
          1,
        )}pp. ` +
        (e.status === 'out-of-range'
          ? 'Year-end true-up recommended.'
          : 'Monitor closely.'),
      timestamp: e.lastUpdated ?? '',
      primaryAction: e.status === 'out-of-range' ? 'Run Adjustment' : 'Review',
    };
  });
}

interface AlertsRailProps {
  alerts: DashboardAlert[];
  entities: Entity[];
}

export default function AlertsRail({ alerts, entities }: AlertsRailProps) {
  const navigate = useNavigate();
  const { openPanel } = useResearchBrain();
  const askBrainForAlert = (a: DashboardAlert) => {
    const entity = entities.find((e) => e.id === a.entityId);
    openPanel({
      entityId: a.entityId,
      entityName: entity?.name,
      jurisdiction: entity?.country,
      function: entity?.function,
      transactionType: 'Tangible Goods',
      method: entity?.tpMethod,
    });
  };
  return (
    <Paper sx={{ p: 2.5, position: { lg: 'sticky' }, top: 84 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Active Alerts ({alerts.length})
          </Typography>
          <Typography variant="caption" sx={{ color: '#64748B' }}>
            Real-time deviation feed
          </Typography>
        </Box>
        <MuiLink
          component="button"
          underline="hover"
          sx={{ fontSize: 12, fontWeight: 600 }}
        >
          Mark all read
        </MuiLink>
      </Stack>
      <Stack spacing={1.5}>
        {alerts.map((a) => {
          const isHigh = a.severity === 'HIGH';
          const accent = isHigh ? '#DC2626' : '#D97706';
          const accentBg = isHigh ? '#FEE2E2' : '#FEF3C7';
          return (
            <Paper
              key={a.id}
              variant="outlined"
              sx={{ p: 1.75, borderLeft: `4px solid ${accent}` }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="flex-start"
                sx={{ mb: 0.75 }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  {isHigh ? (
                    <ErrorIcon sx={{ color: accent, fontSize: 18 }} />
                  ) : (
                    <WarningIcon sx={{ color: accent, fontSize: 18 }} />
                  )}
                  <Chip
                    label={a.severity}
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: 10,
                      bgcolor: accentBg,
                      color: accent,
                      fontWeight: 800,
                    }}
                  />
                </Stack>
                <IconButton size="small" aria-label="Dismiss">
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Stack>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, mb: 0.5, lineHeight: 1.3 }}
              >
                {a.title}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: '#475569',
                  fontSize: 13,
                  lineHeight: 1.5,
                  mb: 1,
                }}
              >
                {a.body}
              </Typography>
              <Typography
                variant="caption"
                sx={{ color: '#94A3B8', display: 'block', mb: 1.25 }}
              >
                {a.timestamp}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="contained"
                  color={isHigh ? 'error' : 'warning'}
                  onClick={() => navigate(adjustmentRoute(a.entityId))}
                  sx={{ color: 'white' }}
                >
                  {a.primaryAction}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<PsychologyIcon />}
                  onClick={() => askBrainForAlert(a)}
                >
                  Ask Research Brain
                </Button>
              </Stack>
            </Paper>
          );
        })}
      </Stack>
    </Paper>
  );
}
