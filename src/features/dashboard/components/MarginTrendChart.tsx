import { Box, Paper, Stack, Typography } from '@mui/material';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MonthlyMarginRow } from '@/shared/types/transaction';

interface MarginTrendChartProps {
  data: MonthlyMarginRow[];
}

export default function MarginTrendChart({ data }: MarginTrendChartProps) {
  return (
    <Paper sx={{ p: 2.5 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Entity Operating Margin Trends
          </Typography>
          <Typography variant="caption" sx={{ color: '#64748B' }}>
            FY2025 — Jan through Dec
          </Typography>
        </Box>
      </Stack>
      <Box sx={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          <LineChart
            data={data}
            margin={{ top: 10, right: 24, left: 0, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="month" stroke="#64748B" fontSize={12} />
            <YAxis
              stroke="#64748B"
              fontSize={12}
              domain={[0, 35]}
              tickFormatter={(v) => `${v}%`}
            />
            <ReTooltip formatter={(v: any) => `${v}%`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine
              y={4}
              stroke="#16A34A"
              strokeDasharray="4 4"
              label={{
                value: 'Target Floor (4%)',
                position: 'insideLeft',
                fontSize: 11,
                fill: '#16A34A',
              }}
            />
            <ReferenceLine
              y={7}
              stroke="#2563EB"
              strokeDasharray="4 4"
              label={{
                value: 'Target Ceiling (7%)',
                position: 'insideLeft',
                fontSize: 11,
                fill: '#2563EB',
              }}
            />
            <Line
              type="monotone"
              dataKey="IE-002"
              stroke="#DC2626"
              strokeWidth={2.5}
              dot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="UK-001"
              stroke="#F97316"
              strokeWidth={2.5}
              dot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="MX-002"
              stroke="#D97706"
              strokeWidth={2.5}
              dot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="US-003"
              stroke="#16A34A"
              strokeWidth={2.5}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
}
