import { HttpException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

function createMemoryCache() {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn((key: string) => Promise.resolve(store.get(key))),
    set: jest.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    del: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
}

describe('AuthService', () => {
  const companyMembership = {
    company: { id: 'c1', name: '精工制造一厂' },
    role: { name: 'SuperAdmin', permissions: ['ALL'] },
  };

  it('issues short-lived access token and refresh token on login', async () => {
    const usersService = {
      findByEmail: jest.fn(),
      findByIdWithCompanies: jest.fn(),
    };
    const jwtService = {
      sign: jest.fn(() => 'access-token'),
    };
    const cache = createMemoryCache();
    const service = new AuthService(
      usersService as never,
      jwtService as never,
      cache as never,
    );

    const result = await service.login({
      id: 'u1',
      email: 'admin@oneerp.local',
      name: 'Admin',
      companies: [companyMembership],
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toMatch(/^u1\./);
    expect(jwtService.sign).toHaveBeenCalledWith(
      { email: 'admin@oneerp.local', sub: 'u1' },
      { expiresIn: '15m' },
    );
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringContaining('auth:refresh:u1:'),
      expect.objectContaining({ userId: 'u1' }),
      604800000,
    );
  });

  it('rotates refresh token and rejects reused token', async () => {
    const usersService = {
      findByEmail: jest.fn(),
      findByIdWithCompanies: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'admin@oneerp.local',
        name: 'Admin',
        isActive: true,
        companies: [companyMembership],
      }),
    };
    const jwtService = {
      sign: jest.fn(() => 'access-token'),
    };
    const cache = createMemoryCache();
    const service = new AuthService(
      usersService as never,
      jwtService as never,
      cache as never,
    );

    const first = await service.login({
      id: 'u1',
      email: 'admin@oneerp.local',
      name: 'Admin',
      companies: [companyMembership],
    });
    const refreshed = await service.refresh(first.refreshToken);

    expect(refreshed.refreshToken).toMatch(/^u1\./);
    expect(refreshed.refreshToken).not.toBe(first.refreshToken);
    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('locks login after repeated failures', async () => {
    const usersService = {
      findByEmail: jest.fn().mockResolvedValue(null),
      findByIdWithCompanies: jest.fn(),
    };
    const jwtService = { sign: jest.fn() };
    const cache = createMemoryCache();
    const service = new AuthService(
      usersService as never,
      jwtService as never,
      cache as never,
    );

    for (let index = 0; index < 5; index += 1) {
      await expect(
        service.validateUser('admin@oneerp.local', 'wrong'),
      ).resolves.toBeNull();
    }

    await expect(
      service.validateUser('admin@oneerp.local', 'wrong'),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('clears login failures after a successful login', async () => {
    const passwordHash = await bcrypt.hash('ChangeMe123', 10);
    const usersService = {
      findByEmail: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'admin@oneerp.local',
        name: 'Admin',
        passwordHash,
        isActive: true,
        companies: [companyMembership],
      }),
      findByIdWithCompanies: jest.fn(),
    };
    const jwtService = { sign: jest.fn() };
    const cache = createMemoryCache();
    const service = new AuthService(
      usersService as never,
      jwtService as never,
      cache as never,
    );

    const user = await service.validateUser(
      'admin@oneerp.local',
      'ChangeMe123',
    );

    expect(user?.id).toBe('u1');
    expect(cache.del).toHaveBeenCalledWith(
      'auth:login-failed:admin@oneerp.local',
    );
    expect(cache.del).toHaveBeenCalledWith(
      'auth:login-locked:admin@oneerp.local',
    );
  });
});
