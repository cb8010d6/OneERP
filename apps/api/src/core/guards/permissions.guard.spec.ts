import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

function mockContext(
  userRole: { name: string; permissions?: string[] } | null,
  userId = 'u1',
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: userId, email: 'test@test.com' },
        userRole,
      }),
    }),
    getHandler: () => () => undefined,
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  it('should allow access when no permissions are declared', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = mockContext({ name: 'VIEWER' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow access when permissions list is empty', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
    const ctx = mockContext({ name: 'VIEWER' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should auto-grant ADMIN role full access', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['finance:reverse']);
    const ctx = mockContext({ name: 'ADMIN' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow access when user has required permission', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['purchase:write', 'purchase:cancel']);
    const ctx = mockContext({
      name: 'MANAGER',
      permissions: ['purchase:read', 'purchase:write'],
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should deny access when user lacks required permission', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['finance:reverse']);
    const ctx = mockContext({
      name: 'VIEWER',
      permissions: ['purchase:read'],
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should deny access when user has no permissions array', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['purchase:write']);
    const ctx = mockContext({ name: 'EMPTY_ROLE' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should deny access when userRole is null', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['purchase:write']);
    const ctx = mockContext(null);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
