/**
 * Ambient declarations for two MUI icons whose .d.ts files happen to be
 * missing from the published @mui/icons-material v5 tarball even though the
 * .js modules exist (Warning.js, WarningAmber.js).
 *
 * Without these, `tsc --noEmit` reports TS7016 even though the icons render
 * fine at runtime. Remove if a future @mui/icons-material release includes
 * the missing declarations.
 */
declare module '@mui/icons-material/Warning' {
  import type { OverridableComponent } from '@mui/material/OverridableComponent';
  import type { SvgIconTypeMap } from '@mui/material/SvgIcon';
  const Warning: OverridableComponent<SvgIconTypeMap<{}, 'svg'>>;
  export default Warning;
}

declare module '@mui/icons-material/WarningAmber' {
  import type { OverridableComponent } from '@mui/material/OverridableComponent';
  import type { SvgIconTypeMap } from '@mui/material/SvgIcon';
  const WarningAmber: OverridableComponent<SvgIconTypeMap<{}, 'svg'>>;
  export default WarningAmber;
}
