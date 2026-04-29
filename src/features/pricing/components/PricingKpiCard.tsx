import { Paper, Stack, Typography } from '@mui/material';

interface PricingKpiCardProps {
  label: string;
  value: string;
  delta: string;
  subtitle: string;
}

export default function PricingKpiCard({
  label,
  value,
  delta,
  subtitle,
}: PricingKpiCardProps) {
  return (
    <Paper sx={{ p: 2.5, height: '100%' }}>
      <Typography
        variant="caption"
        sx={{
          color: '#64748B',
          fontWeight: 600,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Typography>
      <Typography
        variant="caption"
        sx={{ display: 'block', color: '#94A3B8' }}
      >
        {subtitle}
      </Typography>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mt: 1 }}>
        <Typography variant="h4" sx={{ fontWeight: 800, color: '#0F172A' }}>
          {value}
        </Typography>
        <Typography
          variant="caption"
          sx={{ color: '#DC2626', fontWeight: 600 }}
        >
          ({delta})
        </Typography>
      </Stack>
      <Typography
        variant="caption"
        sx={{ color: '#94A3B8', display: 'block', mt: 0.5 }}
      >
        FY21 Total − FY21 Simulation
      </Typography>
    </Paper>
  );
}
