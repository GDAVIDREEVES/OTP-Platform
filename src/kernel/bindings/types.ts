import type { FC } from 'react';
import type { ProcessDef } from '../registry/types';

export type KpiTone = 'ok' | 'watch' | 'risk' | 'neutral';

export interface KpiItem {
  key: string;
  label: string;
  value: string;
  tone?: KpiTone;
  hint?: string;
}

/** Context handed to every binding tab/KPI/action provider. */
export interface BindingCtx {
  def: ProcessDef;
}

export interface PrimaryAction {
  label: string;
  disabled?: boolean;
  hint?: string;
}

/** The standard tab set, in fixed order. 'audit' is shell-owned (every module
 *  gets identical, total audit affordances), so bindings can't supply it. */
export type TabKey =
  | 'overview'
  | 'worklist'
  | 'inputs'
  | 'calculation'
  | 'outputs'
  | 'audit'
  | 'docs';

export type BindableTab = Exclude<TabKey, 'audit'>;

/** Per-process wiring. Marquee processes provide rich tabs/KPIs/actions; the
 *  rest fall back to an informative binding (Overview + Docs). */
export interface ProcessBinding {
  kpis?: (ctx: BindingCtx) => KpiItem[];
  tabs?: Partial<Record<BindableTab, FC<BindingCtx>>>;
  primaryAction?: (ctx: BindingCtx) => PrimaryAction;
}
