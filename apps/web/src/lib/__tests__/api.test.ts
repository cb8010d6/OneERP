/**
 * api.ts — 最小回归测试
 *
 * 覆盖:
 *  1. sanitizePaginationInUrl 对非法分页参数的修正
 *  2. 请求拦截器自动注入 Authorization / x-company-id
 *  3. 无 token 时拦截器阻止非 auth 请求
 *  4. 响应拦截器在 401 时尝试 refresh 再 logout
 *  5. 写请求自动注入 x-csrf-token
 */

const mockGetState = jest.fn();
const mockLogout = jest.fn().mockResolvedValue(undefined);
const mockSetCurrentCompany = jest.fn();
const mockGetCsrfTokenFromCookie = jest.fn().mockReturnValue('');

jest.mock('../../store/authStore', () => ({
  useAuthStore: {
    getState: mockGetState,
  },
  getCsrfTokenFromCookie: mockGetCsrfTokenFromCookie,
}));

describe('api.ts interceptors', () => {
  let api: typeof import('../api').default;
  let readApiError: typeof import('../api').readApiError;

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    const apiModule = await import('../api');
    api = apiModule.default;
    readApiError = apiModule.readApiError;
    mockGetState.mockReturnValue({
      token:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      user: { id: 'u1', username: 'test', role: 'admin' },
      companies: [{ id: 'c1', name: 'TestCo', role: 'owner' }],
      currentCompanyId: 'c1',
      setCurrentCompany: mockSetCurrentCompany,
      logout: mockLogout,
    });
    mockGetCsrfTokenFromCookie.mockReturnValue('');
  });

  it('读取结构化 API 错误消息', () => {
    expect(
      readApiError({ response: { data: { message: '凭据无效' } } }, '请求失败'),
    ).toBe('凭据无效');
  });

  it('非结构化异常使用回退消息', () => {
    expect(readApiError(new Error('network reset'), '请求失败')).toBe(
      '请求失败',
    );
  });

  it('修正非法 page < 1 和 limit > 100', () => {
    let capturedConfig: any = null;
    api.defaults.adapter = (config: any) => {
      capturedConfig = config;
      return Promise.resolve({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      });
    };

    return api.get('/v1/resource/test?page=0&limit=200').then(() => {
      expect(capturedConfig.url).toContain('page=1');
      expect(capturedConfig.url).toContain('limit=20');
    });
  });

  it('合法分页参数不被修改', () => {
    let capturedConfig: any = null;
    api.defaults.adapter = (config: any) => {
      capturedConfig = config;
      return Promise.resolve({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      });
    };

    return api.get('/v1/resource/test?page=3&limit=50').then(() => {
      expect(capturedConfig.url).toContain('page=3');
      expect(capturedConfig.url).toContain('limit=50');
    });
  });

  it('注入 Authorization 和 x-company-id', () => {
    let capturedConfig: any = null;
    api.defaults.adapter = (config: any) => {
      capturedConfig = config;
      return Promise.resolve({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      });
    };

    return api.get('/v1/resource/test').then(() => {
      expect(capturedConfig.headers.Authorization).toContain('Bearer ');
      expect(capturedConfig.headers['x-company-id']).toBe('c1');
    });
  });

  it('auth 请求不注入 x-company-id', () => {
    let capturedConfig: any = null;
    api.defaults.adapter = (config: any) => {
      capturedConfig = config;
      return Promise.resolve({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      });
    };

    return api.get('/auth/login').then(() => {
      expect(capturedConfig.headers['x-company-id']).toBeUndefined();
    });
  });

  it('无 token 时非 auth 请求被拒绝并调用 logout', () => {
    mockGetState.mockReturnValue({
      token: null,
      user: null,
      companies: [],
      currentCompanyId: null,
      setCurrentCompany: mockSetCurrentCompany,
      logout: mockLogout,
    });

    return api.get('/v1/resource/test').catch((err: any) => {
      expect(err.message).toContain('缺少有效登录态');
      expect(mockLogout).toHaveBeenCalled();
    });
  });

  it('写请求注入 x-csrf-token header', () => {
    mockGetCsrfTokenFromCookie.mockReturnValue('test-csrf-token');
    let capturedConfig: any = null;
    api.defaults.adapter = (config: any) => {
      capturedConfig = config;
      return Promise.resolve({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      });
    };

    return api.post('/v1/resource/test', {}).then(() => {
      expect(capturedConfig.headers['x-csrf-token']).toBe('test-csrf-token');
    });
  });

  it('GET 请求不注入 x-csrf-token', () => {
    mockGetCsrfTokenFromCookie.mockReturnValue('test-csrf-token');
    let capturedConfig: any = null;
    api.defaults.adapter = (config: any) => {
      capturedConfig = config;
      return Promise.resolve({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      });
    };

    return api.get('/v1/resource/test').then(() => {
      expect(capturedConfig.headers['x-csrf-token']).toBeUndefined();
    });
  });

  it('401 响应触发 logout', () => {
    api.defaults.adapter = () =>
      Promise.reject({
        response: { status: 401, data: {} },
        config: {},
        isAxiosError: true,
        toJSON: () => ({}),
      });

    const originalLocation = window.location;
    delete (window as any).location;
    (window as any).location = { href: '' };

    return api
      .get('/v1/resource/test')
      .catch(() => {
        expect(mockLogout).toHaveBeenCalled();
      })
      .finally(() => {
        (window as any).location = originalLocation;
      });
  });
});
