import { createTheme, type Theme } from '@mui/material/styles';

// Add the spec's "assist / brain" semantic color as a first-class palette slot
// (theme.palette.assist.main), alongside the existing primary/secondary/etc.
declare module '@mui/material/styles' {
  interface Palette {
    assist: Palette['primary'];
  }
  interface PaletteOptions {
    assist?: PaletteOptions['primary'];
  }
}

export type Density = 'comfortable' | 'compact';

// Spec semantic tokens. Color is meaning, not decoration; a user learns
// "amber = watch / action due" once and it holds across all 50 modules.
export const tokens = {
  action: '#1D4ED8', // primary action, selection
  ok: '#16A34A', // healthy / in range / posted
  watch: '#D97706', // watch / action due
  risk: '#DC2626', // breach / exception / overdue
  assist: '#7C3AED', // assistant / guidance (Research Brain, AI-sourced)
  ink: '#0F172A', // navigation surface, text
  canvas: '#F8FAFC', // working canvas
} as const;

// Apply to money / numeric cells so columns align on the decimal and scan
// correctly — a small choice that materially reduces reading errors in grids.
export const tabularNumsSx = { fontVariantNumeric: 'tabular-nums' } as const;

/**
 * Build the app theme. `comfortable` is visually identical to the prior theme
 * (dashboards, wizards, review); `compact` densifies table cells for the
 * workpaper grids where an analyst wants maximum rows on screen.
 */
export function createAppTheme(density: Density = 'comfortable'): Theme {
  const compact = density === 'compact';
  return createTheme({
    palette: {
      mode: 'light',
      primary: { main: '#1E293B', dark: '#0F172A', light: '#334155' },
      secondary: { main: '#2563EB', dark: '#1D4ED8', light: '#3B82F6' },
      success: { main: '#16A34A', light: '#DCFCE7', dark: '#15803D' },
      warning: { main: '#D97706', light: '#FEF3C7', dark: '#B45309' },
      error: { main: '#DC2626', light: '#FEE2E2', dark: '#B91C1C' },
      assist: { main: tokens.assist, light: '#EDE9FE', dark: '#6D28D9' },
      background: { default: '#F8FAFC', paper: '#FFFFFF' },
      text: { primary: '#0F172A', secondary: '#475569' },
      divider: '#E2E8F0',
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
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 8, boxShadow: 'none' },
          contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
          },
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiTableCell: {
        styleOverrides: {
          // compact mode densifies; comfortable keeps MUI defaults (== today).
          root: compact ? { padding: '4px 8px', fontSize: 12 } : {},
          head: {
            fontWeight: 700,
            color: '#475569',
            backgroundColor: '#F8FAFC',
            fontSize: 12,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            fontVariantNumeric: 'tabular-nums',
          },
          body: { fontVariantNumeric: 'tabular-nums' },
        },
      },
    },
  });
}

export const theme = createAppTheme('comfortable');
