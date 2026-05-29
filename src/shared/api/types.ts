/**
 * Response/request types for the FastAPI backend.
 * Keep in sync with `backend/main.py` (after layering: `backend/routers/`,
 * `backend/schemas/`).
 */

export interface KpiSummary {
  totalICVolume: number;
  entityCount: number;
  entitiesInRange: number;
  entitiesWatch: number;
  entitiesOutOfRange: number;
  /** Entities with no P&L data for the period (status 'no-data'). */
  entitiesNoData: number;
  openAdjustments: number;
  /** Distinct supply-chain chains under an APA. */
  flowsUnderAPA: number;
  /** Distinct supply-chain chains marked as challenged by a tax authority. */
  flowsChallenged: number;
}

export interface EntityFlow {
  direction: 'sell' | 'buy';
  materialType: string;
  materialLabel: string;
  tpMethod: string;
  ytdVolume: number;
  stepCount: number;
  chains: number;
  apa: boolean;
  challenged: boolean;
  counterparties: string[];
}

export interface BerryRow {
  year: number;
  period: string;
  month: string;
  revenue: number;
  gp: number;
  opex: number;
  berry: number | null;
  target: number;
}

export interface SegmentPnlRow {
  RBUKRS: string;
  ROLE_CODE: string;
  SEGMENT: string;
  GJAHR: number;
  POPER: string;
  revenue: number;
  other_income: number;
  cogs: number;
  opex_production: number;
  opex_rd: number;
  opex_sm: number;
  opex_ga: number;
  opex_dist: number;
  ic_charges: number;
  depreciation: number;
  operating_profit: number;
  operating_margin: number;
}

export interface JournalEntryRow {
  RBUKRS: string;
  GJAHR: number;
  POPER: string;
  BUDAT: string | null;
  BLART: string;
  BELNR: string;
  DOCLN: string;
  RACCT: string;
  RASSC: string;
  MATNR: string;
  WERKS: string;
  HSL: number;
  RHCUR: string;
  SGTXT: string;
}

export type AdjustmentStatus =
  | 'Pending Approval'
  | 'Approved'
  | 'Exported'
  | 'Rejected'
  | 'Reversed';

/** Submitted-adjustment record from the write store. */
export interface SubmittedAdjustment {
  id: string;
  entityId: string;
  entityName?: string;
  amount: number;
  currency: string;
  mode: 'median' | 'upper' | 'custom';
  targetMargin: number;
  actualMargin: number;
  notes?: string;
  submittedAt: string;
  submittedBy: string;
  status: AdjustmentStatus;

  // Lifecycle metadata (populated as the record moves through the workflow)
  approvedBy?: string;
  exportedRef?: string;
  rejectionReason?: string;
  updatedAt?: string;
  updatedBy?: string;

  // Reversal pair pointers
  reversesId?: string; // present on counter-adjustments — points back to original
  reversedById?: string; // present on originals after reversal — points to counter
  reversedAt?: string;
  reversedBy?: string;
}

/** Per-flow editable override (TP method, reviewer, notes). */
export interface PolicyOverride {
  flowId: string;
  tpMethod?: string;
  reviewer?: string;
  notes?: string;
  updatedAt: string;
  updatedBy?: string;
}

/** App-wide settings stored in the JSON write store. */
export interface AppSettings {
  companyName: string;
  defaultCurrency: string;
  defaultReviewer: string;
  notifyOnDeviation: boolean;
}
