/**
 * authStore.ts — 最小回归测试
 *
 * 覆盖:
 *  1. setAuth 写入 localStorage + 更新状态
 *  2. setCurrentCompany 切换公司
 *  3. logout 同步清除所有状态和 localStorage，不阻塞服务端调用
 *  4. 过期 token 仍加载到状态（由 restoreSession 处理刷新）
 *  5. 无 token 初始状态
 *  6. 过期 token + csrf cookie + refresh 成功 → 不 logout
 *  7. csrf cookie 缺失 + refresh cookie 存在 → fetchCSRF 后 refresh
 */

const localStorageMock = (() => {
  let store: Record<string, string | null> = {};
  return {
    getItem: jest.fn((key: string): string | null => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: jest.fn((i: number) => Object.keys(store)[i] ?? null),
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

describe('authStore', () => {
  let useAuthStore: typeof import('../authStore').useAuthStore;

  beforeEach(async () => {
    jest.resetModules();
    localStorageMock.clear();
    jest.clearAllMocks();

    const mod = await import('../authStore');
    useAuthStore = mod.useAuthStore;
  });

  describe('setAuth', () => {
    it('写入 token / user / companies 到 localStorage', () => {
      const { setAuth } = useAuthStore.getState();
      const user = { id: 'u1', username: 'alice', role: 'admin' };
      const companies = [
        { id: 'c1', name: 'Corp A', role: 'owner' },
        { id: 'c2', name: 'Corp B', role: 'member' },
      ];

      setAuth('test-token-abc', user, companies);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'token',
        'test-token-abc',
      );
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'user',
        JSON.stringify(user),
      );
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'companies',
        JSON.stringify(companies),
      );

      const state = useAuthStore.getState();
      expect(state.token).toBe('test-token-abc');
      expect(state.user).toEqual(user);
      expect(state.companies).toEqual(companies);
      expect(state.currentCompanyId).toBe('c1');
    });
  });

  describe('setCurrentCompany', () => {
    it('切换 currentCompanyId 并持久化', () => {
      const { setAuth, setCurrentCompany } = useAuthStore.getState();
      const user = { id: 'u1', username: 'alice', role: 'admin' };
      const companies = [
        { id: 'c1', name: 'Corp A', role: 'owner' },
        { id: 'c2', name: 'Corp B', role: 'member' },
      ];

      setAuth('token', user, companies);
      setCurrentCompany('c2');

      expect(useAuthStore.getState().currentCompanyId).toBe('c2');
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'currentCompanyId',
        'c2',
      );
    });
  });

  describe('logout', () => {
    it('同步清除所有状态和 localStorage', async () => {
      const { setAuth, logout } = useAuthStore.getState();
      setAuth('token', { id: 'u1', username: 'alice', role: 'admin' }, [
        { id: 'c1', name: 'Corp A', role: 'owner' },
      ]);

      await logout();

      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.user).toBeNull();
      expect(state.companies).toEqual([]);
      expect(state.currentCompanyId).toBeNull();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('token');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('user');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('companies');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(
        'currentCompanyId',
      );
    });
  });

  describe('过期 token 初始加载', () => {
    it('过期 token 仍加载到状态，由 restoreSession 负责刷新', async () => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
      const payload = btoa(JSON.stringify({ sub: '1234567890', exp: 0 }))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
      const expiredToken = `${header}.${payload}.fake-signature`;

      localStorageMock.setItem('token', expiredToken);
      localStorageMock.setItem(
        'user',
        JSON.stringify({ id: 'u1', username: 'alice', role: 'admin' }),
      );
      localStorageMock.setItem(
        'companies',
        JSON.stringify([{ id: 'c1', name: 'Corp A', role: 'owner' }]),
      );
      localStorageMock.setItem('currentCompanyId', 'c1');

      jest.resetModules();
      const mod = await import('../authStore');
      const freshStore = mod.useAuthStore;

      expect(freshStore.getState().token).toBe(expiredToken);
      expect(freshStore.getState().user).toEqual({
        id: 'u1',
        username: 'alice',
        role: 'admin',
      });
    });
  });

  describe('初始状态（无 token）', () => {
    it('无 token 时状态全为 null / 空', () => {
      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.user).toBeNull();
      expect(state.companies).toEqual([]);
      expect(state.currentCompanyId).toBeNull();
    });
  });

  describe('restoreSession', () => {
    const makeExpiredToken = () => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
      const payload = btoa(JSON.stringify({ sub: '1234567890', exp: 0 }))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
      return `${header}.${payload}.fake-signature`;
    };

    const freshUser = { id: 'u1', email: 'a@b.com', name: 'Alice' };
    const freshCompanies = [{ id: 'c1', name: 'Corp A', role: 'owner', permissions: ['ALL'] }];
    const freshToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

    it('过期 token + csrf cookie + refresh 成功 → 不应 logout', async () => {
      Object.defineProperty(document, 'cookie', {
        value: 'csrf=valid-csrf-token',
        writable: true,
        configurable: true,
      });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            accessToken: freshToken,
            user: freshUser,
            companies: freshCompanies,
          }),
      });

      const { setAuth } = useAuthStore.getState();
      setAuth(makeExpiredToken(), { id: 'u1', username: 'alice' }, [
        { id: 'c1', name: 'Corp A', role: 'owner' },
      ]);

      const result = await useAuthStore.getState().restoreSession();

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/refresh'),
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: { 'x-csrf-token': 'valid-csrf-token' },
        }),
      );
      expect(useAuthStore.getState().token).toBe(freshToken);
      expect(useAuthStore.getState().user).toEqual(freshUser);
    });

    it('csrf cookie 缺失 + refresh cookie 存在 → 先 fetchCSRF 再 refresh', async () => {
      Object.defineProperty(document, 'cookie', {
        value: '',
        writable: true,
        configurable: true,
      });
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url.includes('/auth/csrf')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ csrfToken: 'server-issued-csrf' }),
          });
        }
        if (url.includes('/auth/refresh')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                accessToken: freshToken,
                user: freshUser,
                companies: freshCompanies,
              }),
          });
        }
        return Promise.reject(new Error('unexpected url'));
      });

      const result = await useAuthStore.getState().restoreSession();

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('/auth/csrf'),
        expect.objectContaining({ credentials: 'include' }),
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('/auth/refresh'),
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: { 'x-csrf-token': 'server-issued-csrf' },
        }),
      );
      expect(useAuthStore.getState().token).toBe(freshToken);
    });

    it('csrf cookie 缺失 + fetchCSRF 也失败 → 返回 false', async () => {
      Object.defineProperty(document, 'cookie', {
        value: '',
        writable: true,
        configurable: true,
      });
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ csrfToken: '' }),
      });

      const result = await useAuthStore.getState().restoreSession();

      expect(result).toBe(false);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/csrf'),
        expect.objectContaining({ credentials: 'include' }),
      );
    });
  });
});
