import type { Language } from './i18n';

export function formatCurrency(
  amount: number | string | null | undefined,
  locale: Language = 'zh-CN',
  currency = 'CNY',
) {
  const value = Number(amount ?? 0);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatNumber(
  value: number | string | null | undefined,
  locale: Language = 'zh-CN',
  maximumFractionDigits = 4,
) {
  const numeric = Number(value ?? 0);
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

export function formatDateTime(value: string | Date | null | undefined, locale: Language = 'zh-CN') {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
