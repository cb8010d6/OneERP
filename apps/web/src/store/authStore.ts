import { create } from 'zustand';

export interface User {
  id: string;
  username: string;
  role: string;
}

export interface Company {
  id: string;
  name: string;
  role: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  companies: Company[];
  currentCompanyId: string | null;
  setAuth: (token: string, user: User, companies: Company[]) => void;
  setCurrentCompany: (companyId: string) => void;
  logout: () => void;
}

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

    if (!decoded.exp) {
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
      user: null,
      companies: [] as Company[],
      currentCompanyId: null,
    };
  }

  const token = localStorage.getItem('token');
  const user = safeParse<User | null>(localStorage.getItem('user'), null);
  const companies = safeParse<Company[]>(localStorage.getItem('companies'), []);
  const currentCompanyId = localStorage.getItem('currentCompanyId');
  const hasCurrentCompany = !!currentCompanyId && companies.some((c) => c.id === currentCompanyId);
  const resolvedCompanyId = hasCurrentCompany
    ? currentCompanyId
    : (companies.length > 0 ? companies[0].id : null);

  // 防止本地脏缓存导致未登录用户进入面板后触发无意义 403 请求
  if (!isJwtTokenLikelyValid(token) || !user || companies.length === 0 || !resolvedCompanyId) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('companies');
    localStorage.removeItem('currentCompanyId');

    return {
      token: null,
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
    user,
    companies,
    currentCompanyId: resolvedCompanyId,
  };
}

const initialState = getInitialAuthState();

export const useAuthStore = create<AuthState>((set) => ({
  token: initialState.token,
  user: initialState.user,
  companies: initialState.companies,
  currentCompanyId: initialState.currentCompanyId,

  setAuth: (token, user, companies) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('companies', JSON.stringify(companies));
    
    // 默认选中第一个公司
    const defaultCompanyId = companies.length > 0 ? companies[0].id : null;
    if (defaultCompanyId) {
      localStorage.setItem('currentCompanyId', defaultCompanyId);
    }

    set({ token, user, companies, currentCompanyId: defaultCompanyId });
  },

  setCurrentCompany: (companyId) => {
    localStorage.setItem('currentCompanyId', companyId);
    set({ currentCompanyId: companyId });
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('companies');
    localStorage.removeItem('currentCompanyId');
    set({ token: null, user: null, companies: [], currentCompanyId: null });
  },
}));
