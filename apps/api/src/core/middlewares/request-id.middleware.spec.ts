import { RequestIdMiddleware } from './request-id.middleware';

function createMiddleware() {
  return new RequestIdMiddleware();
}

function mockReqRes(header?: string) {
  const req = {
    headers: header ? { 'x-request-id': header } : {},
  } as never;
  const res = { setHeader: jest.fn() } as never;
  const next = jest.fn();
  return { req, res, next };
}

describe('RequestIdMiddleware', () => {
  it('uses valid header as requestId', () => {
    const middleware = createMiddleware();
    const { req, res, next } = mockReqRes('abc-123');
    middleware.use(req, res, next);
    expect((req as { requestId?: string }).requestId).toBe('abc-123');
    expect(next).toHaveBeenCalled();
  });

  it('generates UUID when header missing', () => {
    const middleware = createMiddleware();
    const { req, res, next } = mockReqRes();
    middleware.use(req, res, next);
    const id = (req as { requestId?: string }).requestId;
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('generates UUID when header too long', () => {
    const middleware = createMiddleware();
    const longId = 'a'.repeat(129);
    const { req, res, next } = mockReqRes(longId);
    middleware.use(req, res, next);
    const id = (req as { requestId?: string }).requestId;
    expect(id).not.toBe(longId);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('generates UUID when header contains invalid chars', () => {
    const middleware = createMiddleware();
    const { req, res, next } = mockReqRes('bad id!@#');
    middleware.use(req, res, next);
    const id = (req as { requestId?: string }).requestId;
    expect(id).not.toBe('bad id!@#');
  });

  it('accepts header with allowed chars', () => {
    const middleware = createMiddleware();
    const { req, res, next } = mockReqRes('req.id-123:abc_DEF');
    middleware.use(req, res, next);
    expect((req as { requestId?: string }).requestId).toBe(
      'req.id-123:abc_DEF',
    );
  });

  it('sets x-request-id response header', () => {
    const middleware = createMiddleware();
    const { req, res, next } = mockReqRes('test-id');
    middleware.use(req, res, next);
    expect((res as { setHeader: jest.Mock }).setHeader).toHaveBeenCalledWith(
      'x-request-id',
      'test-id',
    );
  });
});
