import type { NextFunction, Request, Response } from 'express';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { TenantContext } from '../tenant/tenant-context';

describe('TenantContextMiddleware', () => {
  const middleware = new TenantContextMiddleware();

  function createResponse() {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    return response as unknown as Response & {
      status: jest.Mock;
      json: jest.Mock;
    };
  }

  it('sets tenant context from x-company-id header', (done) => {
    const req = {
      method: 'GET',
      headers: { 'x-company-id': 'c1' },
    } as unknown as Request;
    const res = createResponse();

    middleware.use(req, res, (() => {
      expect(TenantContext.getCompanyId()).toBe('c1');
      done();
    }) as NextFunction);
  });

  it('rejects mutating request when body companyId differs from header', () => {
    const req = {
      method: 'POST',
      headers: { 'x-company-id': 'c1' },
      body: { companyId: 'c2', name: '非法公司数据' },
    } as unknown as Request;
    const res = createResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '请求 companyId 与当前公司上下文不一致',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('allows mutating request when body companyId matches header', () => {
    const req = {
      method: 'PATCH',
      headers: { 'x-company-id': 'c1' },
      body: { companyId: 'c1', name: '合法公司数据' },
    } as unknown as Request;
    const res = createResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
