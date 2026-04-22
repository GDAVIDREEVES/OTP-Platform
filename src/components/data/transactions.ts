export interface TransactionFlow {
  id: string;
  type: string;
  description: string;
  payors: string[];
  payees: string[];
  tpMethod: string;
  pli: string;
  ytdVolume: number;
  status: 'in-range' | 'watch' | 'out-of-range';
}

export const transactionFlows: TransactionFlow[] = [
{
  id: 'TXN-001',
  type: 'Tangible Goods Sales',
  description: 'Finished goods manufacturer → LRD (EMEA, LATAM, CA)',
  payors: ['UK-001', 'IE-002', 'CA-001', 'MX-002'],
  payees: ['US-002', 'IE-001', 'MX-001'],
  tpMethod: 'TNMM',
  pli: 'Operating Margin %',
  ytdVolume: 1_603_821_557,
  status: 'out-of-range'
},
{
  id: 'TXN-002',
  type: 'Tangible Goods Sales',
  description: 'Finished goods manufacturer → US LRD',
  payors: ['US-003'],
  payees: ['US-002'],
  tpMethod: 'Resale Price',
  pli: 'Gross Margin %',
  ytdVolume: 245_800_000,
  status: 'in-range'
},
{
  id: 'TXN-003',
  type: 'Royalties',
  description: 'IP royalty: HoldCo → operating distributors & manufacturers',
  payors: ['US-003', 'UK-001', 'IE-002', 'CA-001', 'MX-002'],
  payees: ['CH-001'],
  tpMethod: 'CUT / CUP',
  pli: 'Royalty Rate % of Net Sales',
  ytdVolume: 187_400_000,
  status: 'watch'
},
{
  id: 'TXN-004',
  type: 'Royalties',
  description: 'Sublicense royalty — CH-001 → IE-001 (EMEA mfg rights)',
  payors: ['IE-001'],
  payees: ['CH-001'],
  tpMethod: 'CUT / CUP',
  pli: 'Royalty Rate % of Net Sales',
  ytdVolume: 32_100_000,
  status: 'in-range'
},
{
  id: 'TXN-005',
  type: 'Management / Concept Fees',
  description: 'Shared services fees → group entities',
  payors: ['US-002', 'US-003', 'UK-001', 'IE-002', 'MX-002'],
  payees: ['US-004', 'UK-002', 'CA-002', 'MX-003'],
  tpMethod: 'Cost Plus',
  pli: 'Cost Plus Markup %',
  ytdVolume: 86_400_000,
  status: 'in-range'
},
{
  id: 'TXN-006',
  type: 'Management / Concept Fees',
  description: 'EMEA regional services — UK-002 → EU entities',
  payors: ['UK-001', 'IE-001', 'IE-002'],
  payees: ['UK-002'],
  tpMethod: 'TNMM',
  pli: 'Operating Margin on Costs',
  ytdVolume: 41_200_000,
  status: 'in-range'
},
{
  id: 'TXN-007',
  type: 'R&D Services',
  description: 'Contract R&D — US-005 → US-001 (Principal)',
  payors: ['US-001'],
  payees: ['US-005'],
  tpMethod: 'Cost Plus',
  pli: 'Cost Plus Markup %',
  ytdVolume: 61_500_000,
  status: 'in-range'
},
{
  id: 'TXN-008',
  type: 'Cost Sharing',
  description: 'CSA buy-in & ongoing PCTs (US-006, CH-003, US-001)',
  payors: ['US-006', 'CH-003'],
  payees: ['US-001'],
  tpMethod: 'Profit Split / Income',
  pli: 'NPV of Expected Benefits',
  ytdVolume: 72_900_000,
  status: 'in-range'
},
{
  id: 'TXN-009',
  type: 'Intercompany Loans / Treasury',
  description: 'IC financing — CH-002 → operating entities',
  payors: ['US-003', 'UK-001', 'MX-001'],
  payees: ['CH-002'],
  tpMethod: 'CUP',
  pli: 'Interest Rate %',
  ytdVolume: 128_400_000,
  status: 'in-range'
},
{
  id: 'TXN-010',
  type: 'Sales Agency Commissions',
  description: 'Commissions — Principal → sales agents',
  payors: ['CH-001', 'US-001'],
  payees: ['UK-003', 'CA-003'],
  tpMethod: 'TNMM / Berry Ratio',
  pli: 'Berry Ratio / Net Commission Margin %',
  ytdVolume: 51_700_000,
  status: 'in-range'
}];


export interface Invoice {
  id: string;
  date: string;
  payor: string;
  payee: string;
  type: string;
  amount: number;
  currency: string;
  status: 'Draft' | 'Pending Approval' | 'Approved' | 'Exported';
}

