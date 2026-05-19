import { create } from 'zustand';

export interface User {
  id: string;
  email?: string;
  name?: string;
  username?: string;
  role?: string;
}

export interface Company {
  id: string;
  name: string;
  role: string;
  permissions?: string[];
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  companies: Company[];
  currentCompanyId: string | null;
  setAuth: (
    token: string,
    user: User,
    companies: Company[],
    refreshToken?: string | null,
  ) => void;
  setCurrentCompany: (companyId: string) => void;
  refreshPermissions: () => Promise<void>;
  logout: () => void;
}

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000/api';

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isJwtTokenLikelyValid(token: string | null): boolean {
  if (!token) {
    return false;
  }

  const jwtPattern = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/;
  if (!jwtPattern.test(token)) {
    return false;
  }

  try {
    const payloadBase64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadBase64.padEnd(Math.ceil(payloadBase64.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded)) as { exp?: number };

    if (typeof decoded.exp !== 'number') {
      return true;
    }

    return decoded.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

function getInitialAuthState() {
  if (typeof window === 'undefined') {
    return {
      token: null,
      refreshToken: null,
      user: null,
      companies: [] as Company[],
      currentCompanyId: null,
    };
  }

  const token = localStorage.getItem('token');
  const refreshToken = localStorage.getItem('refreshToken');
  const user = safeParse<User | null>(localStorage.getItem('user'), null);
  const companies = safeParse<Company[]>(localStorage.getItem('companies'), []);
  const currentCompanyId = localStorage.getItem('currentCompanyId');
  const hasCurrentCompany = !!currentCompanyId && companies.some((c) => c.id === currentCompanyId);
  const resolvedCompanyId = hasCurrentCompany
    ? currentCompanyId
    : (companies.length > 0 ? companies[0].id : null);

  // 防止本地脏缓存导致未登录用户进入面板后触发无意义 403 请求
  if (
    (!isJwtTokenLikelyValid(token) && !refreshToken) ||
    !user ||
    companies.length === 0 ||
    !resolvedCompanyId
  ) {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    localStorage.removeItem('companies');
    localStorage.removeItem('currentCompanyId');

    return {
      token: null,
      refreshToken: null,
      user: null,
      companies: [],
      currentCompanyId: null,
    };
  }

  if (resolvedCompanyId) {
    localStorage.setItem('currentCompanyId', resolvedCompanyId);
  }

  return {
    token,
    refreshToken,
    user,
    companies,
    currentCompanyId: resolvedCompanyId,
  };
}

const initialState = getInitialAuthState();

export const useAuthStore = create<AuthState>((set) => ({
  token: initialState.token,
  refreshToken: initialState.refreshToken,
  user: initialState.user,
  companies: initialState.companies,
  currentCompanyId: initialState.currentCompanyId,

  setAuth: (token, user, companies, refreshToken) => {
    const previousCompanyId = useAuthStore.getState().currentCompanyId;
    localStorage.setItem('token', token);
    if (refreshToken !== undefined) {
      if (refreshToken) {
        localStorage.setItem('refreshToken', refreshToken);
      } else {
        localStorage.removeItem('refreshToken');
      }
    }
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('companies', JSON.stringify(companies));
    
    const defaultCompanyId =
      previousCompanyId && companies.some((company) => company.id === previousCompanyId)
        ? previousCompanyId
        : (companies.length > 0 ? companies[0].id : null);
    if (defaultCompanyId) {
      localStorage.setItem('currentCompanyId', defaultCompanyId);
    }

    set({
      token,
      refreshToken: refreshToken === undefined
        ? useAuthStore.getState().refreshToken
        : refreshToken,
      user,
      companies,
      currentCompanyId: defaultCompanyId,
    });
  },

  setCurrentCompany: (companyId) => {
    localStorage.setItem('currentCompanyId', companyId);
    set({ currentCompanyId: companyId });
  },

  refreshPermissions: async () => {
    const state = useAuthStore.getState();
    if (!state.token || !state.currentCompanyId) return;

    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/users/permissions/me`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
        'x-company-id': state.currentCompanyId,
        Accept: 'application/json',
      },
    });

    if (response.status === 401 || response.status === 403) {
      state.logout();
      throw new Error('AUTH_REFRESH_FORBIDDEN');
    }
    if (!response.ok) return;

    const payload = (await response.json()) as {
      role?: { id: string; name: string };
      permissions?: string[];
    };
    const nextCompanies = state.companies.map((company) =>
      company.id === state.currentCompanyId
        ? {
            ...company,
            role: payload.role?.name ?? company.role,
            permissions: payload.permissions ?? company.permissions,
          }
        : company,
    );
    localStorage.setItem('companies', JSON.stringify(nextCompanies));
    set({ companies: nextCompanies });
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    localStorage.removeItem('companies');
    localStorage.removeItem('currentCompanyId');
    set({
      token: null,
      refreshToken: null,
      user: null,
      companies: [],
      currentCompanyId: null,
    });
  },
}));
