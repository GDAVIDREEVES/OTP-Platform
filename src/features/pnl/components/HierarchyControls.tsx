import React from 'react';
import {
  Box,
  Breadcrumbs,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import CategoryIcon from '@mui/icons-material/Category';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PublicIcon from '@mui/icons-material/Public';
import type { ColumnDef, Scope } from '../lib/accounts';
import { countryNames } from '../lib/accounts';

interface HierarchyControlsProps {
  scope: Scope;
  setScope: (scope: Scope) => void;
  countryFilter: string;
  setCountryFilter: (v: string) => void;
  functionFilter: string;
  setFunctionFilter: (v: string) => void;
  allCountries: string[];
  allFunctions: string[];
  columns: ColumnDef[];
  entityCount: number;
  multiFunctionEntities: number;
}

function HierarchyStep({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.25,
        py: 0.5,
        borderRadius: 1,
        bgcolor: active ? '#2563EB' : 'white',
        color: active ? 'white' : '#334155',
        border: '1px solid',
        borderColor: active ? '#2563EB' : '#CBD5E1',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 13,
        '&:hover': !active
          ? { borderColor: '#2563EB', color: '#1D4ED8' }
          : undefined,
      }}
    >
      {icon}
      <span>{label}</span>
    </Box>
  );
}

export default function HierarchyControls({
  scope,
  setScope,
  countryFilter,
  setCountryFilter,
  functionFilter,
  setFunctionFilter,
  allCountries,
  allFunctions,
  columns,
  entityCount,
  multiFunctionEntities,
}: HierarchyControlsProps) {
  return (
    <Box
      sx={{
        border: '1px solid #E2E8F0',
        borderRadius: 2,
        p: 2,
        mb: 2,
        bgcolor: '#F8FAFC',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{ mb: 1.5 }}
        flexWrap="wrap"
        useFlexGap
      >
        <Typography
          variant="caption"
          sx={{
            color: '#475569',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Hierarchy
        </Typography>
        <Breadcrumbs
          separator={
            <ChevronRightIcon sx={{ fontSize: 14, color: '#94A3B8' }} />
          }
          sx={{ fontSize: 13 }}
        >
          <HierarchyStep
            icon={<PublicIcon sx={{ fontSize: 16 }} />}
            label="Country"
            active={scope === 'country'}
            onClick={() => setScope('country')}
          />
          <HierarchyStep
            icon={<BusinessIcon sx={{ fontSize: 16 }} />}
            label="Entity"
            active={scope === 'entity'}
            onClick={() => setScope('entity')}
          />
          <HierarchyStep
            icon={<CategoryIcon sx={{ fontSize: 16 }} />}
            label="Function"
            active={scope === 'function'}
            onClick={() => setScope('function')}
          />
        </Breadcrumbs>
      </Stack>

      {scope === 'country' && (
        <Typography variant="body2" sx={{ color: '#475569' }}>
          Viewing <b>{columns.length} countries</b>, each rolling up all
          entities in that jurisdiction.
        </Typography>
      )}

      {scope === 'entity' && (
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <Typography variant="body2" sx={{ color: '#475569' }}>
            Showing{' '}
            <b>
              {columns.length} of {entityCount} entities
            </b>
            , grouped by country.
          </Typography>
          <Box sx={{ flex: 1 }} />
          <FilterDropdown
            label="Country"
            value={countryFilter}
            onChange={setCountryFilter}
            allLabel="All countries"
            options={allCountries.map((cc) => ({
              value: cc,
              label: `${countryNames[cc] || cc} (${cc})`,
            }))}
            minWidth={180}
          />
          <FilterDropdown
            label="Function"
            value={functionFilter}
            onChange={setFunctionFilter}
            allLabel="All functions"
            options={allFunctions.map((fn) => ({ value: fn, label: fn }))}
            minWidth={220}
          />
          {(countryFilter !== 'all' || functionFilter !== 'all') && (
            <Button
              size="small"
              onClick={() => {
                setCountryFilter('all');
                setFunctionFilter('all');
              }}
            >
              Clear filters
            </Button>
          )}
        </Stack>
      )}

      {scope === 'function' && (
        <Stack spacing={1}>
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            <Typography variant="body2" sx={{ color: '#475569' }}>
              Showing <b>{columns.length} function columns</b> across{' '}
              {new Set(columns.map((c) => c.entityId)).size} entities. Entities
              performing multiple functions appear as multiple columns.
            </Typography>
            <Box sx={{ flex: 1 }} />
            <FilterDropdown
              label="Country"
              value={countryFilter}
              onChange={setCountryFilter}
              allLabel="All countries"
              options={allCountries.map((cc) => ({
                value: cc,
                label: `${countryNames[cc] || cc} (${cc})`,
              }))}
              minWidth={180}
            />
            <FilterDropdown
              label="Function"
              value={functionFilter}
              onChange={setFunctionFilter}
              allLabel="All functions"
              options={allFunctions.map((fn) => ({ value: fn, label: fn }))}
              minWidth={220}
            />
            {(countryFilter !== 'all' || functionFilter !== 'all') && (
              <Button
                size="small"
                onClick={() => {
                  setCountryFilter('all');
                  setFunctionFilter('all');
                }}
              >
                Clear filters
              </Button>
            )}
          </Stack>
          <Stack
            direction="row"
            spacing={0.75}
            alignItems="center"
            sx={{ color: '#64748B' }}
          >
            <InfoOutlinedIcon sx={{ fontSize: 14 }} />
            <Typography variant="caption">
              {multiFunctionEntities > 0
                ? `${multiFunctionEntities} of ${entityCount} entities perform more than one function and are split into separate columns (revenue apportioned evenly across functions).`
                : 'When an entity performs more than one function, it will appear as a separate column per function. Revenue will be apportioned across functions.'}
            </Typography>
          </Stack>
        </Stack>
      )}
    </Box>
  );
}

function FilterDropdown({
  label,
  value,
  onChange,
  allLabel,
  options,
  minWidth,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: { value: string; label: string }[];
  minWidth: number;
}) {
  return (
    <FormControl size="small" sx={{ minWidth }}>
      <InputLabel>{label}</InputLabel>
      <Select
        value={value}
        label={label}
        onChange={(e) => onChange(e.target.value as string)}
      >
        <MenuItem value="all">{allLabel}</MenuItem>
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