export const invoices: Invoice[] = [
{
  id: 'INV-2025-1042',
  date: 'Dec 10, 2025',
  payor: 'IE-002',
  payee: 'IE-001',
  type: 'Year-End TP Adjustment',
  amount: 286_764_240,
  currency: 'EUR',
  status: 'Pending Approval'
},
{
  id: 'INV-2025-1041',
  date: 'Dec 10, 2025',
  payor: 'UK-001',
  payee: 'IE-001',
  type: 'Year-End TP Adjustment',
  amount: 67_200_000,
  currency: 'GBP',
  status: 'Pending Approval'
},
{
  id: 'INV-2025-1040',
  date: 'Dec 09, 2025',
  payor: 'US-003',
  payee: 'CH-001',
  type: 'Royalty — Q4',
  amount: 14_200_000,
  currency: 'USD',
  status: 'Pending Approval'
},
{
  id: 'INV-2025-1039',
  date: 'Dec 08, 2025',
  payor: 'UK-001',
  payee: 'UK-002',
  type: 'Management Fee — Q4',
  amount: 4_120_000,
  currency: 'GBP',
  status: 'Approved'
},
{
  id: 'INV-2025-1038',
  date: 'Dec 07, 2025',
  payor: 'CA-001',
  payee: 'CH-001',
  type: 'Royalty — Q4',
  amount: 3_810_000,
  currency: 'CAD',
  status: 'Approved'
},
{
  id: 'INV-2025-1037',
  date: 'Dec 06, 2025',
  payor: 'MX-002',
  payee: 'MX-003',
  type: 'Services Fee — Q4',
  amount: 620_000,
  currency: 'MXN',
  status: 'Exported'
},
{
  id: 'INV-2025-1036',
  date: 'Dec 05, 2025',
  payor: 'US-001',
  payee: 'US-005',
  type: 'R&D Services — Q4',
  amount: 15_400_000,
  currency: 'USD',
  status: 'Exported'
},
{
  id: 'INV-2025-1035',
  date: 'Dec 04, 2025',
  payor: 'IE-001',
  payee: 'CH-001',
  type: 'Sublicense Royalty — Q4',
  amount: 8_025_000,
  currency: 'EUR',
  status: 'Approved'
}];


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
}

export const royalties: Royalty[] = [
{
  id: 'RY-001',
  ipCategory: 'Core Manufacturing Patents',
  licensor: 'CH-001',
  licensee: 'IE-001',
  rate: 6.5,
  base: 'Net Sales',
  benchmarkRange: '5.0–7.5%',
  ytdFees: 32_100_000,
  withinBenchmark: true,
  jurisdictionNote: 'Irish withholding exemption under EU IRD'
},
{
  id: 'RY-002',
  ipCategory: 'Distribution Trademarks',
  licensor: 'CH-001',
  licensee: 'UK-001',
  rate: 3.8,
  base: 'Net Sales',
  benchmarkRange: '2.5–4.5%',
  ytdFees: 12_110_000,
  withinBenchmark: true,
  jurisdictionNote: 'UK–CH treaty rate 0%'
},
{
  id: 'RY-003',
  ipCategory: 'Distribution Trademarks',
  licensor: 'CH-001',
  licensee: 'IE-002',
  rate: 3.8,
  base: 'Net Sales',
  benchmarkRange: '2.5–4.5%',
  ytdFees: 43_119_000,
  withinBenchmark: true,
  jurisdictionNote: 'Irish withholding exemption'
},
{
  id: 'RY-004',
  ipCategory: 'Distribution Trademarks',
  licensor: 'CH-001',
  licensee: 'CA-001',
  rate: 3.8,
  base: 'Net Sales',
  benchmarkRange: '2.5–4.5%',
  ytdFees: 3_180_000,
  withinBenchmark: true,
  jurisdictionNote: 'CA–CH treaty 10% WHT'
},
{
  id: 'RY-005',
  ipCategory: 'Distribution Trademarks',
  licensor: 'CH-001',
  licensee: 'MX-002',
  rate: 4.8,
  base: 'Net Sales',
  benchmarkRange: '2.5–4.5%',
  ytdFees: 3_195_000,
  withinBenchmark: false,
  jurisdictionNote: 'Above benchmark — MX SAT exposure; review needed'
},
{
  id: 'RY-006',
  ipCategory: 'Software & Platform IP',
  licensor: 'CH-001',
  licensee: 'US-003',
  rate: 5.8,
  base: 'Net Sales',
  benchmarkRange: '4.0–6.5%',
  ytdFees: 14_200_000,
  withinBenchmark: true,
  jurisdictionNote: 'US–CH treaty 0% WHT on royalties'
},
{
  id: 'RY-007',
  ipCategory: 'Process Know-How',
  licensor: 'US-001',
  licensee: 'MX-001',
  rate: 3.2,
  base: 'Net Sales',
  benchmarkRange: '2.0–4.0%',
  ytdFees: 6_070_000,
  withinBenchmark: true,
  jurisdictionNote: 'US–MX treaty 10% WHT'
}];


export const monthlyMarginTrend = [
{ month: 'Jan', 'IE-002': 18, 'MX-002': 21, 'UK-001': 20, 'US-003': 5 },
{ month: 'Feb', 'IE-002': 19, 'MX-002': 21, 'UK-001': 20, 'US-003': 5 },
{ month: 'Mar', 'IE-002': 20, 'MX-002': 20, 'UK-001': 21, 'US-003': 5 },
{ month: 'Apr', 'IE-002': 21, 'MX-002': 20, 'UK-001': 21, 'US-003': 5 },
{ month: 'May', 'IE-002': 22, 'MX-002': 19, 'UK-001': 22, 'US-003': 5 },
{ month: 'Jun', 'IE-002': 23, 'MX-002': 19, 'UK-001': 22, 'US-003': 5 },
{ month: 'Jul', 'IE-002': 24, 'MX-002': 18, 'UK-001': 23, 'US-003': 5 },
{ month: 'Aug', 'IE-002': 25, 'MX-002': 18, 'UK-001': 23, 'US-003': 5 },
{ month: 'Sep', 'IE-002': 26, 'MX-002': 18, 'UK-001': 24, 'US-003': 5 },
{ month: 'Oct', 'IE-002': 27, 'MX-002': 17, 'UK-001': 24, 'US-003': 5 },
{ month: 'Nov', 'IE-002': 28, 'MX-002': 17, 'UK-001': 25, 'US-003': 5 },
{ month: 'Dec', 'IE-002': 29, 'MX-002': 17, 'UK-001': 25, 'US-003': 5 }];