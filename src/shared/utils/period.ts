import type { PeriodKey, PeriodSelection } from '@/shared/types/period';

const PERIOD_PRESETS: Record<PeriodKey, { from: string; to: string; label: string }> = {
  q1: { from: '001', to: '003', label: 'Q1 (Jan–Mar)' },
  q2: { from: '004', to: '006', label: 'Q2 (Apr–Jun)' },
  q3: { from: '007', to: '009', label: 'Q3 (Jul–Sep)' },
  q4: { from: '010', to: '012', label: 'Q4 (Oct–Dec)' },
  fy: { from: '001', to: '012', label: 'Full Year' },
};

export function buildPeriod(key: PeriodKey, year: number): PeriodSelection {
  const p = PERIOD_PRESETS[key];
  return { key, year, periodFrom: p.from, periodTo: p.to };
}

export function periodLabel(key: PeriodKey): string {
  return PERIOD_PRESETS[key].label;
}
