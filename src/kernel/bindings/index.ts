import type { ProcessDef } from '../registry/types';
import type { ProcessBinding } from './types';
import { informativeBinding } from './informative';
import { otp20 } from './marquee/otp20';
import { otp16 } from './marquee/otp16';
import { otp9 } from './marquee/otp9';
import { otp3 } from './marquee/otp3';
import { otp5 } from './marquee/otp5';
import { otp11 } from './marquee/otp11';
import { otp21 } from './marquee/otp21';
import { otp25 } from './marquee/otp25';
import { otp29 } from './marquee/otp29';
import { otp35 } from './marquee/otp35';
import { otp45 } from './marquee/otp45';
import { caseWorkspace } from './marquee/caseWorkspace';

/** Rich per-process bindings, keyed by OTP id. Marquee processes are registered
 *  here in Phase 2; everything else falls back to the informative binding. */
const MARQUEE: Record<string, ProcessBinding> = {
  'OTP-3': otp3, // royalty rate setting
  'OTP-5': otp5, // CSA RAB share + PCT setting (wizard)
  'OTP-9': otp9, // royalty charge & invoice batch
  'OTP-11': otp11, // CSA in-period true-up (batch)
  'OTP-16': otp16, // in-period adjustment (guided)
  'OTP-17': otp16, // FYE adjustment shares the in-period flow
  'OTP-20': otp20, // operating-margin monitoring
  'OTP-21': otp21, // segmented financials — throughout FY
  'OTP-22': otp21, // segmented financials — FYE (same grid)
  'OTP-23': otp21, // segmented financials — statutory YE (same grid)
  // Case Workspace — one shared governance-case tracker (status/checklist/audit)
  'OTP-30': caseWorkspace, // restructuring / exit charges
  'OTP-31': caseWorkspace, // M&A IC-flow integration
  'OTP-40': caseWorkspace, // TP audit defense & IDR
  'OTP-50': caseWorkspace, // MAP filing & negotiation
  'OTP-25': otp25, // benchmarking studies
  'OTP-29': otp29, // DEMPE functional analysis
  'OTP-35': otp35, // Pillar Two / GloBE
  'OTP-45': otp45, // UTP reserve
  'OTP-48': otp45, // provision interaction (same reserve data, provision framing)
};

export function getBinding(def: ProcessDef): ProcessBinding {
  return MARQUEE[def.id] ?? informativeBinding();
}

export function isMarquee(id: string): boolean {
  return id in MARQUEE;
}
