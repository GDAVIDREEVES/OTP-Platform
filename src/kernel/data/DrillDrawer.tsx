import { useEffect, useState } from 'react';
import {
  Box,
  CircularProgress,
  Drawer,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { api } from '@/shared/api/client';
import type { JournalEntryRow } from '@/shared/api/types';
import { formatCurrency } from '@/shared/utils/format';

/** Drill-to-source: opens beside any figure and shows the underlying ACDOCA
 *  postings — every number is verifiable, not just trusted. */
export default function DrillDrawer({
  open,
  onClose,
  entityId,
  entityName,
}: {
  open: boolean;
  onClose: () => void;
  entityId?: string;
  entityName?: string;
}) {
  const [rows, setRows] = useState<JournalEntryRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !entityId) return;
    let alive = true;
    setLoading(true);
    api
      .journalEntries({ entity: entityId, limit: 80 })
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, entityId]);

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 660 } } }}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" alignItems="flex-start" sx={{ mb: 1.5 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>
              Drill to source · ACDOCA postings
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              {entityName ?? entityId}
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="Close">
            <CloseIcon />
          </IconButton>
        </Stack>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Doc</TableCell>
                <TableCell>Account</TableCell>
                <TableCell>Material</TableCell>
                <TableCell>Description</TableCell>
                <TableCell align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={`${r.BELNR}-${r.DOCLN}-${i}`} hover>
                  <TableCell>{r.BUDAT ?? '—'}</TableCell>
                  <TableCell>{r.BELNR}</TableCell>
                  <TableCell>{r.RACCT}</TableCell>
                  <TableCell>{r.MATNR || '—'}</TableCell>
                  <TableCell sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.SGTXT}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatCurrency(r.HSL, r.RHCUR || 'USD')}
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography variant="body2" sx={{ color: 'text.secondary', py: 2, textAlign: 'center' }}>
                      No postings found for this entity.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Box>
    </Drawer>
  );
}
