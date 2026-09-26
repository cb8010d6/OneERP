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

import type { InternalAxiosRequestConfig } from 'axios';

function requireCapturedConfig(
  config: InternalAxiosRequestConfig | null,
): InternalAxiosRequestConfig {
  if (!config) {
    throw new Error('Axios adapter was not called');
  }
  return config;
}

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
    let capturedConfig: InternalAxiosRequestConfig | null = null;
    api.defaults.adapter = (config) => {
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
      expect(requireCapturedConfig(capturedConfig).url).toContain('page=1');
      expect(requireCapturedConfig(capturedConfig).url).toContain('limit=20');
    });
  });

  it('合法分页参数不被修改', () => {
    let capturedConfig: InternalAxiosRequestConfig | null = null;
    api.defaults.adapter = (config) => {
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
      expect(requireCapturedConfig(capturedConfig).url).toContain('page=3');
      expect(requireCapturedConfig(capturedConfig).url).toContain('limit=50');
    });
  });

  it('注入 Authorization 和 x-company-id', () => {
    let capturedConfig: InternalAxiosRequestConfig | null = null;
    api.defaults.adapter = (config) => {
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
      expect(
        requireCapturedConfig(capturedConfig).headers.Authorization,
      ).toContain('Bearer ');
      expect(
        requireCapturedConfig(capturedConfig).headers['x-company-id'],
      ).toBe('c1');
    });
  });

  it('auth 请求不注入 x-company-id', () => {
    let capturedConfig: InternalAxiosRequestConfig | null = null;
    api.defaults.adapter = (config) => {
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
      expect(
        requireCapturedConfig(capturedConfig).headers['x-company-id'],
      ).toBeUndefined();
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

    return api.get('/v1/resource/test').catch((reason: unknown) => {
      expect(reason).toBeInstanceOf(Error);
      expect((reason as Error).message).toContain('缺少有效登录态');
      expect(mockLogout).toHaveBeenCalled();
    });
  });

  it('写请求注入 x-csrf-token header', () => {
    mockGetCsrfTokenFromCookie.mockReturnValue('test-csrf-token');
    let capturedConfig: InternalAxiosRequestConfig | null = null;
    api.defaults.adapter = (config) => {
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
      expect(
        requireCapturedConfig(capturedConfig).headers['x-csrf-token'],
      ).toBe('test-csrf-token');
    });
  });

  it('GET 请求不注入 x-csrf-token', () => {
    mockGetCsrfTokenFromCookie.mockReturnValue('test-csrf-token');
    let capturedConfig: InternalAxiosRequestConfig | null = null;
    api.defaults.adapter = (config) => {
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
      expect(
        requireCapturedConfig(capturedConfig).headers['x-csrf-token'],
      ).toBeUndefined();
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

    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    return api
      .get('/v1/resource/test')
      .catch(() => {
        expect(mockLogout).toHaveBeenCalled();
      })
      .finally(() => {
        consoleError.mockRestore();
      });
  });
});

