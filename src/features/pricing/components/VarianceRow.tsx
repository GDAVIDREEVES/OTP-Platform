import { Box, Chip, Grid, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { countryVariance, productVariance } from './mockData';

export default function VarianceRow() {
  return (
    <Grid container spacing={2} sx={{ mb: 2.5 }}>
      <Grid item xs={12} md={4}>
        <Paper sx={{ p: 2.5, height: '100%' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Operating Margin variance by Entity
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: '#64748B', display: 'block', mb: 1 }}
          >
            FY21 Total vs FY21 Simulation
          </Typography>
          <Box sx={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={countryVariance}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis
                  dataKey="country"
                  tick={{ fontSize: 10, fill: '#64748B' }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  domain={[0.9, 1.5]}
                  tick={{ fontSize: 11, fill: '#64748B' }}
                />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="actual"
                  name="FY21 Total"
                  fill="#0D9488"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="simulation"
                  name="FY21 Simulation"
                  fill="#99F6E4"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      </Grid>
      <Grid item xs={12} md={4}>
        <Paper sx={{ p: 2.5, height: '100%' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Operating Margin variance by Product
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: '#64748B', display: 'block', mb: 1 }}
          >
            FY21 Total vs Simulation
          </Typography>
          <Box sx={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <BarChart
                data={productVariance}
                layout="vertical"
                margin={{ left: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis
                  type="number"
                  domain={[0.9, 1.5]}
                  tick={{ fontSize: 11, fill: '#64748B' }}
                />
                <YAxis
                  type="category"
                  dataKey="product"
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  width={75}
                />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="actual" name="FY21 Total" fill="#0D9488" />
                <Bar
                  dataKey="simulation"
                  name="FY21 Simulation"
                  fill="#99F6E4"
                />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      </Grid>
      <Grid item xs={12} md={4}>
        <Paper sx={{ p: 2.5, height: '100%' }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="flex-start"
          >
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Pricing health summary
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748B' }}>
                Overall Operating Margin vs target
              </Typography>
            </Box>
            <Chip
              icon={<TrendingUpIcon />}
              label="On track"
              size="small"
              sx={{
                bgcolor: '#DCFCE7',
                color: '#16A34A',
                fontWeight: 700,
                '& .MuiChip-icon': { color: '#16A34A' },
              }}
            />
          </Stack>
          <Stack spacing={2.5} sx={{ mt: 2.5 }}>
            <Box>
              <Stack
                direction="row"
                justifyContent="space-between"
                sx={{ mb: 0.5 }}
              >
                <Typography variant="caption" sx={{ color: '#64748B' }}>
                  Products in target range
                </Typography>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  18 / 25
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={72}
                sx={{
                  height: 8,
                  borderRadius: 4,
                  bgcolor: '#F1F5F9',
                  '& .MuiLinearProgress-bar': { bgcolor: '#16A34A' },
                }}
              />
            </Box>
            <Box>
              <Stack
                direction="row"
                justifyContent="space-between"
                sx={{ mb: 0.5 }}
              >
                <Typography variant="caption" sx={{ color: '#64748B' }}>
                  Markup adjustments proposed
                </Typography>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  12
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={48}
                sx={{
                  height: 8,
                  borderRadius: 4,
                  bgcolor: '#F1F5F9',
                  '& .MuiLinearProgress-bar': { bgcolor: '#2563EB' },
                }}
              />
            </Box>
            <Box>
              <Stack
                direction="row"
                justifyContent="space-between"
                sx={{ mb: 0.5 }}
              >
                <Typography variant="caption" sx={{ color: '#64748B' }}>
                  Products breaching range
                </Typography>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  3
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={12}
                sx={{
                  height: 8,
                  borderRadius: 4,
                  bgcolor: '#F1F5F9',
                  '& .MuiLinearProgress-bar': { bgcolor: '#DC2626' },
                }}
              />
            </Box>
          </Stack>
          <Box
            sx={{
              mt: 2.5,
              p: 1.5,
              bgcolor: '#F8FAFC',
              borderRadius: 1.5,
              border: '1px solid #E2E8F0',
            }}
          >
            <Typography
              variant="caption"
              sx={{ color: '#64748B', fontWeight: 600 }}
            >
              Average markup shift
            </Typography>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <TrendingUpIcon sx={{ fontSize: 18, color: '#16A34A' }} />
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                +4.2 pts
              </Typography>
            </Stack>
          </Box>
        </Paper>
      </Grid>
    </Grid>
  );
}
