export const formatCurrency = (
  value: number,
  currency = 'USD',
  compact = false,
) => {
  if (compact) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
};

export const formatNumber = (value: number) =>
  new Intl.NumberFormat('en-US').format(value);
