import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1E293B', dark: '#0F172A', light: '#334155' },
    secondary: { main: '#2563EB', dark: '#1D4ED8', light: '#3B82F6' },
    success: { main: '#16A34A', light: '#DCFCE7', dark: '#15803D' },
    warning: { main: '#D97706', light: '#FEF3C7', dark: '#B45309' },
    error: { main: '#DC2626', light: '#FEE2E2', dark: '#B91C1C' },
    background: { default: '#F8FAFC', paper: '#FFFFFF' },
    text: { primary: '#0F172A', secondary: '#475569' },
    divider: '#E2E8F0'
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Inter", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontWeight: 700, letterSpacing: '-0.02em' },
    h3: { fontWeight: 700, letterSpacing: '-0.01em' },
    h4: { fontWeight: 700, letterSpacing: '-0.01em' },
    h5: { fontWeight: 700, letterSpacing: '-0.01em' },
    h6: { fontWeight: 700, letterSpacing: '-0.01em' },
    button: { textTransform: 'none', fontWeight: 600 }
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 8, boxShadow: 'none' },
        contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } }
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: '1px solid #E2E8F0',
          boxShadow: '0 1px 2px rgba(15,23,42,0.04)'
        }
      }
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 700,
          color: '#475569',
          backgroundColor: '#F8FAFC',
          fontSize: 12,
          letterSpacing: '0.04em',
          textTransform: 'uppercase'
        }
      }
    }
  }
});

export const formatCurrency = (
value: number,
currency = 'USD',
compact = false) =>
{
  if (compact) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(value);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(value);
};

export const formatNumber = (value: number) =>
new Intl.NumberFormat('en-US').format(value);