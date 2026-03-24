import axios, { AxiosHeaders, AxiosError } from 'axios';
import { useAuthStore } from '../store/authStore';

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

// 创建可以复用的 axios 实例
const api = axios.create({
  baseURL: 'http://127.0.0.1:8000/api', // 这里对应我们刚才黑窗口启动的 NestJS 核心的 api 路由
  timeout: 10000,
});

// 请求拦截器：防屎山核心 - 自动为主管带上身份证明(Token)和当前所处的公司阵营(X-Company-Id)
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
    
    // 如果该请求不是 auth/login 这种接口，必须带上当前公司 ID
    if (!isAuthRequest && companyId) {
      headers.set('x-company-id', companyId);
    }

    if (!isAuthRequest && (!token || !companyId)) {
      useAuthStore.getState().logout();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
      return Promise.reject(new AxiosError('缺少有效登录态或公司上下文，已阻止请求。', 'ERR_AUTH_CONTEXT_INVALID', config));
    }

    config.headers = headers;

    return config;
  },
  (error) => Promise.reject(error)
);

// 响应拦截器：当 Token 过期或者无权限时，强制踢回登录页
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // 401 未授权
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }

    if (error.response?.status === 403) {
      const message = String(error.response?.data?.message || '');
      const isTenantOrAuthContextError =
        message.includes('x-company-id') ||
        message.includes('无权访问') ||
        message.includes('非法操作') ||
        message.includes('尚未登录');

      if (isTenantOrAuthContextError) {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default api;
