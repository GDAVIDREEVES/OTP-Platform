import type { ProcessDef } from '../registry/types';
import type { ProcessBinding } from './types';
import { informativeBinding } from './informative';

/** Rich per-process bindings, keyed by OTP id. Marquee processes are registered
 *  here in Phase 2; everything else falls back to the informative binding. */
const MARQUEE: Record<string, ProcessBinding> = {};

export function getBinding(def: ProcessDef): ProcessBinding {
  return MARQUEE[def.id] ?? informativeBinding();
}

export function isMarquee(id: string): boolean {
  return id in MARQUEE;
}
