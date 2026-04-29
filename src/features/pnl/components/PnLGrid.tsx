import { Box, Chip, Stack, Typography } from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import CategoryIcon from '@mui/icons-material/Category';
import PublicIcon from '@mui/icons-material/Public';
import {
  accounts,
  type ColumnDef,
  type CountryBand,
  type EntityBand,
  type Matrix,
  type Scope,
} from '../lib/accounts';
import { HeaderCell, RowGroup, SectionHeader, SubtotalRow } from './PnLGridCells';

interface PnLGridProps {
  scope: Scope;
  columns: ColumnDef[];
  matrix: Matrix;
  calc: Record<string, Calc>;
  countryBands: CountryBand[];
  entityBands: EntityBand[];
  updateCell: (colId: string, accountId: string, value: number) => void;
}

interface Calc {
  totalRev: number;
  totalCogs: number;
  grossProfit: number;
  grossMargin: number;
  totalOpex: number;
  operatingProfit: number;
  operatingMargin: number;
  tax: number;
  netIncome: number;
}

export default function PnLGrid({
  scope,
  columns,
  matrix,
  calc,
  countryBands,
  entityBands,
  updateCell,
}: PnLGridProps) {
  return (
    <Box
      sx={{
        overflowX: 'auto',
        border: '1px solid #E2E8F0',
        borderRadius: 1.5,
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `minmax(280px, 320px) repeat(${columns.length}, minmax(170px, 1fr))`,
          minWidth: 280 + columns.length * 170,
        }}
      >
        {/* Country banding row — shown in entity + function scopes */}
        {(scope === 'entity' || scope === 'function') &&
          countryBands.length > 0 && (
            <>
              <Box
                sx={{
                  bgcolor: '#0F172A',
                  p: 1.25,
                  position: 'sticky',
                  left: 0,
                  zIndex: 3,
                  borderBottom: '1px solid #1E293B',
                }}
              />
              {countryBands.map((band) => (
                <Box
                  key={band.label + band.start}
                  sx={{
                    gridColumn: `span ${band.span}`,
                    bgcolor: '#0F172A',
                    color: 'white',
                    p: 1.25,
                    borderLeft: '1px solid #1E293B',
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={0.75}>
                    <PublicIcon sx={{ fontSize: 14, color: '#60A5FA' }} />
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 700, color: 'white' }}
                    >
                      {band.label}
                    </Typography>
                    <Chip
                      label={`${band.span} col${band.span === 1 ? '' : 's'}`}
                      size="small"
                      sx={{
                        height: 18,
                        fontSize: 10,
                        bgcolor: '#1E293B',
                        color: '#94A3B8',
                      }}
                    />
                  </Stack>
                </Box>
              ))}
            </>
          )}

        {/* Entity banding row — only in function scope */}
        {scope === 'function' && entityBands.length > 0 && (
          <>
            <Box
              sx={{
                bgcolor: '#1E293B',
                p: 1.25,
                position: 'sticky',
                left: 0,
                zIndex: 3,
                borderBottom: '1px solid #334155',
              }}
            />
            {entityBands.map((band) => (
              <Box
                key={band.entityId + band.start}
                sx={{
                  gridColumn: `span ${band.span}`,
                  bgcolor: '#1E293B',
                  color: 'white',
                  p: 1.25,
                  borderLeft: '1px solid #334155',
                }}
              >
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <BusinessIcon sx={{ fontSize: 13, color: '#94A3B8' }} />
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 700, color: 'white' }}
                  >
                    {band.entityId}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: '#94A3B8' }}
                    noWrap
                  >
                    {band.entityName}
                  </Typography>
                  {band.span > 1 && (
                    <Chip
                      label={`${band.span} functions`}
                      size="small"
                      sx={{
                        height: 18,
                        fontSize: 10,
                        bgcolor: '#2563EB',
                        color: 'white',
                        fontWeight: 700,
                      }}
                    />
                  )}
                </Stack>
              </Box>
            ))}
          </>
        )}

        {/* Column header row */}
        <HeaderCell sticky>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              color: '#475569',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            GL Account
          </Typography>
        </HeaderCell>
        {columns.map((c) => (
          <HeaderCell key={c.id} align="right">
            {scope === 'country' && (
              <Box>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={0.5}
                  sx={{ mb: 0.25, justifyContent: 'flex-end' }}
                >
                  <PublicIcon sx={{ fontSize: 14, color: '#2563EB' }} />
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {c.label}
                  </Typography>
                </Stack>
                <Stack
                  direction="row"
                  spacing={0.5}
                  flexWrap="wrap"
                  useFlexGap
                  justifyContent="flex-end"
                >
                  <Chip
                    label={c.sublabel}
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: 10,
                      bgcolor: '#F1F5F9',
                      color: '#475569',
                    }}
                  />
                  {c.functionName && (
                    <Chip
                      label={`Primary: ${c.functionName}`}
                      size="small"
                      sx={{
                        height: 18,
                        fontSize: 10,
                        bgcolor: '#EFF6FF',
                        color: '#1D4ED8',
                      }}
                    />
                  )}
                </Stack>
              </Box>
            )}
            {scope === 'entity' && (
              <Box>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 700, lineHeight: 1.15 }}
                  noWrap
                >
                  {c.label}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B',
                    display: 'block',
                    lineHeight: 1.25,
                  }}
                  noWrap
                >
                  {c.sublabel}
                </Typography>
                {c.functionName && (
                  <Stack
                    direction="row"
                    spacing={0.5}
                    sx={{ mt: 0.5, justifyContent: 'flex-end' }}
                    flexWrap="wrap"
                    useFlexGap
                  >
                    <Chip
                      icon={<CategoryIcon sx={{ fontSize: 11 }} />}
                      label={c.functionName}
                      size="small"
                      sx={{
                        height: 18,
                        fontSize: 10,
                        bgcolor: '#F1F5F9',
                        color: '#475569',
                        '& .MuiChip-icon': { ml: 0.5, color: '#64748B' },
                      }}
                    />
                  </Stack>
                )}
              </Box>
            )}
            {scope === 'function' && (
              <Box>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={0.5}
                  sx={{ mb: 0.25, justifyContent: 'flex-end' }}
                >
                  <CategoryIcon sx={{ fontSize: 13, color: '#2563EB' }} />
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 700, lineHeight: 1.15 }}
                    noWrap
                  >
                    {c.functionName}
                  </Typography>
                </Stack>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B',
                    display: 'block',
                    lineHeight: 1.25,
                  }}
                  noWrap
                >
                  {c.sublabel}
                </Typography>
              </Box>
            )}
          </HeaderCell>
        ))}

        <SectionHeader cols={columns.length} label="Revenue" />
        {accounts
          .filter((a) => a.section === 'revenue')
          .map((a) => (
            <RowGroup
              key={a.id}
              account={a}
              columns={columns}
              matrix={matrix}
              onChange={updateCell}
            />
          ))}
        <SubtotalRow
          label="Total revenue"
          columns={columns}
          values={columns.map((c) => calc[c.id].totalRev)}
        />

        <SectionHeader cols={columns.length} label="Cost of goods sold" />
        {accounts
          .filter((a) => a.section === 'cogs')
          .map((a) => (
            <RowGroup
              key={a.id}
              account={a}
              columns={columns}
              matrix={matrix}
              onChange={updateCell}
            />
          ))}
        <SubtotalRow
          label="Total COGS"
          columns={columns}
          values={columns.map((c) => calc[c.id].totalCogs)}
        />
        <SubtotalRow
          label="Gross profit"
          columns={columns}
          values={columns.map((c) => calc[c.id].grossProfit)}
          secondary={columns.map(
            (c) => `${calc[c.id].grossMargin.toFixed(1)}% GM`,
          )}
          emphasis
        />

        <SectionHeader cols={columns.length} label="Operating expenses" />
        {accounts
          .filter((a) => a.section === 'opex')
          .map((a) => (
            <RowGroup
              key={a.id}
              account={a}
              columns={columns}
              matrix={matrix}
              onChange={updateCell}
            />
          ))}
        <SubtotalRow
          label="Total OPEX"
          columns={columns}
          values={columns.map((c) => calc[c.id].totalOpex)}
        />

        <SubtotalRow
          label="Operating profit"
          columns={columns}
          values={columns.map((c) => calc[c.id].operatingProfit)}
          emphasis
          strong
        />
        <SubtotalRow
          label="Operating margin (OM %)"
          columns={columns}
          values={columns.map((c) => calc[c.id].operatingMargin)}
          isPercent
          colorByValue
        />

        <SectionHeader cols={columns.length} label="Tax" />
        {accounts
          .filter((a) => a.section === 'tax')
          .map((a) => (
            <RowGroup
              key={a.id}
              account={a}
              columns={columns}
              matrix={matrix}
              onChange={updateCell}
            />
          ))}
        <SubtotalRow
          label="Net income"
          columns={columns}
          values={columns.map((c) => calc[c.id].netIncome)}
          emphasis
          strong
        />
      </Box>
    </Box>
  );
}
