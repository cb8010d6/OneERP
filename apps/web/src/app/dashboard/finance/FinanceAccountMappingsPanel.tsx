'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Save } from 'lucide-react';
import api from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useAuthStore } from '@/store/authStore';

type AccountOption = {
  id: string;
  code: string;
  name: string;
  type: string;
};

type AccountMapping = {
  key: string;
  label: string;
  defaultAccount: {
    code: string;
    name: string;
    type: string;
  };
  account: AccountOption | null;
};

function readApiError(reason: unknown, fallback: string) {
  if (reason && typeof reason === 'object' && 'response' in reason) {
    const response = (reason as { response?: { data?: { message?: unknown } } })
      .response;
    if (typeof response?.data?.message === 'string') {
      return response.data.message;
    }
  }
  return fallback;
}

function accountLabel(account: AccountOption) {
  return `${account.code} ${account.name} / ${account.type}`;
}

export function FinanceAccountMappingsPanel() {
  const { t } = useI18n();
  const { currentCompanyId } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [mappings, setMappings] = useState<AccountMapping[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedByKey, setSelectedByKey] = useState<Record<string, string>>(
    {},
  );

  const accountByCode = useMemo(() => {
    return new Map(accounts.map((account) => [account.code, account]));
  }, [accounts]);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    setLoading(true);
    setError('');
    try {
      const [mappingResponse, accountResponse] = await Promise.all([
        api.get<AccountMapping[]>('/finance/account-mappings'),
        api.get<AccountOption[]>('/finance/account-options'),
      ]);
      setMappings(mappingResponse.data);
      setAccounts(accountResponse.data);
      const nextSelected: Record<string, string> = {};
      for (const mapping of mappingResponse.data) {
        const defaultAccount = accountResponse.data.find(
          (account) => account.code === mapping.defaultAccount.code,
        );
        nextSelected[mapping.key] =
          mapping.account?.id ?? defaultAccount?.id ?? '';
      }
      setSelectedByKey(nextSelected);
    } catch (reason: unknown) {
      setError(readApiError(reason, t('financeMappingsLoadFailed')));
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const payload = mappings.map((mapping) => ({
      key: mapping.key,
      accountId: selectedByKey[mapping.key],
    }));

    if (payload.some((item) => !item.accountId)) {
      setError(t('financeMappingsMissingAccount'));
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await api.post<AccountMapping[]>(
        '/finance/account-mappings',
        { mappings: payload },
      );
      setMappings(response.data);
      setMessage(t('financeMappingsSaved'));
    } catch (reason: unknown) {
      setError(readApiError(reason, t('financeMappingsSaveFailed')));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('loading')}
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">
          {t('financeMappingsTitle')}
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
            title={t('commonRefresh')}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || mappings.length === 0}
            className="inline-flex items-center justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {saving ? t('commonSaving') : t('commonSave')}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {message}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {mappings.map((mapping) => {
          const fallback = accountByCode.get(mapping.defaultAccount.code);
          return (
            <label key={mapping.key} className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">
                {mapping.label}
              </span>
              <select
                value={selectedByKey[mapping.key] ?? fallback?.id ?? ''}
                onChange={(event) =>
                  setSelectedByKey((prev) => ({
                    ...prev,
                    [mapping.key]: event.target.value,
                  }))
                }
                className="rounded-md border border-slate-300 p-2 text-sm"
              >
                <option value="">{t('selectPlaceholder')}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountLabel(account)}
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-500">
                {t('financeMappingsDefault')}: {mapping.defaultAccount.code}{' '}
                {mapping.defaultAccount.name}
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
