import axios, { AxiosHeaders, AxiosError } from "axios";
import { useAuthStore } from "../store/authStore";

function sanitizePaginationInUrl(url?: string): string | undefined {
  if (!url) return url;

  try {
    const parsed = new URL(url, "http://local");
    const page = parsed.searchParams.get("page");
    const limit = parsed.searchParams.get("limit");

    if (page !== null) {
      const pageNum = Number(page);
      if (!Number.isInteger(pageNum) || pageNum < 1) {
        parsed.searchParams.set("page", "1");
      }
    }

    if (limit !== null) {
      const limitNum = Number(limit);
      if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > 100) {
        parsed.searchParams.set("limit", "20");
      }
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function getDefaultApiBaseUrl(): string {
  return "/api/proxy";
}

// API 基础地址：优先读取环境变量，未配置时走 Next.js 同源代理，避免浏览器 CSP/CORS 差异。
const configuredBaseURL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
const baseURL = configuredBaseURL || getDefaultApiBaseUrl();

const api = axios.create({
  baseURL,
  timeout: 10000,
});

// 自动附加访问令牌和当前公司上下文，确保多租户请求具备明确边界。
api.interceptors.request.use(
  (config) => {
    config.url = sanitizePaginationInUrl(config.url);

    const state = useAuthStore.getState();
    const token = state.token;
    const isAuthRequest = config.url?.startsWith("/auth") ?? false;
    let companyId = state.currentCompanyId;

    const headers = AxiosHeaders.from(config.headers);

    if (!companyId && state.companies.length > 0) {
      companyId = state.companies[0].id;
      state.setCurrentCompany(companyId);
    }

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    if (!isAuthRequest && companyId) {
      headers.set("x-company-id", companyId);
    }

    if (!isAuthRequest && (!token || !companyId)) {
      useAuthStore.getState().logout();
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      return Promise.reject(
        new AxiosError(
          "缺少有效登录态或公司上下文，已阻止请求。",
          "ERR_AUTH_CONTEXT_INVALID",
          config,
        ),
      );
    }

    config.headers = headers;

    return config;
  },
  (error) => Promise.reject(error),
);

// 访问令牌失效或租户上下文非法时，清理本地登录态并回到登录页。
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // 401 未授权
      useAuthStore.getState().logout();
      window.location.href = "/login";
    }

    if (error.response?.status === 403) {
      const message = String(error.response?.data?.message || "");
      const isTenantOrAuthContextError =
        message.includes("x-company-id") ||
        message.includes("无权访问") ||
        message.includes("非法操作") ||
        message.includes("尚未登录");

      if (isTenantOrAuthContextError) {
        useAuthStore.getState().logout();
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  },
);

export default api;
