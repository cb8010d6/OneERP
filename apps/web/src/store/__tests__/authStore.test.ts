/**
 * authStore.ts — 最小回归测试
 *
 * 覆盖:
 *  1. setAuth 写入 localStorage + 更新状态
 *  2. setCurrentCompany 切换公司
 *  3. logout 清除所有状态和 localStorage
 *  4. JWT 过期 token 被识别为无效
 *  5. 无 token 初始状态
 */

// zustand 需要通过 create 创建 store，mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn<string | null, [string]>((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn((key: string) => { delete store[key]; }),
    clear: jest.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: jest.fn((i: number) => Object.keys(store)[i] ?? null),
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// jsdom already provides window — no need to redefine it

describe('authStore', () => {
  // We need to require the module fresh each time to reset zustand state
  let useAuthStore: any;

  beforeEach(() => {
    jest.resetModules();
    localStorageMock.clear();
    jest.clearAllMocks();

    // 必须在每次重置模块后重新 require，因为 zustand create 在模块加载时执行
    const mod = require('../authStore');
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

      expect(localStorageMock.setItem).toHaveBeenCalledWith('token', 'test-token-abc');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('user', JSON.stringify(user));
      expect(localStorageMock.setItem).toHaveBeenCalledWith('companies', JSON.stringify(companies));

      const state = useAuthStore.getState();
      expect(state.token).toBe('test-token-abc');
      expect(state.user).toEqual(user);
      expect(state.companies).toEqual(companies);
      expect(state.currentCompanyId).toBe('c1'); // 默认选中第一个
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
      expect(localStorageMock.setItem).toHaveBeenCalledWith('currentCompanyId', 'c2');
    });
  });

  describe('logout', () => {
    it('清除所有状态和 localStorage', () => {
      const { setAuth, logout } = useAuthStore.getState();
      setAuth('token', { id: 'u1', username: 'alice', role: 'admin' }, [
        { id: 'c1', name: 'Corp A', role: 'owner' },
      ]);

      logout();

      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.user).toBeNull();
      expect(state.companies).toEqual([]);
      expect(state.currentCompanyId).toBeNull();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('token');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('user');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('companies');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('currentCompanyId');
    });
  });

  describe('JWT 过期检测', () => {
    it('过期 token 不恢复到初始状态', () => {
      // 创建一个已过期的 JWT (exp = 0 → 1970-01-01)
      // header: {"alg":"HS256","typ":"JWT"}
      // payload: {"sub":"1234567890","exp":0}
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
      const payload = btoa(JSON.stringify({ sub: '1234567890', exp: 0 }))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
      const expiredToken = `${header}.${payload}.fake-signature`;

      // 模拟 localStorage 中有过期 token
      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'token') return expiredToken;
        if (key === 'user') return JSON.stringify({ id: 'u1', username: 'alice', role: 'admin' });
        if (key === 'companies') return JSON.stringify([{ id: 'c1', name: 'Corp A', role: 'owner' }]);
        if (key === 'currentCompanyId') return 'c1';
        return null;
      });

      // 重新加载模块来触发 getInitialAuthState
      jest.resetModules();
      const mod = require('../authStore');
      const freshStore = mod.useAuthStore;

      // 过期 token 应该被清除
      expect(freshStore.getState().token).toBeNull();
      expect(freshStore.getState().user).toBeNull();
      expect(freshStore.getState().companies).toEqual([]);
    });
  });

  describe('初始状态（无 token）', () => {
    it('无 token 时状态全为 null / 空', () => {
      // localStorage 已在 beforeEach 中清空
      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.user).toBeNull();
      expect(state.companies).toEqual([]);
      expect(state.currentCompanyId).toBeNull();
    });
  });
});