describe('session recovery boundaries', () => {
  let api: typeof import('../api').default;
  let axios: typeof import('axios').default;
  let state: {
    token: string;
    user: { id: string };
    currentCompanyId: string;
    contextVersion: number;
    companies: Array<{ id: string }>;
    setAuth: jest.Mock;
    logout: jest.Mock;
    setCurrentCompany: jest.Mock;
  };
  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    axios = (await import('axios')).default;
    api = (await import('../api')).default;
    state = {
      token: 'old-token',
      user: { id: 'u1' },
      currentCompanyId: 'c1',
      contextVersion: 1,
      companies: [{ id: 'c1' }, { id: 'c2' }],
      setAuth: jest.fn((token: string) => {
        state.token = token;
      }),
      logout: mockLogout,
      setCurrentCompany: mockSetCurrentCompany,
    };
    mockGetState.mockImplementation(() => state);
    mockGetCsrfTokenFromCookie.mockReturnValue('csrf');
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps failed login local without refresh or logout', async () => {
    const refresh = jest.spyOn(axios, 'post');
    api.defaults.adapter = (config) =>
      Promise.reject({
        config,
        response: { status: 401, data: { message: 'Invalid credentials' } },
      });
    await expect(api.post('/auth/login', {})).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('refreshes once and retries a protected request in its original company', async () => {
    const refresh = jest
      .spyOn(axios, 'post')
      .mockResolvedValue({
        data: {
          accessToken: 'fresh-token',
          user: state.user,
          companies: state.companies,
        },
      });
    const adapter = jest.fn((config: InternalAxiosRequestConfig) => {
      if (!config._retry)
        return Promise.reject({ config, response: { status: 401 } });
      return Promise.resolve({
        config,
        status: 200,
        statusText: 'OK',
        headers: {},
        data: 'success',
      });
    });
    api.defaults.adapter = adapter;
    await expect(api.get('/orders')).resolves.toMatchObject({
      data: 'success',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(adapter.mock.calls[1][0].headers['x-company-id']).toBe('c1');
    expect(adapter.mock.calls[1][0].headers.Authorization).toBe(
      'Bearer fresh-token',
    );
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('does not replay an old-company mutation after switching during refresh', async () => {
    let finishRefresh!: (value: unknown) => void;
    let started!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    jest.spyOn(axios, 'post').mockImplementation(() => {
      started();
      return new Promise((resolve) => {
        finishRefresh = resolve;
      });
    });
    const adapter = jest.fn((config: InternalAxiosRequestConfig) =>
      Promise.reject({ config, response: { status: 401 } }),
    );
    api.defaults.adapter = adapter;
    const result = api.post('/orders', { partnerId: 'company-a-partner' });
    const rejection = expect(result).rejects.toMatchObject({
      response: { status: 401 },
    });
    await refreshStarted;
    state = {
      ...state,
      currentCompanyId: 'c2',
      contextVersion: state.contextVersion + 1,
    };
    finishRefresh({
      data: {
        accessToken: 'fresh-token',
        user: state.user,
        companies: state.companies,
      },
    });
    await rejection;
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(state.setAuth).toHaveBeenCalledTimes(1);
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('shares refresh rotation across a company switch but only replays the current-company request', async () => {
    let finishRefresh!: (value: unknown) => void;
    let started!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const refresh = jest.spyOn(axios, 'post').mockImplementation(() => {
      started();
      return new Promise((resolve) => {
        finishRefresh = resolve;
      });
    });
    let bRequested!: () => void;
    const bStarted = new Promise<void>((resolve) => {
      bRequested = resolve;
    });
    const adapter = jest.fn((config: InternalAxiosRequestConfig) => {
      if (config._retry)
        return Promise.resolve({
          config,
          status: 200,
          statusText: 'OK',
          headers: {},
          data: 'B',
        });
      if (config.headers['x-company-id'] === 'c2') bRequested();
      return Promise.reject({ config, response: { status: 401 } });
    });
    api.defaults.adapter = adapter;
    const a = expect(api.post('/orders', {})).rejects.toMatchObject({
      response: { status: 401 },
    });
    await refreshStarted;
    state = { ...state, currentCompanyId: 'c2', contextVersion: 2 };
    const b = api.get('/orders');
    await bStarted;
    // Let the second 401 enter the response interceptor before rotation finishes.
    await new Promise((resolve) => setTimeout(resolve, 0));
    finishRefresh({
      data: {
        accessToken: 'fresh',
        user: state.user,
        companies: state.companies,
      },
    });
    await a;
    await expect(b).resolves.toMatchObject({ data: 'B' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(adapter).toHaveBeenCalledTimes(3);
    expect(
      adapter.mock.calls.filter(
        ([config]) => config.headers['x-company-id'] === 'c1',
      ),
    ).toHaveLength(1);
    expect(adapter.mock.calls[2][0].headers['x-company-id']).toBe('c2');
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('rejects a successful old-company response after switching', async () => {
    let complete!: () => void;
    let started!: () => void;
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    api.defaults.adapter = (config) =>
      new Promise((resolve) => {
        complete = () =>
          resolve({
            config,
            status: 200,
            statusText: 'OK',
            headers: {},
            data: ['old record'],
          });
        started();
      });
    const request = api.get('/orders');
    const rejection = expect(request).rejects.toMatchObject({
      code: 'ERR_AUTH_CONTEXT_CHANGED',
    });
    await requested;
    state = {
      ...state,
      currentCompanyId: 'c2',
      contextVersion: state.contextVersion + 1,
    };
    complete();
    await rejection;
    expect(mockLogout).not.toHaveBeenCalled();
  });
});
