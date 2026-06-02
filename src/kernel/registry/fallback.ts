import type { ProcessCatalog } from './types';

/** Used only if GET /api/processes is unreachable. The live catalog carries
 *  all 50 processes; this keeps category labels available so the UI degrades
 *  gracefully rather than crashing. */
export const FALLBACK_CATALOG: ProcessCatalog = {
  categories: {
    A: 'Price Setting',
    B: 'Charge Calc & Invoicing',
    C: 'Adjustments & True-ups',
    D: 'Monitoring & Workpapers',
    E: 'Governance & Policy',
    F: 'Compliance & Reporting',
    G: 'Technology, Data & Controls',
  },
  processes: [],
};
