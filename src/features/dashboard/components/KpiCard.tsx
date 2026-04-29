import React from 'react';
import { Avatar, Paper, Stack, Typography } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';

interface KpiCardProps {
  label: string;
  value: string;
  subtitle: string;
  accent: 'primary' | 'success' | 'error' | 'warning';
  icon: React.ReactNode;
  trend?: string;
  onClick?: () => void;
}

const accentMap = {
  primary: { color: '#0F172A', bg: '#EFF6FF', iconColor: '#2563EB' },
  success: { color: '#16A34A', bg: '#DCFCE7', iconColor: '#16A34A' },
  error: { color: '#DC2626', bg: '#FEE2E2', iconColor: '#DC2626' },
  warning: { color: '#D97706', bg: '#FEF3C7', iconColor: '#D97706' },
};

export default function KpiCard({
  label,
  value,
  subtitle,
  accent,
  icon,
  trend,
  onClick,
}: KpiCardProps) {
  const a = accentMap[accent];
  return (
    <Paper
      onClick={onClick}
      sx={{
        p: 2.5,
        height: '100%',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s',
        '&:hover': onClick
          ? {
              borderColor: '#2563EB',
              boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
            }
          : {},
      }}
    >
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        sx={{ mb: 1.5 }}
      >
        <Typography
          variant="caption"
          sx={{
            color: '#64748B',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {label}
        </Typography>
        <Avatar sx={{ bgcolor: a.bg, color: a.iconColor, width: 36, height: 36 }}>
          {icon}
        </Avatar>
      </Stack>
      <Typography
        variant="h4"
        sx={{ fontWeight: 800, color: a.color, lineHeight: 1.1, mb: 0.5 }}
      >
        {value}
      </Typography>
      <Typography variant="body2" sx={{ color: '#475569', fontSize: 13 }}>
        {subtitle}
      </Typography>
      {trend && (
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 1 }}>
          <TrendingUpIcon sx={{ fontSize: 14, color: '#16A34A' }} />
          <Typography
            variant="caption"
            sx={{ color: '#16A34A', fontWeight: 700 }}
          >
            {trend}
          </Typography>
        </Stack>
      )}
    </Paper>
  );
}
