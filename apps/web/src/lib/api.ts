import axios, { AxiosError, AxiosHeaders } from 'axios';
import { useAuthStore, getCsrfTokenFromCookie } from '../store/authStore';

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    _retry?: boolean;
  }
}

function sanitizePaginationInUrl(url?: string): string | undefined {
  if (!url) return url;

  try {
    const parsed = new URL(url, 'http://local');
    const page = parsed.searchParams.get('page');
    const limit = parsed.searchParams.get('limit');

    if (page !== null) {
      const pageNum = Number(page);
      if (!Number.isInteger(pageNum) || pageNum < 1) {
        parsed.searchParams.set('page', '1');
      }
    }

    if (limit !== null) {
      const limitNum = Number(limit);
      if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > 100) {
        parsed.searchParams.set('limit', '20');
      }
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

const baseURL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000/api';

const api = axios.create({
  baseURL,
  timeout: 10000,
  withCredentials: true,
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const csrf = getCsrfTokenFromCookie();
  if (!csrf) return null;

  const response = await axios.post(
    `${baseURL.replace(/\/$/, '')}/auth/refresh`,
    {},
    { withCredentials: true, headers: { 'x-csrf-token': csrf } },
  );
  const { accessToken, user, companies } = response.data as {
    accessToken: string;
    user: { id: string; email?: string; name?: string };
    companies: Array<{ id: string; name: string; role: string; permissions?: string[] }>;
  };
  useAuthStore.getState().setAuth(accessToken, user, companies);
  return accessToken;
}

function navigateToLogin() {
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

api.interceptors.request.use(
  (config) => {
    config.url = sanitizePaginationInUrl(config.url);

    const state = useAuthStore.getState();
    const token = state.token;
    const isAuthRequest = config.url?.startsWith('/auth') ?? false;
    let companyId = state.currentCompanyId;

    const headers = AxiosHeaders.from(config.headers);

    if (!companyId && state.companies.length > 0) {
      companyId = state.companies[0].id;
      state.setCurrentCompany(companyId);
    }

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (!isAuthRequest && companyId) {
      headers.set('x-company-id', companyId);
    }

    const method = (config.method ?? 'get').toLowerCase();
    if (['post', 'put', 'patch', 'delete'].includes(method)) {
      const csrf = getCsrfTokenFromCookie();
      if (csrf) {
        headers.set('x-csrf-token', csrf);
      }
    }

    if (!isAuthRequest && (!token || !companyId)) {
      void useAuthStore.getState().logout().then(navigateToLogin);
      return Promise.reject(
        new AxiosError(
          '缺少有效登录态或公司上下文，已阻止请求。',
          'ERR_AUTH_CONTEXT_INVALID',
          config,
        ),
      );
    }

    config.headers = headers;
    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalConfig = error.config;

    if (error.response?.status === 401) {
      const isRefreshRequest = String(originalConfig?.url ?? '').includes(
        '/auth/refresh',
      );
      if (originalConfig && !originalConfig._retry && !isRefreshRequest) {
        originalConfig._retry = true;
        try {
          refreshPromise = refreshPromise ?? refreshAccessToken();
          const nextToken = await refreshPromise;
          refreshPromise = null;
          if (nextToken) {
            const headers = AxiosHeaders.from(originalConfig.headers);
            headers.set('Authorization', `Bearer ${nextToken}`);
            originalConfig.headers = headers;
            return api.request(originalConfig);
          }
        } catch {
          refreshPromise = null;
        }
      }

      void useAuthStore.getState().logout().then(navigateToLogin);
    }

    if (error.response?.status === 403) {
      const message = String(error.response?.data?.message || '');
      const isTenantOrAuthContextError =
        message.includes('x-company-id') ||
        message.includes('无权访问') ||
        message.includes('非法操作') ||
        message.includes('尚未登录');

      if (isTenantOrAuthContextError) {
        void useAuthStore.getState().logout().then(navigateToLogin);
      }
    }

    return Promise.reject(error);
  },
);

export default api;
