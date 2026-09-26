import axios, { AxiosError, AxiosHeaders } from 'axios';
import { useAuthStore, getCsrfTokenFromCookie } from '../store/authStore';
import { resolvePublicApiBaseUrl } from './public-api-base';

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    _retry?: boolean;
    _authContext?: {
      companyId: string | null;
      userId: string | undefined;
      version: number;
    };
  }
}

export function readApiError(reason: unknown, fallback: string): string {
  if (
    typeof reason !== 'object' ||
    reason === null ||
    !('response' in reason)
  ) {
    return fallback;
  }

  const response = (reason as { response?: { data?: { message?: unknown } } })
    .response;
  return typeof response?.data?.message === 'string'
    ? response.data.message
    : fallback;
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

const baseURL = resolvePublicApiBaseUrl();

const api = axios.create({
  baseURL,
  timeout: 10000,
  withCredentials: true,
});

let pendingRefresh: {
  token: string | null;
  userId: string | undefined;
  promise: Promise<string | null>;
} | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const initialState = useAuthStore.getState();
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
    companies: Array<{
      id: string;
      name: string;
      role: string;
      permissions?: string[];
    }>;
  };
  const current = useAuthStore.getState();
  if (
    current.token !== initialState.token ||
    current.user?.id !== initialState.user?.id ||
    (initialState.user && user.id !== initialState.user.id)
  )
    return null;
  current.setAuth(accessToken, user, companies);
  return accessToken;
}

function isAuthRequest(url?: string) {
  return /^\/auth(?:\/|\?|$)/.test(url ?? '');
}

function isCurrentContext(config?: import('axios').InternalAxiosRequestConfig) {
  if (!config?._authContext) return true;
  const current = useAuthStore.getState();
  return (
    config._authContext.companyId === current.currentCompanyId &&
    config._authContext.userId === current.user?.id &&
    config._authContext.version === current.contextVersion
  );
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
    const authRequest = isAuthRequest(config.url);
    if (!isCurrentContext(config)) {
      return Promise.reject(
        new AxiosError(
          '公司或登录状态已变更，请重新操作。',
          'ERR_AUTH_CONTEXT_CHANGED',
          config,
        ),
      );
    }
    let companyId = state.currentCompanyId;

    const headers = AxiosHeaders.from(config.headers);

    if (!companyId && state.companies.length > 0) {
      companyId = state.companies[0].id;
      state.setCurrentCompany(companyId);
    }

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (!authRequest && companyId) {
      headers.set('x-company-id', companyId);
    }

    const method = (config.method ?? 'get').toLowerCase();
    if (['post', 'put', 'patch', 'delete'].includes(method)) {
      const csrf = getCsrfTokenFromCookie();
      if (csrf) {
        headers.set('x-csrf-token', csrf);
      }
    }

    if (!authRequest && (!token || !companyId)) {
      void useAuthStore.getState().logout().then(navigateToLogin);
      return Promise.reject(
        new AxiosError(
          '缺少有效登录态或公司上下文，已阻止请求。',
          'ERR_AUTH_CONTEXT_INVALID',
          config,
        ),
      );
    }

    if (!authRequest && !config._authContext) {
      config._authContext = {
        companyId,
        userId: state.user?.id,
        version: useAuthStore.getState().contextVersion,
      };
    }
    config.headers = headers;
    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => {
    if (!isCurrentContext(response.config)) {
      return Promise.reject(
        new AxiosError(
          '公司或登录状态已变更，请重新操作。',
          'ERR_AUTH_CONTEXT_CHANGED',
          response.config,
        ),
      );
    }
    return response;
  },
  async (error) => {
    const originalConfig = error.config;
    if (
      isAuthRequest(originalConfig?.url) ||
      !isCurrentContext(originalConfig)
    ) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401) {
      const isRefreshRequest = String(originalConfig?.url ?? '').includes(
        '/auth/refresh',
      );
      if (originalConfig && !originalConfig._retry && !isRefreshRequest) {
        originalConfig._retry = true;
        try {
          const current = useAuthStore.getState();
          if (
            !pendingRefresh ||
            pendingRefresh.token !== current.token ||
            pendingRefresh.userId !== current.user?.id
          ) {
            pendingRefresh = {
              token: current.token,
              userId: current.user?.id,
              promise: refreshAccessToken(),
            };
          }
          const refresh = pendingRefresh;
          const nextToken = await refresh.promise.finally(() => {
            if (pendingRefresh === refresh) pendingRefresh = null;
          });
          if (!isCurrentContext(originalConfig)) return Promise.reject(error);
          if (nextToken) {
            const headers = AxiosHeaders.from(originalConfig.headers);
            headers.set('Authorization', `Bearer ${nextToken}`);
            originalConfig.headers = headers;
            return api.request(originalConfig);
          }
        } catch {
          // The original failure is returned after session recovery fails.
        }
      }

      if (isCurrentContext(originalConfig)) {
        void useAuthStore.getState().logout().then(navigateToLogin);
      }
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
