export type EntityStatus = 'in-range' | 'watch' | 'out-of-range';

export interface Entity {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  function: string;
  tpRole: string;
  tpMethod: string;
  ytdVolume: number;
  actualMargin: number | null;
  targetMarginLow: number;
  targetMarginHigh: number;
  targetMarginLabel: string;
  variance: number | null;
  status: EntityStatus;
  lastUpdated: string;
  // approximate lat/lng for map
  lat: number;
  lng: number;
}

export const entities: Entity[] = [
{
  id: 'US-001',
  name: 'US Principal Co.',
  country: 'United States',
  countryCode: 'US',
  function: 'Principal',
  tpRole: 'Principal — owns IP, bears risks',
  tpMethod: 'Profit Split',
  ytdVolume: 412_300_000,
  actualMargin: 12,
  targetMarginLow: 10,
  targetMarginHigh: 14,
  targetMarginLabel: '10–14%',
  variance: 0,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 38.9,
  lng: -77.0
},
{
  id: 'US-002',
  name: 'US Manufacturing Co.',
  country: 'United States',
  countryCode: 'US',
  function: 'Manufacturer',
  tpRole: 'Full-risk manufacturer',
  tpMethod: 'TNMM',
  ytdVolume: 298_400_000,
  actualMargin: 6,
  targetMarginLow: 4,
  targetMarginHigh: 8,
  targetMarginLabel: '4–8%',
  variance: 0,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 41.8,
  lng: -87.6
},
{
  id: 'US-003',
  name: 'US Distribution Co.',
  country: 'United States',
  countryCode: 'US',
  function: 'Distributor',
  tpRole: 'LRD — US market',
  tpMethod: 'Resale Price',
  ytdVolume: 245_800_000,
  actualMargin: 5,
  targetMarginLow: 4,
  targetMarginHigh: 7,
  targetMarginLabel: '4–7%',
  variance: 0,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 40.7,
  lng: -74.0
},
{
  id: 'US-004',
  name: 'US Shared Services Co.',
  country: 'United States',
  countryCode: 'US',
  function: 'Shared Services',
  tpRole: 'IT/HR/finance/legal',
  tpMethod: 'Cost Plus',
  ytdVolume: 74_200_000,
  actualMargin: 6,
  targetMarginLow: 5,
  targetMarginHigh: 8,
  targetMarginLabel: '5–8%',
  variance: 0,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 32.8,
  lng: -96.8
},
{
  id: 'US-005',
  name: 'US R&D Co.',
  country: 'United States',
  countryCode: 'US',
  function: 'R&D / Contract R&D',
  tpRole: 'Contract R&D for Principal',
  tpMethod: 'Cost Plus',
  ytdVolume: 61_500_000,
  actualMargin: 9,
  targetMarginLow: 7,
  targetMarginHigh: 10,
  targetMarginLabel: '7–10%',
  variance: 0,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 37.4,
  lng: -122.1
},
{
  id: 'US-006',
  name: 'US Cost Sharing Participant',
  country: 'United States',
  countryCode: 'US',
  function: 'R&D / Cost Share',
  tpRole: 'CSA participant',
  tpMethod: 'Profit Split',
  ytdVolume: 38_700_000,
  actualMargin: null,
  targetMarginLow: 0,
  targetMarginHigh: 0,
  targetMarginLabel: 'NPV-based',
  variance: 0,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 42.3,
  lng: -71.0
},
{
  id: 'UK-001',
  name: 'UK Distribution Co.',
  country: 'United Kingdom',
  countryCode: 'GB',
  function: 'Distributor',
  tpRole: 'LRD — UK & Western Europe',
  tpMethod: 'TNMM',
  ytdVolume: 318_720_615,
  actualMargin: 25,
  targetMarginLow: 4,
  targetMarginHigh: 7,
  targetMarginLabel: '4–7%',
  variance: 21,
  status: 'out-of-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 51.5,
  lng: -0.1
},
{
  id: 'UK-002',
  name: 'UK Shared Services Co.',
  country: 'United Kingdom',
  countryCode: 'GB',
  function: 'Shared Services',
  tpRole: 'EMEA regional hub',
  tpMethod: 'TNMM',
  ytdVolume: 52_100_000,
  actualMargin: 6,
  targetMarginLow: 5,
  targetMarginHigh: 8,
  targetMarginLabel: '5–8%',
  variance: 0,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 52.5,
  lng: -1.9
},
{
  id: 'UK-003',
  name: 'UK Sales Agent Co.',
  country: 'United Kingdom',
  countryCode: 'GB',
  function: 'Sales Agent',
  tpRole: 'Commissionnaire for CH-001',
  tpMethod: 'Berry Ratio',
  ytdVolume: 28_900_000,
  actualMargin: 8,
  targetMarginLow: 6,
  targetMarginHigh: 10,
  targetMarginLabel: '6–10%',
  variance: 0,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 53.8,
  lng: -1.5
},
{
  id: 'CH-001',
  name: 'Switzerland IP HoldCo',
  country: 'Switzerland',
  countryCode: 'CH',
  function: 'IP Holding / Principal',
  tpRole: 'Holds registered IP',
  tpMethod: 'CUT/CUP',
  ytdVolume: 312_500_000,
  actualMargin: null,
  targetMarginLow: 0,
  targetMarginHigh: 0,
  targetMarginLabel: '—',
  variance: null,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 47.4,
  lng: 8.5
},
{
  id: 'CH-002',
  name: 'Switzerland Treasury Co.',
  country: 'Switzerland',
  countryCode: 'CH',
  function: 'Treasury / Finance',
  tpRole: 'IC treasury and cash pooling',
  tpMethod: 'CUP',
  ytdVolume: 128_400_000,
  actualMargin: 3,
  targetMarginLow: 2,
  targetMarginHigh: 4,
  targetMarginLabel: '2–4%',
  variance: 0,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 46.2,
  lng: 6.1
},
{
  id: 'CH-003',
  name: 'Switzerland Cost Sharing Participant',
  country: 'Switzerland',
  countryCode: 'CH',
  function: 'R&D / Cost Share',
  tpRole: 'CSA participant alongside US-006',
  tpMethod: 'Profit Split',
  ytdVolume: 34_200_000,
  actualMargin: null,
  targetMarginLow: 0,
  targetMarginHigh: 0,
  targetMarginLabel: 'NPV-based',
  variance: 0,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 46.9,
  lng: 7.4
},
{
  id: 'IE-001',
  name: 'Ireland Manufacturing Co.',
  country: 'Ireland',
  countryCode: 'IE',
  function: 'Manufacturer',
  tpRole: 'Full-risk manufacturer EMEA',
  tpMethod: 'TNMM',
  ytdVolume: 401_500_000,
  actualMargin: 7,
  targetMarginLow: 5,
  targetMarginHigh: 9,
  targetMarginLabel: '5–9%',
  variance: 0,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 53.3,
  lng: -6.2
},
{
  id: 'IE-002',
  name: 'Ireland Distribution Co.',
  country: 'Ireland',
  countryCode: 'IE',
  function: 'Distributor',
  tpRole: 'LRD — Ireland & Nordics',
  tpMethod: 'TNMM',
  ytdVolume: 1_134_709_159,
  actualMargin: 29,
  targetMarginLow: 4,
  targetMarginHigh: 7,
  targetMarginLabel: '4–7%',
  variance: 25,
  status: 'out-of-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 51.9,
  lng: -8.5
},
{
  id: 'CA-001',
  name: 'Canada Distribution Co.',
  country: 'Canada',
  countryCode: 'CA',
  function: 'Distributor',
  tpRole: 'LRD — Canadian market',
  tpMethod: 'TNMM',
  ytdVolume: 83_811_733,
  actualMargin: 18,
  targetMarginLow: 4,
  targetMarginHigh: 7,
  targetMarginLabel: '4–7%',
  variance: 14,
  status: 'watch',
  lastUpdated: 'Dec 10, 2025',
  lat: 43.7,
  lng: -79.4
},
{
  id: 'CA-002',
  name: 'Canada Shared Services Co.',
  country: 'Canada',
  countryCode: 'CA',
  function: 'Shared Services',
  tpRole: 'Americas shared services',
  tpMethod: 'Cost Plus',
  ytdVolume: 41_200_000,
  actualMargin: 7,
  targetMarginLow: 5,
  targetMarginHigh: 8,
  targetMarginLabel: '5–8%',
  variance: 0,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 45.4,
  lng: -75.7
},
{
  id: 'CA-003',
  name: 'Canada Sales Agent Co.',
  country: 'Canada',
  countryCode: 'CA',
  function: 'Sales Agent',
  tpRole: 'Commissionnaire for US-001',
  tpMethod: 'Berry Ratio',
  ytdVolume: 22_800_000,
  actualMargin: 8,
  targetMarginLow: 6,
  targetMarginHigh: 10,
  targetMarginLabel: '6–10%',
  variance: 0,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 49.3,
  lng: -123.1
},
{
  id: 'MX-001',
  name: 'Mexico Manufacturing Co.',
  country: 'Mexico',
  countryCode: 'MX',
  function: 'Manufacturer',
  tpRole: 'Maquiladora contract manufacturer',
  tpMethod: 'TNMM',
  ytdVolume: 189_600_000,
  actualMargin: 6,
  targetMarginLow: 5,
  targetMarginHigh: 9,
  targetMarginLabel: '5–9%',
  variance: 0,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 25.7,
  lng: -100.3
},
{
  id: 'MX-002',
  name: 'Mexico Distribution Co.',
  country: 'Mexico',
  countryCode: 'MX',
  function: 'Distributor',
  tpRole: 'LRD — Mexican & LATAM markets',
  tpMethod: 'TNMM',
  ytdVolume: 66_580_050,
  actualMargin: 17,
  targetMarginLow: 4,
  targetMarginHigh: 7,
  targetMarginLabel: '4–7%',
  variance: 13,
  status: 'watch',
  lastUpdated: 'Dec 10, 2025',
  lat: 19.4,
  lng: -99.1
},
{
  id: 'MX-003',
  name: 'Mexico Services Co.',
  country: 'Mexico',
  countryCode: 'MX',
  function: 'Shared Services',
  tpRole: 'Local HR/admin for MX entities',
  tpMethod: 'Cost Plus',
  ytdVolume: 12_400_000,
  actualMargin: 6,
  targetMarginLow: 5,
  targetMarginHigh: 8,
  targetMarginLabel: '5–8%',
  variance: 0,
  status: 'in-range',
  lastUpdated: 'Dec 10, 2025',
  lat: 20.7,
  lng: -103.3
}];


export const statusColor: Record<EntityStatus, string> = {
  'in-range': '#16A34A',
  watch: '#D97706',
  'out-of-range': '#DC2626'
};

export const statusLabel: Record<EntityStatus, string> = {
  'in-range': 'In Range',
  watch: 'Watch',
  'out-of-range': 'Out of Range'
};

export const totalICVolume = entities.reduce((sum, e) => sum + e.ytdVolume, 0);
export const entitiesInRange = entities.filter(
  (e) => e.status === 'in-range'
).length;
export const entitiesOutOfRange = entities.filter(
  (e) => e.status === 'out-of-range'
).length;
export const entitiesWatch = entities.filter((e) => e.status === 'watch').length;

export function getEntity(id: string) {
  return entities.find((e) => e.id === id);
}