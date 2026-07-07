import type { FC } from 'react';
import type { ProcessDef } from '../registry/types';

export type KpiTone = 'ok' | 'watch' | 'risk' | 'neutral';

export interface KpiItem {
  key: string;
  label: string;
  value: string;
  tone?: KpiTone;
  hint?: string;
  /** Optional source lineage shown as a provenance chip under the value. */
  provenance?: string;
}

/** Context handed to every binding tab/KPI/action provider. */
export interface BindingCtx {
  def: ProcessDef;
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
  /** Answer-first KPI strip, as a component so it can read live data via hooks. */
  kpis?: FC<BindingCtx>;
  /**
   * Per-tab content. ONE convention governs the layout:
   *
   *   **Overview is always the primary working surface** — a guided wizard for
   *   wizard-archetype processes, a worklist/register for batch-monitor
   *   processes, or a grid/workpaper for calculation processes.
   *
   * The other tabs (inputs / calculation / outputs / docs) appear ONLY when
   * they carry distinct content; don't re-register Overview's component under
   * a second key just to fill the tab bar. The shell hides any tab a binding
   * doesn't wire (audit excepted — it is always shown), so an unwired tab
   * simply won't render.
   */
  tabs?: Partial<Record<BindableTab, FC<BindingCtx>>>;
}
