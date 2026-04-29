import {
  Alert,
  Box,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BerryRow } from '@/shared/api/types';
import type { Entity } from '@/shared/types/entity';
import type { AsyncResult } from '@/shared/hooks/useAsync';
import { formatCurrency } from '@/shared/utils/format';

interface MonthlyBerryChartProps {
  trend: AsyncResult<BerryRow[]>;
  entities: Entity[];
  entityId: string;
  setEntityId: (id: string) => void;
  currency: string;
  targetBerry: number;
}

export default function MonthlyBerryChart({
  trend,
  entities,
  entityId,
  setEntityId,
  currency,
  targetBerry,
}: MonthlyBerryChartProps) {
  return (
    <Paper sx={{ p: 2.5, height: '100%' }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-end"
        sx={{ mb: 1, flexWrap: 'wrap', gap: 1.5 }}
      >
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Monthly Berry-ratio analysis
          </Typography>
          <Typography variant="caption" sx={{ color: '#64748B' }}>
            Bar: revenue ({currency}). Lines: Berry ratio (left) vs. arm's-length target.
          </Typography>
        </Box>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="berry-entity-label">Entity</InputLabel>
          <Select
            labelId="berry-entity-label"
            label="Entity"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value as string)}
          >
            {entities.map((e) => (
              <MenuItem key={e.id} value={e.id}>
                {e.id} — {e.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {trend.loading ? (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <CircularProgress size={28} />
        </Box>
      ) : trend.error ? (
        <Alert severity="warning">{trend.error.message}</Alert>
      ) : (
        <Box sx={{ width: '100%', height: 360, mt: 1 }}>
          <ResponsiveContainer>
            <ComposedChart
              data={trend.data ?? []}
              margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 12, fill: '#64748B' }}
              />
              <YAxis
                yAxisId="left"
                tickFormatter={(v: number) => `${(v / 1_000_000).toFixed(1)}M`}
                tick={{ fontSize: 12, fill: '#64748B' }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 12, fill: '#64748B' }}
              />
              <Tooltip
                formatter={(value: number, name: string) => {
                  if (name === 'Revenue')
                    return formatCurrency(value, currency, true);
                  return value.toFixed(2);
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine
                yAxisId="right"
                y={targetBerry}
                stroke="#F59E0B"
                strokeDasharray="3 3"
              />
              <Bar
                yAxisId="left"
                dataKey="revenue"
                name="Revenue"
                fill="#5EEAD4"
                radius={[4, 4, 0, 0]}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="target"
                name="Target Berry"
                stroke="#F59E0B"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="berry"
                name="Actual Berry"
                stroke="#1E293B"
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Paper>
  );
}
