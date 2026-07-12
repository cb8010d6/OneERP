"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../store/authStore';
import api, { readApiError } from '../../lib/api';
import { Building2, Lock, Mail } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

export default function LoginPage() {
  const { language, setLanguage, t } = useI18n();
  const [email, setEmail] = useState(
    process.env.NEXT_PUBLIC_DEFAULT_LOGIN_EMAIL ?? 'admin@oneerp.local',
  );
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await api.post('/auth/login', { email, password });
      
      const { accessToken, user, companies } = res.data;
      
      setAuth(accessToken, user, companies);
      
      router.push('/dashboard');
    } catch (reason: unknown) {
      setError(readApiError(reason, t('loginFailed')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="bg-slate-900 p-6 text-white text-center">
          <Building2 className="w-12 h-12 mx-auto mb-4 text-blue-400" />
          <h1 className="text-2xl font-bold">{t('loginTitle')}</h1>
          <p className="text-slate-400 text-sm mt-2">{t('loginSubtitle')}</p>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as 'zh-CN' | 'en-US')}
            className="mt-4 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white"
            aria-label="Language"
          >
            <option value="zh-CN">{t('languageChinese')}</option>
            <option value="en-US">{t('languageEnglish')}</option>
          </select>
        </div>
        
        <form onSubmit={handleLogin} className="p-8 space-y-6">
          {error && (
            <div className="bg-red-50 text-red-500 p-3 rounded-lg text-sm mb-4 border border-red-100">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">{t('loginAccount')}</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="text"
                required
                className="pl-10 w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-slate-900"
                placeholder={t('loginPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">{t('loginPassword')}</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="password"
                required
                className="pl-10 w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-slate-900"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {t('loginHint')}
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white p-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {loading ? t('loginSubmitting') : t('loginSubmit')}
          </button>
        </form>
      </div>
    </div>
  );
}
