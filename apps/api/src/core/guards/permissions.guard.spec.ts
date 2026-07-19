import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS_KEY, Permission } from '../permissions/permissions';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => 'handler',
    getClass: () => 'class',
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  it('allows exact permissions', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === PERMISSIONS_KEY ? ['user:create'] : [],
      ),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(
      guard.canActivate(
        makeContext({
          userRole: { permissions: ['user:create'] },
          method: 'POST',
          params: {},
        }),
      ),
    ).toBe(true);
  });

  it('allows order update as workflow transition compatibility only for orders', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === PERMISSIONS_KEY ? [Permission.WorkflowTransitionAuto] : [],
      ),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(
      guard.canActivate(
        makeContext({
          userRole: { permissions: ['order:update'] },
          method: 'POST',
          params: { modelName: 'order' },
        }),
      ),
    ).toBe(true);
  });

  it('does not allow order update to transition other workflow models', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === PERMISSIONS_KEY ? [Permission.WorkflowTransitionAuto] : [],
      ),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(() =>
      guard.canActivate(
        makeContext({
          userRole: { permissions: ['order:update'] },
          method: 'POST',
          params: { modelName: 'invoice' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('maps generic CRUD permissions from route model and method', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === PERMISSIONS_KEY ? [Permission.CrudAuto] : [],
      ),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(
      guard.canActivate(
        makeContext({
          userRole: { permissions: ['partner:read'] },
          method: 'GET',
          params: { modelName: 'partner' },
        }),
      ),
    ).toBe(true);
  });

  it('rejects missing permissions', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === PERMISSIONS_KEY ? ['finance:post'] : [],
      ),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(() =>
      guard.canActivate(
        makeContext({
          userRole: { permissions: ['finance:read'] },
          method: 'POST',
          params: {},
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
