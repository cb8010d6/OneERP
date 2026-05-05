/**
 * api.ts — 最小回归测试
 *
 * 覆盖:
 *  1. sanitizePaginationInUrl 对非法分页参数的修正
 *  2. 请求拦截器自动注入 Authorization / x-company-id
 *  3. 无 token 时拦截器阻止非 auth 请求
 *  4. 响应拦截器在 401 时清除状态
 */

/* ------------------------------------------------------------------ */
/*  先 mock 掉 axios 模块，避免真实网络请求                            */
/* ------------------------------------------------------------------ */

const mockGetState = jest.fn();
const mockSetState = jest.fn();
const mockLogout = jest.fn();
const mockSetCurrentCompany = jest.fn();

jest.mock('../store/authStore', () => ({
  useAuthStore: {
    getState: mockGetState,
    setState: mockSetState,
  },
}));

/* ------------------------------------------------------------------ */
/*  动态导入 api 模块，让 mock 生效                                     */
/* ------------------------------------------------------------------ */

// We import sanitizePaginationInUrl indirectly through api internals.
// Since it's not exported, we test it via the interceptor behavior.
// For the pure function test, we'll extract it from source.

describe('sanitizePaginationInUrl (via interceptor)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 默认 auth 状态：有 token + 公司
    mockGetState.mockReturnValue({
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      user: { id: 'u1', username: 'test', role: 'admin' },
      companies: [{ id: 'c1', name: 'TestCo', role: 'owner' }],
      currentCompanyId: 'c1',
      setCurrentCompany: mockSetCurrentCompany,
      logout: mockLogout,
    });
  });

  it('sanitizePaginationInUrl 修正非法 page < 1', () => {
    // 通过 api interceptor 间接验证：sanitized URL 不会带非法 page
    // 直接测试 sanitizePaginationInUrl 的逻辑
    // 该函数在 api.ts 内部定义，不可直接导出
    // 我们通过检查 interceptor 处理后的 config.url 来验证

    // 使用 api 拦截器验证: 先注册一个 adapter 捕获 config
    const axios = require('axios');
    const api = require('../lib/api').default;

    // 添加一个 mock adapter 来捕获最终的请求配置
    let capturedConfig: any = null;
    api.defaults.adapter = (config: any) => {
      capturedConfig = config;
      return Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
    };

    return api.get('/v1/resource/test?page=0&limit=200').then(() => {
      // page=0 应被修正为 1, limit=200 应被修正为 20
      expect(capturedConfig.url).toContain('page=1');
      expect(capturedConfig.url).toContain('limit=20');
    });
  });

  it('合法分页参数不被修改', () => {
    const axios = require('axios');
    const api = require('../lib/api').default;

    let capturedConfig: any = null;
    api.defaults.adapter = (config: any) => {
      capturedConfig = config;
      return Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
    };

    return api.get('/v1/resource/test?page=3&limit=50').then(() => {
      expect(capturedConfig.url).toContain('page=3');
      expect(capturedConfig.url).toContain('limit=50');
    });
  });

  it('请求拦截器注入 Authorization header', () => {
    const api = require('../lib/api').default;

    let capturedConfig: any = null;
    api.defaults.adapter = (config: any) => {
      capturedConfig = config;
      return Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
    };

    return api.get('/v1/resource/test').then(() => {
      expect(capturedConfig.headers.Authorization).toContain('Bearer ');
    });
  });

  it('请求拦截器注入 x-company-id header', () => {
    const api = require('../lib/api').default;

    let capturedConfig: any = null;
    api.defaults.adapter = (config: any) => {
      capturedConfig = config;
      return Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
    };

    return api.get('/v1/resource/test').then(() => {
      expect(capturedConfig.headers['x-company-id']).toBe('c1');
    });
  });

  it('auth 请求不注入 x-company-id', () => {
    const api = require('../lib/api').default;

    let capturedConfig: any = null;
    api.defaults.adapter = (config: any) => {
      capturedConfig = config;
      return Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
    };

    return api.get('/auth/login').then(() => {
      expect(capturedConfig.headers['x-company-id']).toBeUndefined();
    });
  });

  it('无 token 时非 auth 请求被拒绝', () => {
    mockGetState.mockReturnValue({
      token: null,
      user: null,
      companies: [],
      currentCompanyId: null,
      setCurrentCompany: mockSetCurrentCompany,
      logout: mockLogout,
    });

    const api = require('../lib/api').default;

    return api.get('/v1/resource/test').catch((err: any) => {
      expect(err.message).toContain('缺少有效登录态');
      expect(mockLogout).toHaveBeenCalled();
    });
  });

  it('401 响应触发 logout', () => {
    const api = require('../lib/api').default;

    api.defaults.adapter = () =>
      Promise.reject({
        response: { status: 401, data: {} },
        config: {},
        isAxiosError: true,
        toJSON: () => ({}),
      });

    // 模拟 window.location
    const originalLocation = window.location;
    delete (window as any).location;
    (window as any).location = { href: '' };

    return api.get('/v1/resource/test').catch(() => {
      expect(mockLogout).toHaveBeenCalled();
      // restore
      (window as any).location = originalLocation;
    });
  });
});
