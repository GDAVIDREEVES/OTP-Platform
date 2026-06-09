/**
 * Resolve a `record_ref` to the process route that originated / owns it.
 *
 * This mirrors the `record_ref → subject` prefix conventions in
 * `backend/routers/evidence.py:_resolve_entity` and the refs the marquee
 * bindings actually construct (e.g. `OTP3-royalty-API`, `OTP5-csa-rab-pct`,
 * `adj:{id}` / `OTP16-{entity}`, `case:{id}`, `param:{key}`). It gives the
 * lineage UI a "Fix & resubmit" / "jump to origin" deep-link from any ref.
 *
 * Returns `null` for an unknown ref so callers can hide the link rather than
 * route somewhere wrong.
 */

const overview = (otp: string) => `/process/${otp}/overview`;

export function originRoute(recordRef: string): string | null {
  if (!recordRef) return null;

  // Adjustments (OTP-16): both the persisted `adj:{id}` and the in-flight
  // `OTP16-{entity}` working ref resolve to the adjustment process.
  if (recordRef.startsWith('adj:') || recordRef.startsWith('OTP16-')) {
    return overview('OTP-16');
  }

  // Price-setting / rate-setting wizard refs (e.g. `OTP3-royalty-API`).
  if (recordRef.startsWith('OTP3-')) return overview('OTP-3');
  if (recordRef.startsWith('OTP5-')) return overview('OTP-5');
  if (recordRef.startsWith('OTP6-')) return overview('OTP-6');
  if (recordRef.startsWith('OTP25-')) return overview('OTP-25');
  if (recordRef.startsWith('OTP44-')) return overview('OTP-44');

  // Governance cases land on the Case Workspace worklist (OTP-40).
  if (recordRef.startsWith('case:')) return '/process/OTP-40/worklist';

  // Governed parameters → the management console (OTP-49, Phase 2).
  if (recordRef.startsWith('param:')) return overview('OTP-49');

  return null;
}
