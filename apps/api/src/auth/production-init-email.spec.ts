import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { preflightAdminEmail } from '../../scripts/production-init-email';
import { initializeProduction } from '../../scripts/production-init';

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    user: { findMany: jest.fn(), upsert: jest.fn() },
    company: { findFirst: jest.fn(), create: jest.fn() },
    role: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    userCompanyRole: { upsert: jest.fn() },
    account: { upsert: jest.fn(), findUnique: jest.fn() },
    journal: { upsert: jest.fn() },
    taxCode: { upsert: jest.fn() },
  })),
}));
jest.mock('bcrypt', () => ({ hash: jest.fn() }));

type MockStore = Record<string, Record<string, jest.Mock>> & {
  user: {
    findMany: jest.Mock & PrismaClient['user']['findMany'];
    upsert: jest.Mock;
  };
};
const store = (PrismaClient as jest.Mock).mock.results[0].value as MockStore;
const originalEnv = process.env;

beforeEach(() => {
  jest.resetAllMocks();
  process.env = {
    ...originalEnv,
    INIT_ADMIN_EMAIL: '  Admin@Example.COM  ',
    INIT_ADMIN_PASSWORD: 'synthetic-test-password',
    INIT_ADMIN_NAME: '',
  };
});
afterEach(() => {
  process.env = originalEnv;
});

describe('production admin email preflight', () => {
  it.each([{ matches: [] }, { matches: [{ email: 'admin@example.com' }] }])(
    'accepts a fresh or exactly canonical identity: %j',
    async ({ matches }) => {
      store.user.findMany.mockResolvedValue(matches);
      await expect(
        preflightAdminEmail(store.user, ' Admin@Example.COM '),
      ).resolves.toBe('admin@example.com');
      expect(store.user.findMany).toHaveBeenCalledWith({
        where: { email: { equals: 'admin@example.com', mode: 'insensitive' } },
        select: { email: true },
        take: 2,
      });
    },
  );

  it.each([
    [[{ email: 'Admin@example.com' }]],
    [[{ email: 'admin@example.com' }, { email: 'ADMIN@example.com' }]],
    [[{ email: 'Admin@example.com' }, { email: 'ADMIN@example.com' }]],
  ])(
    'stops the complete initializer before side effects for conflicts: %j',
    async (matches) => {
      store.user.findMany.mockResolvedValue(matches);
      await expect(initializeProduction()).rejects.toThrow(
        /review the case-insensitive email matches/,
      );
      expect(bcrypt.hash).not.toHaveBeenCalled();
      for (const model of Object.values(store)) {
        for (const operation of Object.values(model)) {
          if (operation !== store.user.findMany)
            expect(operation).not.toHaveBeenCalled();
        }
      }
    },
  );

  it.each([{ matches: [] }, { matches: [{ email: 'admin@example.com' }] }])(
    'uses the normalized identity in the existing initializer upsert: %j',
    async ({ matches }) => {
      store.user.findMany.mockResolvedValue(matches);
      (bcrypt.hash as jest.Mock).mockResolvedValue('synthetic-hash');
      store.company.findFirst.mockResolvedValue({
        id: 'company-1',
        name: 'Test Company',
      });
      store.role.findFirst.mockImplementation(
        ({ where }: { where: { name: string } }) =>
          Promise.resolve({ id: where.name, name: where.name }),
      );
      store.role.update.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, name: where.id }),
      );
      store.user.upsert.mockResolvedValue({ id: 'admin-1' });
      const log = jest
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);
      try {
        await initializeProduction();
        expect(store.user.upsert).toHaveBeenCalledWith({
          where: { email: 'admin@example.com' },
          update: {
            passwordHash: 'synthetic-hash',
            name: 'Administrator',
            isActive: true,
          },
          create: {
            email: 'admin@example.com',
            passwordHash: 'synthetic-hash',
            name: 'Administrator',
            isActive: true,
          },
        });
        expect(store.userCompanyRole.upsert).toHaveBeenCalledWith({
          where: {
            userId_companyId: { userId: 'admin-1', companyId: 'company-1' },
          },
          update: { roleId: 'SuperAdmin' },
          create: {
            userId: 'admin-1',
            companyId: 'company-1',
            roleId: 'SuperAdmin',
          },
        });
        expect(store.user.findMany.mock.invocationCallOrder[0]).toBeLessThan(
          (bcrypt.hash as jest.Mock).mock.invocationCallOrder[0],
        );
        expect(JSON.stringify(log.mock.calls)).not.toContain(
          'synthetic-test-password',
        );
      } finally {
        log.mockRestore();
      }
    },
  );

  it('propagates lookup failure before hashing or any other store access', async () => {
    store.user.findMany.mockRejectedValue(new Error('lookup unavailable'));
    await expect(initializeProduction()).rejects.toThrow('lookup unavailable');
    expect(bcrypt.hash).not.toHaveBeenCalled();
    for (const model of Object.values(store)) {
      for (const operation of Object.values(model)) {
        if (operation !== store.user.findMany)
          expect(operation).not.toHaveBeenCalled();
      }
    }
  });

  it('rejects blank input without querying', async () => {
    await expect(preflightAdminEmail(store.user, '   ')).rejects.toThrow(
      'INIT_ADMIN_EMAIL is required',
    );
    expect(store.user.findMany).not.toHaveBeenCalled();
  });
});
