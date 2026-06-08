import type { ProcessDef } from '../registry/types';
import type { ProcessBinding } from './types';
import { informativeBinding } from './informative';
import { otp1 } from './marquee/otp1';
import { otp4 } from './marquee/otp4';
import { otp20 } from './marquee/otp20';
import { otp16 } from './marquee/otp16';
import { otp9 } from './marquee/otp9';
import { otp10 } from './marquee/otp10';
import { otp3 } from './marquee/otp3';
import { otp5 } from './marquee/otp5';
import { otp11 } from './marquee/otp11';
import { otp21 } from './marquee/otp21';
import { otp25 } from './marquee/otp25';
import { otp29 } from './marquee/otp29';
import { otp34 } from './marquee/otp34';
import { otp35 } from './marquee/otp35';
import { otp45 } from './marquee/otp45';
import { otp27 } from './marquee/otp27';
import { otp41 } from './marquee/otp41';
import { caseWorkspace } from './marquee/caseWorkspace';

/** Rich per-process bindings, keyed by OTP id. Marquee processes are registered
 *  here in Phase 2; everything else falls back to the informative binding. */
const MARQUEE: Record<string, ProcessBinding> = {
  'OTP-1': otp1, // goods BOY price-setting (cost-plus / resale markups vs BM-TOLL/BM-LRD)
  'OTP-2': otp1, // in-period goods price reset — reuses the OTP-1 binding (like OTP-16→16/17)
  'OTP-4': otp4, // service cost-plus markup setting (vs BM-SVC)
  'OTP-3': otp3, // royalty rate setting
  'OTP-5': otp5, // CSA RAB share + PCT setting (wizard)
  'OTP-9': otp9, // royalty charge & invoice batch
  'OTP-10': otp10, // service cost-allocation charge & invoice batch
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
  'OTP-39': caseWorkspace, // APA filing support & annual reporting (lifecycle tracker)
  'OTP-40': caseWorkspace, // TP audit defense & IDR
  'OTP-50': caseWorkspace, // MAP filing & negotiation
  'OTP-27': otp27, // new IC flow onboarding (guided wizard over unplanned-flow detection)
  'OTP-41': otp41, // ERP master-data maintenance (guided wizard over the inbound SAP delta)
  'OTP-25': otp25, // benchmarking studies
  'OTP-29': otp29, // DEMPE functional analysis
  'OTP-34': otp34, // CbCR data extraction & validation (BEPS-13 Table 1)
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
