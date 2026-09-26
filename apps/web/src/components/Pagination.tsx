'use client';

import { useI18n } from '@/lib/i18n';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ page, totalPages, total, onPageChange }: PaginationProps) {
  const { t, locale } = useI18n();
  if (total === 0) return null;
  
  return (
    <nav aria-label={t('paginationLabel')} className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-3 py-3 sm:px-6">
      <p className="text-sm tabular-nums text-gray-500" aria-live="polite">{total.toLocaleString(locale)} {t('paginationRecords')}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="min-h-9 px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:outline-offset-2"
        >
          {t('paginationPrevious')}
        </button>
        <span aria-label={t('paginationPage')} aria-live="polite" className="whitespace-nowrap text-sm tabular-nums text-gray-700">{page} / {totalPages > 0 ? totalPages : 1}</span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="min-h-9 px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:outline-offset-2"
        >
          {t('paginationNext')}
        </button>
      </div>
    </nav>
  );
}
