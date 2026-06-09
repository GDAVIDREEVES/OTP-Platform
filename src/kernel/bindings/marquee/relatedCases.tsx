import { useEffect, useState } from 'react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Chip, Link, Paper, Stack, Typography } from '@mui/material';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import { api } from '@/shared/api/client';
import { tokens } from '@/shared/theme';
import type { Case } from '@/shared/api/types';

/** The controversy processes whose open cases pull on the documentation pack:
 *  APA filing support (OTP-39) and audit defense / IDR (OTP-40). Each carries
 *  the worklist route that a "Related cases" row links into. */
const SOURCES: { process: string; route: string; label: string }[] = [
  { process: 'OTP-40', route: '/process/OTP-40/worklist', label: 'Audit defense / IDR' },
  { process: 'OTP-39', route: '/process/OTP-39/worklist', label: 'APA filing support' },
];

const isOpen = (c: Case): boolean => c.status !== 'closed';

/** Fetches the open cases for the two controversy processes (OTP-40 / OTP-39)
 *  that consume this documentation pack and links each into its worklist. No
 *  side table: this is the live `api.cases` feed, the same source the Case
 *  Workspace renders — it just surfaces the demand on the docs from the filing
 *  side, closing the documentation ⇄ cases loop. */
const RelatedCases: FC = () => {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<{ source: (typeof SOURCES)[number]; cases: Case[] }[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all(
      SOURCES.map((source) =>
        api
          .cases({ process_id: source.process })
          .then((cs) => ({ source, cases: cs.filter(isOpen) }))
          .catch(() => ({ source, cases: [] as Case[] })),
      ),
    ).then((rows) => alive && setGroups(rows.filter((r) => r.cases.length > 0)));
    return () => {
      alive = false;
    };
  }, []);

  if (groups.length === 0) return null;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <FolderOpenOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Related cases</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          open controversy matters that rely on this documentation
        </Typography>
      </Stack>
      <Stack spacing={1.5}>
        {groups.map(({ source, cases }) => (
          <Box key={source.process}>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>
              {source.label} ({source.process})
            </Typography>
            {cases.map((c) => (
              <Stack
                key={c.id}
                direction="row"
                alignItems="center"
                spacing={1.5}
                sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Link
                    component="button"
                    type="button"
                    underline="hover"
                    onClick={() => navigate(source.route)}
                    sx={{ fontWeight: 700, textAlign: 'left' }}
                  >
                    {c.title}
                  </Link>
                  <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                    {c.owner}
                    {c.jurisdiction ? ` · ${c.jurisdiction}` : ''}
                  </Typography>
                </Box>
                {c.jurisdiction && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={c.jurisdiction}
                    sx={{ borderColor: tokens.action, color: tokens.action }}
                  />
                )}
              </Stack>
            ))}
          </Box>
        ))}
      </Stack>
    </Paper>
  );
};

export default RelatedCases;
