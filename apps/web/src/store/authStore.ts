import { create } from 'zustand';
import { resolvePublicApiBaseUrl } from '../lib/public-api-base';

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
  contextVersion: number;
  token: string | null;
  user: User | null;
  companies: Company[];
  currentCompanyId: string | null;
  setAuth: (token: string, user: User, companies: Company[]) => void;
  setCurrentCompany: (companyId: string) => void;
  refreshPermissions: () => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<boolean>;
}

const apiBaseUrl = resolvePublicApiBaseUrl();

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

export function isJwtTokenLikelyValid(token: string | null): boolean {
  if (!token) {
    return false;
  }

  const jwtPattern = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/;
  if (!jwtPattern.test(token)) {
    return false;
  }

  try {
    const payloadBase64 = token
      .split('.')[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padded = payloadBase64.padEnd(
      Math.ceil(payloadBase64.length / 4) * 4,
      '=',
    );
    const decoded = JSON.parse(atob(padded)) as { exp?: number };

    if (typeof decoded.exp !== 'number') {
      return true;
    }

    return decoded.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function getCsrfTokenFromCookie(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function fetchCSRF(): Promise<string> {
  const existing = getCsrfTokenFromCookie();
  if (existing) return existing;
  try {
    const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/auth/csrf`, {
      credentials: 'include',
    });
    if (!res.ok) return '';
    const data = (await res.json()) as { csrfToken?: string };
    return data.csrfToken ?? '';
  } catch {
    return '';
  }
}

function clearLocalAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('companies');
  localStorage.removeItem('currentCompanyId');
  useAuthStore.setState({
    contextVersion: useAuthStore.getState().contextVersion + 1,
    token: null,
    user: null,
    companies: [],
    currentCompanyId: null,
  });
}

function loadPersistedAuth() {
  if (typeof window === 'undefined') {
    return {
      token: null as string | null,
      user: null as User | null,
      companies: [] as Company[],
      currentCompanyId: null as string | null,
    };
  }

  const token = localStorage.getItem('token');
  const user = safeParse<User | null>(localStorage.getItem('user'), null);
  const companies = safeParse<Company[]>(localStorage.getItem('companies'), []);
  const currentCompanyId = localStorage.getItem('currentCompanyId');
  const hasCurrentCompany =
    !!currentCompanyId && companies.some((c) => c.id === currentCompanyId);
  const resolvedCompanyId = hasCurrentCompany
    ? currentCompanyId
    : companies.length > 0
      ? companies[0].id
      : null;

  if (resolvedCompanyId) {
    localStorage.setItem('currentCompanyId', resolvedCompanyId);
  }

  return {
    token,
    user,
    companies,
    currentCompanyId: resolvedCompanyId,
  };
}

const initial = loadPersistedAuth();

export const useAuthStore = create<AuthState>((set) => ({
  contextVersion: 0,
  token: initial.token,
  user: initial.user,
  companies: initial.companies,
  currentCompanyId: initial.currentCompanyId,

  setAuth: (token, user, companies) => {
    const previous = useAuthStore.getState();
    const previousCompanyId = previous.currentCompanyId;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('companies', JSON.stringify(companies));

    const defaultCompanyId =
      previousCompanyId &&
      companies.some((company) => company.id === previousCompanyId)
        ? previousCompanyId
        : companies.length > 0
          ? companies[0].id
          : null;
    if (defaultCompanyId) {
      localStorage.setItem('currentCompanyId', defaultCompanyId);
    } else {
      localStorage.removeItem('currentCompanyId');
    }

    set({
      contextVersion:
        previous.contextVersion +
        (previous.user?.id !== user.id || previousCompanyId !== defaultCompanyId
          ? 1
          : 0),
      token,
      user,
      companies,
      currentCompanyId: defaultCompanyId,
    });
  },

  setCurrentCompany: (companyId) => {
    const state = useAuthStore.getState();
    if (
      companyId === state.currentCompanyId ||
      !state.companies.some((company) => company.id === companyId)
    )
      return;
    localStorage.setItem('currentCompanyId', companyId);
    set({
      currentCompanyId: companyId,
      contextVersion: state.contextVersion + 1,
    });
  },

  refreshPermissions: async () => {
    const state = useAuthStore.getState();
    if (!state.token || !state.currentCompanyId) return;

    const response = await fetch(
      `${apiBaseUrl.replace(/\/$/, '')}/users/permissions/me`,
      {
        headers: {
          Authorization: `Bearer ${state.token}`,
          'x-company-id': state.currentCompanyId,
          Accept: 'application/json',
        },
        credentials: 'include',
      },
    );

    const isCurrent = () => {
      const current = useAuthStore.getState();
      return (
        current.contextVersion === state.contextVersion &&
        current.token === state.token
      );
    };
    if (!isCurrent()) return;

    if (response.status === 401 || response.status === 403) {
      await state.logout();
      throw new Error('AUTH_REFRESH_FORBIDDEN');
    }
    if (!response.ok) return;

    const payload = (await response.json()) as {
      role?: { id: string; name: string };
      permissions?: string[];
    };
    if (!isCurrent()) return;
    const nextCompanies = useAuthStore.getState().companies.map((company) =>
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

  restoreSession: async () => {
    const initialState = useAuthStore.getState();
    const isCurrent = () => {
      const current = useAuthStore.getState();
      return (
        current.contextVersion === initialState.contextVersion &&
        current.token === initialState.token
      );
    };
    const csrf = await fetchCSRF();
    if (!csrf || !isCurrent()) return false;

    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': csrf },
      });
      if (!res.ok) return false;

      const data = (await res.json()) as {
        accessToken: string;
        user: User;
        companies: Company[];
      };
      if (!isCurrent()) return false;
      useAuthStore
        .getState()
        .setAuth(data.accessToken, data.user, data.companies);
      return true;
    } catch {
      return false;
    }
  },

  logout: async () => {
    clearLocalAuth();

    try {
      const csrf = getCsrfTokenFromCookie();
      void fetch(`${apiBaseUrl.replace(/\/$/, '')}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': csrf },
      }).catch(() => undefined);
    } catch {
      // best-effort
    }
  },
}));
