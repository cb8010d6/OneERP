'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, KeyRound, Loader2, PlugZap, Save } from 'lucide-react';
import api from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useAuthStore } from '@/store/authStore';

type AIProvider = 'openai-compatible' | 'anthropic-compatible';

type AISettingsResponse = {
  provider: AIProvider;
  baseUrl: string;
  defaultModel: string;
  proModel: string;
  useProForSql: boolean;
  useProForDocuments: boolean;
  hasApiKey: boolean;
  apiKeyPreview?: string;
  apiKeySource: 'company' | 'environment' | 'none';
};

const DEFAULT_MODELS = ['mimo-v2.5', 'mimo-v2.5-pro'];

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

export function AISettingsPanel() {
  const { t } = useI18n();
  const { currentCompanyId } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [settings, setSettings] = useState<AISettingsResponse | null>(null);
  const [form, setForm] = useState({
    provider: 'openai-compatible' as AIProvider,
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
    defaultModel: 'mimo-v2.5',
    proModel: 'mimo-v2.5-pro',
    useProForSql: true,
    useProForDocuments: true,
  });

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.get<AISettingsResponse>('/v1/ai/settings');
      const data = response.data;
      setSettings(data);
      setForm({
        provider: data.provider,
        baseUrl: data.baseUrl,
        defaultModel: data.defaultModel,
        proModel: data.proModel,
        useProForSql: data.useProForSql,
        useProForDocuments: data.useProForDocuments,
      });
    } catch (reason: unknown) {
      setError(readApiError(reason, t('settingsAiLoadFailed')));
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const buildPayload = () => ({
    ...form,
    apiKey: apiKey.trim() || undefined,
    clearApiKey,
  });

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    setTestMessage('');
    setTestOk(null);
    try {
      const response = await api.put<AISettingsResponse>(
        '/v1/ai/settings',
        buildPayload(),
      );
      setSettings(response.data);
      setApiKey('');
      setClearApiKey(false);
      setMessage(t('settingsAiSaved'));
    } catch (reason: unknown) {
      setError(readApiError(reason, t('settingsAiSaveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setError('');
    setTestMessage('');
    setTestOk(null);
    try {
      const response = await api.post<{ ok: boolean; message: string }>(
        '/v1/ai/settings/test',
        buildPayload(),
      );
      setTestOk(response.data.ok);
      setTestMessage(
        response.data.message ||
          (response.data.ok
            ? t('settingsAiTestOk')
            : t('settingsAiTestFailed')),
      );
    } catch (reason: unknown) {
      setTestOk(false);
      setTestMessage(readApiError(reason, t('settingsAiTestFailed')));
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('loading')}
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5 sm:space-y-6">
      <div>
        <div className="flex items-center gap-2 border-b pb-2">
          <Bot className="h-5 w-5 text-blue-600" />
          <h3 className="min-w-0 truncate text-base font-bold text-gray-900 sm:text-lg">
            {t('settingsAiTitle')}
          </h3>
        </div>
        <p className="mt-2 text-sm text-gray-500">{t('settingsAiSubtitle')}</p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 md:gap-5">
        <label className="space-y-1">
          <span className="text-sm font-medium text-gray-700">
            {t('settingsAiProvider')}
          </span>
          <select
            value={form.provider}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                provider: event.target.value as AIProvider,
              }))
            }
            className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500"
          >
            <option value="openai-compatible">OpenAI compatible</option>
            <option value="anthropic-compatible">Anthropic compatible</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium text-gray-700">
            {t('settingsAiBaseUrl')}
          </span>
          <input
            type="url"
            value={form.baseUrl}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, baseUrl: event.target.value }))
            }
            className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500"
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium text-gray-700">
            {t('settingsAiDefaultModel')}
          </span>
          <input
            list="ai-default-models"
            value={form.defaultModel}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                defaultModel: event.target.value,
              }))
            }
            className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500"
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium text-gray-700">
            {t('settingsAiProModel')}
          </span>
          <input
            list="ai-default-models"
            value={form.proModel}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, proModel: event.target.value }))
            }
            className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500"
          />
        </label>
      </div>

      <datalist id="ai-default-models">
        {DEFAULT_MODELS.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.useProForSql}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                useProForSql: event.target.checked,
              }))
            }
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600"
          />
          <span className="min-w-0">{t('settingsAiUseProSql')}</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.useProForDocuments}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                useProForDocuments: event.target.checked,
              }))
            }
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600"
          />
          <span className="min-w-0">{t('settingsAiUseProDocs')}</span>
        </label>
      </div>

      <div className="space-y-3 border-t pt-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <KeyRound className="h-4 w-4 text-gray-500" />
            {t('settingsAiApiKey')}
          </div>
          <span className="min-w-0 break-all text-xs text-gray-500 sm:text-right">
            {settings?.hasApiKey
              ? `${t('settingsAiCurrentKey')}: ${
                  settings.apiKeyPreview || settings.apiKeySource
                }`
              : t('settingsAiNoKey')}
          </span>
        </div>
        <input
          type="password"
          value={apiKey}
          placeholder={t('settingsAiApiKeyPlaceholder')}
          onChange={(event) => {
            setApiKey(event.target.value);
            if (event.target.value) setClearApiKey(false);
          }}
          autoComplete="off"
          className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500"
        />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={clearApiKey}
            onChange={(event) => {
              setClearApiKey(event.target.checked);
              if (event.target.checked) setApiKey('');
            }}
            className="h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600"
          />
          <span className="min-w-0">{t('settingsAiClearKey')}</span>
        </label>
        <p className="text-xs text-gray-500">{t('settingsAiSecurityHint')}</p>
      </div>

      {testMessage ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            testOk
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-yellow-200 bg-yellow-50 text-yellow-800'
          }`}
        >
          {testMessage}
        </div>
      ) : null}

      <div className="grid gap-3 sm:flex sm:flex-wrap">
        <button
          type="button"
          onClick={testConnection}
          disabled={testing || saving}
          className="inline-flex w-full items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {testing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <PlugZap className="mr-2 h-4 w-4" />
          )}
          {testing ? t('settingsAiTesting') : t('settingsAiTest')}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || testing}
          className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
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
  );
}
