/** The platform glossary (POL-08). One governed source for the transfer-pricing
 *  and SAP-field jargon that peppers the workpapers, so a label like "DEMPE" or
 *  "RACCT" can carry a tooltip explanation wherever it appears (via <Term/>).
 *
 *  `expansion` is the short spelled-out form (what the acronym stands for); the
 *  optional one-sentence `blurb` says what it means in context. Keep both tight —
 *  a tooltip, not a treatise.
 */
export interface GlossaryEntry {
  expansion: string;
  blurb?: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // ---- transfer-pricing methods & measures ----
  TNMM: {
    expansion: 'Transactional Net Margin Method',
    blurb: 'Tests a controlled transaction by comparing a net-profit indicator (a PLI) against comparable independents.',
  },
  CUP: {
    expansion: 'Comparable Uncontrolled Price',
    blurb: 'The most direct method — benchmarks the price of a controlled transaction against a comparable uncontrolled one.',
  },
  CPM: {
    expansion: 'Comparable Profits Method',
    blurb: 'The US §1.482-5 profits-based method, the practical analogue of TNMM.',
  },
  PLI: {
    expansion: 'Profit Level Indicator',
    blurb: 'The net-margin ratio (e.g. operating margin, Berry ratio) tested against the arm’s-length range.',
  },
  DEMPE: {
    expansion: 'Development, Enhancement, Maintenance, Protection and Exploitation',
    blurb: 'The five value-creating functions the OECD tests to locate intangible returns by substance, not legal ownership.',
  },
  RAB: {
    expansion: 'Reasonably Anticipated Benefits',
    blurb: 'The projected-benefit measure used to weight each participant’s cost-sharing contribution.',
  },
  PCT: {
    expansion: 'Platform Contribution Transaction',
    blurb: 'A buy-in payment for pre-existing resources contributed to a cost-sharing arrangement.',
  },
  BEAT: {
    expansion: 'Base Erosion and Anti-abuse Tax',
    blurb: 'The US IRC §59A minimum tax on base-eroding related-party payments by applicable taxpayers.',
  },
  MTI: {
    expansion: 'Modified Taxable Income',
    blurb: 'Regular taxable income with base-eroding tax benefits added back — the BEAT base.',
  },
  CbCR: {
    expansion: 'Country-by-Country Reporting',
    blurb: 'The OECD BEPS Action 13 Table 1 filing of revenue, profit, tax and substance per jurisdiction.',
  },
  LVAIGS: {
    expansion: 'Low Value-Adding Intra-Group Services',
    blurb: 'Routine support services eligible for the OECD simplified 5% cost mark-up safe harbour.',
  },
  APA: {
    expansion: 'Advance Pricing Agreement',
    blurb: 'A negotiated agreement with a tax authority fixing the TP method for future years.',
  },
  MAP: {
    expansion: 'Mutual Agreement Procedure',
    blurb: 'The treaty mechanism for competent authorities to resolve double taxation from a TP adjustment.',
  },
  GloBE: {
    expansion: 'Global Anti-Base Erosion (Pillar Two)',
    blurb: 'The OECD 15% global minimum-tax rules; a top-up tax applies where an entity’s effective rate falls short.',
  },
  'Pillar Two': {
    expansion: 'OECD Pillar Two — Global Anti-Base Erosion (GloBE)',
    blurb: 'The 15% global minimum-tax regime; a top-up tax applies where an entity’s effective rate falls short.',
  },
  UTP: {
    expansion: 'Uncertain Tax Position',
    blurb: 'A tax position whose sustainability on audit is uncertain, reserved for under ASC 740 / IAS 12.',
  },
  ICA: {
    expansion: 'Intercompany Agreement',
    blurb: 'The legal contract governing a related-party transaction — the paper that must match the pricing.',
  },
  WHT: {
    expansion: 'Withholding Tax',
    blurb: 'Tax withheld at source on cross-border royalties, interest or services, often reduced by treaty.',
  },
  LRD: {
    expansion: 'Limited-Risk Distributor',
    blurb: 'A distributor stripped of key risks, earning a stable routine return under TNMM.',
  },
  ALS: {
    expansion: 'Arm’s-Length Standard',
    blurb: 'The governing principle: related parties should price as independents would in comparable circumstances.',
  },
  'Berry ratio': {
    expansion: 'Berry ratio',
    blurb: 'Gross profit divided by operating expense — a PLI for routine distributors and service providers.',
  },
  CSA: {
    expansion: 'Cost Sharing Arrangement',
    blurb: 'Participants share the cost of developing intangibles in proportion to their reasonably anticipated benefits.',
  },
  IDR: {
    expansion: 'Information Document Request',
    blurb: 'A formal IRS request for documents and data during a transfer-pricing examination.',
  },
  '§6662': {
    expansion: 'IRC §6662 accuracy-related penalty',
    blurb: 'The 20–40% penalty avoided by maintaining contemporaneous transfer-pricing documentation.',
  },
  'Local File': {
    expansion: 'OECD Local File',
    blurb: 'The entity-level documentation of the local taxpayer’s controlled transactions and their pricing.',
  },
  'Master File': {
    expansion: 'OECD Master File',
    blurb: 'The group-level blueprint of the MNE’s business, intangibles, financing and TP policies.',
  },
  'maker-checker': {
    expansion: 'Maker-checker',
    blurb: 'Segregation of duties: the preparer of a change cannot be the approver of it.',
  },
  'evidence packet': {
    expansion: 'Evidence packet',
    blurb: 'The one-call assembly of audit history, before/after diffs and linked postings behind a figure.',
  },
  'true-up': {
    expansion: 'True-up',
    blurb: 'A year-end adjustment that trues actual results to the targeted arm’s-length outcome.',
  },

