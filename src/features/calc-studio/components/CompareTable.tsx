import {
  Alert, Box, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Typography,
} from '@mui/material';
import type { CalcDef, ScenarioCompare } from '@/shared/api/types';
import { tokens } from '@/shared/theme';

/** Base | Scenario | Δ over a compare result (CS-c). Rows are the calc's
 *  summary keys (falling back to the output's `summary` block when the seed
 *  declares none, e.g. reconciliation) plus — for the allocation models that
 *  carry one — the per-participant numeric fields. Every figure comes from
 *  POST /api/scenarios/{id}/compare; nothing is computed here beyond display
 *  formatting. */

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNum = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v);

function fmtNum(v: number): string {
  if (Number.isInteger(v)) return v.toLocaleString();
  return v.toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(v) >= 1000 ? 2 : 4,
  });
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (isNum(v)) return fmtNum(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Signed, colored Δ — green up, red down, muted zero/non-numeric. */
function DeltaCell({ delta }: { delta: unknown }) {
  if (!isNum(delta)) {
    return <Typography variant="body2" sx={{ color: 'text.secondary' }}>—</Typography>;
  }
  const color = delta > 0 ? tokens.ok : delta < 0 ? tokens.risk : 'text.secondary';
  return (
    <Typography variant="body2" sx={{ color, fontWeight: 700, fontFamily: 'monospace' }}>
      {delta > 0 ? '+' : ''}{fmtNum(delta)}
    </Typography>
  );
}

interface Row {
  label: string;
  base: unknown;
  scenario: unknown;
  delta: unknown;
  section?: boolean;
}

function buildRows(calc: CalcDef, result: ScenarioCompare): Row[] {
  const base = isDict(result.base) ? result.base : {};
  const scenario = isDict(result.scenario) ? result.scenario : {};
  const delta = isDict(result.delta) ? result.delta : {};
  const rows: Row[] = [];

  // Headline rows — the seed's summary keys, or the output's `summary` block
  // when the seed declares none (reconciliation).
  if (calc.summary_keys.length > 0) {
    for (const k of calc.summary_keys) {
      rows.push({ label: k, base: base[k], scenario: scenario[k], delta: delta[k] });
    }
  } else if (isDict(base.summary)) {
    const dSummary = isDict(delta.summary) ? delta.summary : {};
    for (const [k, v] of Object.entries(base.summary)) {
      rows.push({
        label: `summary.${k}`,
        base: v,
        scenario: isDict(scenario.summary) ? scenario.summary[k] : undefined,
        delta: dSummary[k],
      });
    }
  }

  // Per-participant rows (csa / profit_split allocation models).
  if (Array.isArray(base.participants)) {
    const scenParts = Array.isArray(scenario.participants) ? scenario.participants : [];
    const deltaParts = Array.isArray(delta.participants) ? delta.participants : [];
    base.participants.forEach((p: unknown, i: number) => {
      if (!isDict(p)) return;
      const sp = isDict(scenParts[i]) ? (scenParts[i] as Dict) : {};
      const dp = isDict(deltaParts[i]) ? (deltaParts[i] as Dict) : {};
      const name = typeof p.name === 'string' ? p.name : `participant ${i + 1}`;
      rows.push({ label: name, base: null, scenario: null, delta: null, section: true });
      for (const [k, v] of Object.entries(p)) {
        if (!isNum(v)) continue;
        rows.push({ label: k, base: v, scenario: sp[k], delta: dp[k] });
      }
    });
  }

  return rows;
}

export default function CompareTable({ calc, result }: { calc: CalcDef; result: ScenarioCompare }) {
  const rows = buildRows(calc, result);

  return (
    <Stack spacing={1.5}>
      {!result.scenario_sensitive && (
        <Alert severity="info" variant="outlined">
          No scenario-sensitive drivers in this calculation — none of the scenario's overrides are
          read by <b>{calc.name}</b>, so base and scenario are identical.
        </Alert>
      )}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Measure</TableCell>
              <TableCell align="right">Base</TableCell>
              <TableCell align="right">Scenario</TableCell>
              <TableCell align="right">Δ</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) =>
              r.section ? (
                <TableRow key={`s-${i}`}>
                  <TableCell colSpan={4} sx={{ bgcolor: '#F8FAFC' }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'text.secondary' }}>
                      {r.label}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={`r-${i}`} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{r.label}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: 'monospace' }}>{fmtCell(r.base)}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: 'monospace' }}>{fmtCell(r.scenario)}</TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <DeltaCell delta={r.delta} />
                    </Box>
                  </TableCell>
                </TableRow>
              )
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Both runs persisted to the run console — base #{result.base_run_id}, scenario #
        {result.scenario_run_id}. The governed parameter store was never written.
      </Typography>
    </Stack>
  );
}
