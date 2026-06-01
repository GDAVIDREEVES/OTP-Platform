import type { ProcessDef } from '../registry/types';
import type { ProcessBinding } from './types';
import { informativeBinding } from './informative';
import { otp20 } from './marquee/otp20';
import { otp16 } from './marquee/otp16';

/** Rich per-process bindings, keyed by OTP id. Marquee processes are registered
 *  here in Phase 2; everything else falls back to the informative binding. */
const MARQUEE: Record<string, ProcessBinding> = {
  'OTP-20': otp20,
  'OTP-16': otp16,
  'OTP-17': otp16, // FYE adjustment shares the in-period flow
};

export function getBinding(def: ProcessDef): ProcessBinding {
  return MARQUEE[def.id] ?? informativeBinding();
}

export function isMarquee(id: string): boolean {
  return id in MARQUEE;
}