  // ---- SAP / ACDOCA fields ----
  // The `expansion` here doubles as the short human column label (see
  // VALUE_DIM_LABELS below, which derives from it) — keep it label-length.
  ACDOCA: {
    expansion: 'Universal Journal',
    blurb: 'SAP S/4HANA’s single line-item table — the golden source every figure here drills back to.',
  },
  RACCT: {
    expansion: 'G/L account',
    blurb: 'The general-ledger account number posted on an ACDOCA line.',
  },
  RCNTR: {
    expansion: 'Cost center',
    blurb: 'The cost center that carries the posting — the grain cost pools are built over.',
  },
  PRCTR: {
    expansion: 'Profit center',
    blurb: 'The profit center on the posting — a segment / responsibility dimension.',
  },
  RBUKRS: {
    expansion: 'Company code',
    blurb: 'The SAP company code — the legal entity that owns the posting.',
  },
  HSL: {
    expansion: 'Amount (company-code currency)',
    blurb: 'The posting value in the company-code (local) currency — the amount every total sums.',
  },
  GJAHR: {
    expansion: 'Fiscal year',
    blurb: 'The fiscal year of the accounting document.',
  },
  BELNR: {
    expansion: 'Document number',
    blurb: 'The accounting document number — the drill-to-source handle for a posting.',
  },
  BUDAT: {
    expansion: 'Posting date',
    blurb: 'The date the document was posted to the ledger.',
  },
  SGTXT: {
    expansion: 'Item text',
    blurb: 'The free-text line-item description on the posting.',
  },
  AWREF: {
    expansion: 'Reference document',
    blurb: 'The reference (source) document number linking the posting back to its originating transaction.',
  },
};

/** Human labels for the value-enumerable dimensions the user knows by name —
 *  the single source for SAP-field column labels (POL-16 absorb). These are the
 *  ACDOCA column labels shown in the cockpit's value browser; kept as explicit
 *  strings (NOT derived from the GLOSSARY tooltip expansions) so editing a
 *  tooltip title can never silently rename a column. The two maps overlap in
 *  spirit but serve different surfaces — a hover explanation vs. a column
 *  header. Consumed by the cockpit NodePalette's ACDOCA value browser. */
export const VALUE_DIM_LABELS: Record<string, string> = {
  RACCT: 'G/L account',
  RCNTR: 'Cost center',
  PRCTR: 'Profit center',
  RBUKRS: 'Entity (company code)',
  PPRCTR: 'Partner profit center',
  PBUKRS: 'Partner entity',
  RASSC: 'Trading partner',
  KOKRS: 'Controlling area',
  LAND1: 'Country',
  TAX_COUNTRY: 'Tax country',
  SEGMENT: 'Segment',
  RFAREA: 'Functional area',
  BLART: 'Document type',
  DRCRK: 'Debit/Credit',
  BSCHL: 'Posting key',
  USNAM: 'User',
  POPER: 'Posting period',
  cost_center: 'Cost center',
  profit_center: 'Profit center',
  cost_element: 'Cost element',
  function: 'Function',
  ledger: 'Ledger',
  ROLE_CODE: 'Role',
  TP_METHOD: 'TP method',
  MATERIAL_TYPE: 'Material type',
};
