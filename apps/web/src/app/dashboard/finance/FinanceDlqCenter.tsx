'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { clsx } from 'clsx';
import api from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface DlqItem {
  id: string;
  eventName: string;
  idempotencyKey?: string | null;
  status: string;
  attempts: number;
  maxAttempts: number;
  error?: string | null;
  nextRetryAt?: string | null;
  updatedAt?: string | null;
}

interface RetryResult {
  total: number;
  results: Array<{ id: string; status: string; error?: string }>;
}

function statusTone(status: string) {
  if (status === 'RESOLVED') return 'bg-emerald-50 text-emerald-700';
  if (status === 'FAILED') return 'bg-red-50 text-red-700';
  if (status === 'RETRYING') return 'bg-blue-50 text-blue-700';
  return 'bg-amber-50 text-amber-700';
}

export function FinanceDlqCenter() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<DlqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<RetryResult | null>(null);

  const stats = useMemo(() => {
    return {
      total: items.length,
      failed: items.filter((item) => item.status === 'FAILED').length,
      pending: items.filter((item) =>
        ['PENDING', 'RETRYING'].includes(item.status),
      ).length,
    };
  }, [items]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get<DlqItem[]>('/finance/dlq', {
        params: { limit: 50 },
      });
      setItems(response.data);
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response
              ?.data?.message
          : undefined;
      setError(message || t('financeDlqLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const retry = async () => {
    try {
      setRetrying(true);
      setError(null);
      const response = await api.post<RetryResult>('/finance/dlq/retry', {
        limit: 20,
      });
      setLastResult(response.data);
      await load();
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response
              ?.data?.message
          : undefined;
      setError(message || t('financeDlqRetryFailed'));
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-slate-500">{t('financeDlqLoading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {t('financeDlqTotal')}
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-amber-700">
            {t('financeDlqPending')}
          </p>
          <p className="mt-1 text-2xl font-bold text-amber-900">
            {stats.pending}
          </p>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50/60 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-red-700">
            {t('financeDlqFailed')}
          </p>
          <p className="mt-1 text-2xl font-bold text-red-900">{stats.failed}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {t('financeDlqTitle')}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{t('financeDlqHint')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <RotateCcw className="h-4 w-4" />
            {t('commonRefresh')}
          </button>
          <button
            onClick={retry}
            disabled={retrying || stats.pending === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {retrying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {t('financeDlqRetry')}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {lastResult ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
          {t('financeDlqRetryResult')}: {lastResult.total}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          <p className="text-sm text-slate-500">{t('financeDlqEmpty')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">{t('financeDlqEvent')}</th>
                <th className="px-4 py-3">{t('financeDlqStatus')}</th>
                <th className="px-4 py-3">{t('financeDlqAttempts')}</th>
                <th className="px-4 py-3">{t('financeDlqNextRetry')}</th>
                <th className="px-4 py-3">{t('financeDlqError')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">
                      {item.eventName}
                    </div>
                    <div className="mt-1 max-w-xs truncate font-mono text-xs text-slate-400">
                      {item.idempotencyKey || item.id}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={clsx(
                        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                        statusTone(item.status),
                      )}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600">
                    {item.attempts}/{item.maxAttempts}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {item.nextRetryAt
                      ? new Intl.DateTimeFormat(locale, {
                          dateStyle: 'short',
                          timeStyle: 'medium',
                        }).format(new Date(item.nextRetryAt))
                      : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex max-w-xl gap-2 text-red-700">
                      {item.error ? (
                        <>
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span className="break-words">{item.error}</span>
                        </>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
