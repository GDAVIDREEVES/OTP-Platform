import type { FC } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import { useEntities } from '@/shared/providers/DataProvider';
import { formatCurrency } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';
import type { Entity } from '@/shared/types/entity';
import KpiStrip from '@/kernel/shell/KpiStrip';
import { useReference } from '@/kernel/data/useReference';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';
import { useDocumentation } from './otp37';
import RelatedCases from './relatedCases';

// --- OECD Master File reference shapes (mirroring otp29 DEMPE + otp34 CbCR) ---
interface Intangible { intangible_id: string; name: string; type: string; legal_owner_rbukrs: string; chain_ids: string[] }
interface Alloc { intangible_id: string; rbukrs: string; develop: number; enhance: number; maintain: number; protect: number; exploit: number; fte: number; notes: string }
interface CbcrRow { rbukrs: string; jurisdiction: string; revenue_related: number; revenue_unrelated: number; profit_before_tax: number; tax_accrued: number; employees: number }
interface Cbcr { rows: CbcrRow[]; year: number }

const nameOf = (entities: Entity[], code: string) => entities.find((e) => e.id === code)?.name ?? code;
const cbcrRevenue = (r: CbcrRow): number => r.revenue_related + r.revenue_unrelated;

const fnCols: { key: keyof Alloc; label: string }[] = [
  { key: 'develop', label: 'D' },
  { key: 'enhance', label: 'E' },
  { key: 'maintain', label: 'M' },
  { key: 'protect', label: 'P' },
  { key: 'exploit', label: 'E' },
];

const Kpis: FC<BindingCtx> = () => {
  const { data: intan } = useReference<{ intangibles: Intangible[] }>('intangibles');
  const { data: cbcr } = useReference<Cbcr>('cbcr');
  const { data: doc } = useDocumentation();
  const rows = cbcr?.rows ?? [];
  const totalRevenue = rows.reduce((s, r) => s + cbcrRevenue(r), 0);
  const items: KpiItem[] = [
    { key: 'g', label: 'Group entities', value: String(doc?.totals.entities ?? 0), provenance: 'documentation · OECD Ch. V' },
    { key: 'i', label: 'Key intangibles', value: String(intan?.intangibles?.length ?? 0), hint: 'DEMPE register' },
    { key: 'j', label: 'CbC jurisdictions', value: String(rows.length) },
    { key: 'r', label: 'Group revenue', value: formatCurrency(totalRevenue, 'USD', true), provenance: 'cbcr · Table 1' },
  ];
  return <KpiStrip items={items} />;
};

const MasterFile: FC<BindingCtx> = () => {
  const entities = useEntities();
  const { data: doc, loading: l0 } = useDocumentation();
  const { data: intan, loading: l1 } = useReference<{ intangibles: Intangible[] }>('intangibles');
  const { data: dempe, loading: l2 } = useReference<{ allocations: Alloc[] }>('dempe');
  const { data: cbcr, loading: l3 } = useReference<Cbcr>('cbcr');

  if (l0 || l1 || l2 || l3) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const orgEntities = doc?.entities ?? [];
  const intangibles = intan?.intangibles ?? [];
  const allocs = dempe?.allocations ?? [];
  const cbcrRows = [...(cbcr?.rows ?? [])].sort((a, b) => cbcrRevenue(b) - cbcrRevenue(a));

  return (
    <Stack spacing={3}>
      <Alert severity="info" variant="outlined">
        OECD Master File (TPG Chapter V), composed from the group&apos;s entity master, the DEMPE intangibles
        register, and the Country-by-Country seed. The blueprint of the MNE: who does what (organisational
        structure), who owns and develops the intangibles (DEMPE), and where profit and substance sit (CbCR).
      </Alert>

      {/* A. Organisational structure — entity master with FAR/function */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <AccountTreeOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>A. Organisational structure</Typography>
        </Stack>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Entity</TableCell>
              <TableCell>Jurisdiction</TableCell>
              <TableCell>Functional currency</TableCell>
              <TableCell>FAR / function</TableCell>
              <TableCell align="right">Controlled txns</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {orgEntities.map((e) => (
              <TableRow key={e.rbukrs} hover>
                <TableCell sx={{ fontWeight: 700 }}>{e.display_name}</TableCell>
                <TableCell>{e.country ?? '—'}</TableCell>
                <TableCell>{e.functional_currency ?? '—'}</TableCell>
                <TableCell>{e.tp_function_label ?? '—'}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{e.covered_count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {/* B. Intangibles & DEMPE — mirrors otp29 */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>B. Intangibles &amp; DEMPE</Typography>
        <Stack spacing={2}>
          {intangibles.map((ip) => (
            <Box key={ip.intangible_id}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{ip.name}</Typography>
                <Chip size="small" label={ip.type} variant="outlined" />
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Legal owner: {nameOf(entities, ip.legal_owner_rbukrs)}
                </Typography>
              </Stack>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Entity</TableCell>
                    {fnCols.map((c, i) => <TableCell key={`${c.key}-${i}`} align="right">{c.label}</TableCell>)}
                    <TableCell align="right">FTE</TableCell>
                    <TableCell>Role</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {allocs.filter((a) => a.intangible_id === ip.intangible_id).map((a) => (
                    <TableRow key={a.rbukrs} hover>
                      <TableCell sx={{ fontWeight: 700 }}>{nameOf(entities, a.rbukrs)}</TableCell>
                      {fnCols.map((c, i) => <TableCell key={`${c.key}-${i}`} align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{a[c.key]}%</TableCell>)}
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{a.fte}</TableCell>
                      <TableCell><Typography variant="caption" sx={{ color: 'text.secondary' }}>{a.notes}</Typography></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          ))}
        </Stack>
      </Paper>

      {/* C. Financial & tax position — CbCR Table 1, mirrors otp34 */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>
          C. Financial &amp; tax position {cbcr?.year ? `(CbCR ${cbcr.year})` : ''}
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Jurisdiction</TableCell>
              <TableCell align="right">Total revenue</TableCell>
              <TableCell align="right">Profit before tax</TableCell>
              <TableCell align="right">Tax accrued</TableCell>
              <TableCell align="right">Employees</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {cbcrRows.map((r) => (
              <TableRow key={r.rbukrs} hover>
                <TableCell sx={{ fontWeight: 700 }}>{r.jurisdiction}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(cbcrRevenue(r), 'USD', true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.profit_before_tax, 'USD', true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.tax_accrued, 'USD', true)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.employees < 25 ? tokens.watch : 'inherit' }}>{r.employees}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <RelatedCases />
    </Stack>
  );
};

export const otp33: ProcessBinding = { kpis: Kpis, tabs: { overview: MasterFile, calculation: MasterFile, docs: MasterFile } };
