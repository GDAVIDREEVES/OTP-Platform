/** Quarterly preset used by the AppShell period select. */
export type PeriodKey = 'q1' | 'q2' | 'q3' | 'q4' | 'fy';

export interface PeriodSelection {
  key: PeriodKey;
  year: number;
  periodFrom: string;
  periodTo: string;
}

/** Period filter shared across most read endpoints. */
export interface PeriodParams {
  year?: number;
  periodFrom?: string; // '001'..'012'
  periodTo?: string;
}
