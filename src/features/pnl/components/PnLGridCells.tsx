import React, { useState } from 'react';
import { Box, TextField, Typography } from '@mui/material';
import type { Account, ColumnDef, Matrix } from '../lib/accounts';
import { fmt } from '../lib/accounts';

export function HeaderCell({
  children,
  sticky,
  align,
}: {
  children: React.ReactNode;
  sticky?: boolean;
  align?: 'left' | 'right';
}) {
  return (
    <Box
      sx={{
        p: 1.25,
        bgcolor: '#F8FAFC',
        borderBottom: '2px solid #E2E8F0',
        position: sticky ? 'sticky' : 'static',
        left: sticky ? 0 : undefined,
        zIndex: sticky ? 2 : 1,
        textAlign: align === 'right' ? 'right' : 'left',
      }}
    >
      {children}
    </Box>
  );
}

export function SectionHeader({ cols, label }: { cols: number; label: string }) {
  return (
    <Box
      sx={{
        gridColumn: `span ${cols + 1}`,
        bgcolor: '#F1F5F9',
        borderTop: '1px solid #E2E8F0',
        borderBottom: '1px solid #E2E8F0',
        px: 1.5,
        py: 0.75,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          fontWeight: 800,
          color: '#0F172A',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

interface RowGroupProps {
  account: Account;
  columns: ColumnDef[];
  matrix: Matrix;
  onChange: (colId: string, accountId: string, value: number) => void;
}

export function RowGroup({ account, columns, matrix, onChange }: RowGroupProps) {
  return (
    <>
      <Box
        sx={{
          p: 1.25,
          bgcolor: 'white',
          borderBottom: '1px solid #F1F5F9',
          position: 'sticky',
          left: 0,
          zIndex: 1,
        }}
      >
        <Typography
          variant="body2"
          sx={{ color: '#334155', pl: (account.indent || 0) * 2 }}
        >
          {account.label}
        </Typography>
      </Box>
      {columns.map((c) => (
        <EditableCell
          key={c.id}
          value={matrix[c.id]?.[account.id] ?? 0}
          onChange={(v) => onChange(c.id, account.id, v)}
        />
      ))}
    </>
  );
}

function EditableCell({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [raw, setRaw] = useState<string>('');
  const [focused, setFocused] = useState(false);
  const display = focused ? raw : fmt(value);
  return (
    <Box
      sx={{
        p: 0.5,
        borderBottom: '1px solid #F1F5F9',
        bgcolor: '#FAFCFF',
      }}
    >
      <TextField
        size="small"
        value={focused ? raw : display}
        onFocus={() => {
          setFocused(true);
          setRaw(String(value));
        }}
        onBlur={() => {
          const n = Number(raw.replace(/[^0-9.-]/g, ''));
          if (!isNaN(n)) onChange(n);
          setFocused(false);
        }}
        onChange={(e) => setRaw(e.target.value)}
        variant="outlined"
        inputProps={{
          style: {
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
            padding: '6px 8px',
            fontSize: 13,
          },
          'aria-label': 'Edit value',
        }}
        sx={{
          width: '100%',
          '& .MuiOutlinedInput-root': {
            bgcolor: focused ? '#EFF6FF' : 'transparent',
            '& fieldset': {
              borderColor: focused ? '#2563EB' : 'transparent',
            },
            '&:hover fieldset': { borderColor: '#CBD5E1' },
          },
        }}
      />
    </Box>
  );
}

interface SubtotalRowProps {
  label: string;
  columns: ColumnDef[];
  values: number[];
  secondary?: string[];
  emphasis?: boolean;
  strong?: boolean;
  isPercent?: boolean;
  colorByValue?: boolean;
}

export function SubtotalRow({
  label,
  columns,
  values,
  secondary,
  emphasis,
  strong,
  isPercent,
  colorByValue,
}: SubtotalRowProps) {
  const bg = strong ? '#E2E8F0' : emphasis ? '#F1F5F9' : '#F8FAFC';
  const weight = strong ? 800 : 700;
  return (
    <>
      <Box
        sx={{
          p: 1.25,
          bgcolor: bg,
          borderTop: '1px solid #E2E8F0',
          borderBottom: '1px solid #E2E8F0',
          position: 'sticky',
          left: 0,
          zIndex: 1,
        }}
      >
        <Typography
          variant="body2"
          sx={{ fontWeight: weight, color: '#0F172A' }}
        >
          {label}
        </Typography>
      </Box>
      {columns.map((c, i) => {
        const v = values[i];
        let color = '#0F172A';
        if (colorByValue) {
          if (v >= 4 && v <= 7) color = '#16A34A';
          else if (v > 7 && v < 12) color = '#D97706';
          else if (v > 12 || v < 4) color = '#DC2626';
        }
        return (
          <Box
            key={c.id}
            sx={{
              p: 1.25,
              bgcolor: bg,
              borderTop: '1px solid #E2E8F0',
              borderBottom: '1px solid #E2E8F0',
              textAlign: 'right',
            }}
          >
            <Typography
              variant="body2"
              sx={{
                fontWeight: weight,
                color,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {isPercent ? `${v.toFixed(1)}%` : fmt(v)}
            </Typography>
            {secondary && (
              <Typography variant="caption" sx={{ color: '#64748B' }}>
                {secondary[i]}
              </Typography>
            )}
          </Box>
        );
      })}
    </>
  );
}
