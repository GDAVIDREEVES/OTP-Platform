import type { EntityStatus } from '@/shared/types/entity';

export const statusColor: Record<EntityStatus, string> = {
  'in-range': '#16A34A',
  watch: '#D97706',
  'out-of-range': '#DC2626',
  'no-data': '#64748B',
};

export const statusLabel: Record<EntityStatus, string> = {
  'in-range': 'In Range',
  watch: 'Watch',
  'out-of-range': 'Out of Range',
  'no-data': 'No Data',
};
