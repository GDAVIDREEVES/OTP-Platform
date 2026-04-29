/**
 * Transaction types.
 *
 * Mock data has been removed — all runtime data now comes from the FastAPI
 * backend via `useFlows()` / `useInvoices()` / `useRoyalties()` /
 * `useMarginTrend()` (see `src/data`).
 *
 * Backend contract: `backend/main.py` (list_flows, list_royalties,
 * list_invoices, margin_trend).
 */

import type { EntityStatus } from './entities';

export interface TransactionFlow {
  id: string;
  type: string;
  description: string;
  /** SAP company codes that pay (buyers in supply_chain_flows). */
  payors: string[];
  /** SAP company codes that receive (sellers). */
  payees: string[];
  tpMethod: string;
  pli: string;
  ytdVolume: number;
  status: EntityStatus;
  // ---- backend extensions ----
  materialType?: string;
  apa?: boolean;
  challenged?: boolean;
  sellerRole?: string;
  buyerRole?: string;
  chains?: number;
}

export type InvoiceStatus =
  | 'Draft'
  | 'Pending Approval'
  | 'Approved'
  | 'Exported'
  | 'Rejected'
  | 'Reversed';

export interface Invoice {
  id: string;
  date: string;
  payor: string;
  payee: string;
  type: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  // ---- backend extensions ----
  period?: string;
  year?: number;
  /** True for rows that originated as user-submitted adjustments (write store).
   *  False for rows synthesized from supply_chain_flows. Drives action buttons. */
  submitted?: boolean;
}

export interface Royalty {
  id: string;
  ipCategory: string;
  licensor: string;
  licensee: string;
  rate: number;
  base: string;
  benchmarkRange: string;
  ytdFees: number;
  withinBenchmark: boolean;
  jurisdictionNote: string;
  // ---- backend extensions ----
  ipOwner?: string;
  matnr?: string;
  method?: string;
  apa?: boolean;
  challenged?: boolean;
}

/**
 * Wide-format monthly margin trend row, ready for Recharts:
 *   { month: 'Jan', '1000': 35.31, '3000': 42.25, ... }
 */
export interface MonthlyMarginRow {
  month: string;
  [rbukrs: string]: number | string;
}
