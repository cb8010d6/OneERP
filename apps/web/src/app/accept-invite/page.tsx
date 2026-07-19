'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2 } from 'lucide-react';
import api, { readApiError } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { useI18n } from '@/lib/i18n';

export default function AcceptInvitePage() {
  const { t } = useI18n();
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') ?? '');
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!token) {
      setError(t('inviteMissingToken'));
      return;
    }
    if (password.length < 6) {
      setError(t('invitePasswordTooShort'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('invitePasswordMismatch'));
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/auth/accept-invite', {
        token,
        password,
        name: name || undefined,
      });
      const { accessToken, user, companies } = response.data;
      setAuth(accessToken, user, companies);
      router.push('/dashboard');
    } catch (reason: unknown) {
      setError(readApiError(reason, t('inviteFailed')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-cyan-50 p-2 text-cyan-700">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{t('inviteTitle')}</h1>
            <p className="text-sm text-slate-500">{t('inviteSubtitle')}</p>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder={t('inviteName')}
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder={t('invitePassword')}
          required
        />
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder={t('inviteConfirmPassword')}
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          {t('inviteSubmit')}
        </button>
      </form>
    </div>
  );
}
