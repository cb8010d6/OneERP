import { Prisma } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { UsersService } from './users.service';

type StoredUser = {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  isActive: boolean;
  companies: unknown[];
};
function setup() {
  const rows: StoredUser[] = [];
  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: { where: { email: string } }) =>
        Promise.resolve(
          rows.find((user) => user.email === where.email) ?? null,
        ),
      ),
      findFirst: jest.fn(
        ({ where }: { where: { email: { equals: string; mode: string } } }) =>
          Promise.resolve(
            rows.find(
              (user) => user.email.toLowerCase() === where.email.equals,
            ) ?? null,
          ),
      ),
      create: jest.fn(
        ({
          data,
        }: {
          data: Pick<StoredUser, 'email' | 'passwordHash' | 'name'>;
        }) => {
          const user = {
            ...data,
            id: 'new-user',
            isActive: true,
            companies: [],
          };
          rows.push(user);
          return Promise.resolve(user);
        },
      ),
      update: jest.fn(),
    },
    role: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'reader', permissions: [] }),
    },
    userCompanyRole: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const users = new UsersService(prisma as never);
  const auth = new AuthService(
    users,
    { sign: jest.fn() } as never,
    {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    } as never,
  );
  return { rows, prisma, users, auth };
}
const password = 'SyntheticPass123!';
describe('UsersService direct user email identity', () => {
  it('rejects unauthorized role assignment before creating any account', async () => {
    const { users, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue({
      id: 'admin',
      permissions: ['ALL'],
    });
    await expect(
      users.createAndAssignUser(
        'company',
        { email: 'New@example.com', password, name: 'New', roleId: 'admin' },
        'operator',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.userCompanyRole.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['MFG-Actor@Example.COM', '  MFG-Actor@Example.COM  '])(
    'creates a login-compatible identity for %s',
    async (email) => {
      const { users, auth, prisma } = setup();
      const created = await users.createUser(email, password, 'Actor');
      // Real AuthService normalizes before the exact database lookup.
      await expect(auth.validateUser(email, password)).resolves.toMatchObject({
        id: created.id,
        email: 'mfg-actor@example.com',
      });
      expect(created.email).toBe('mfg-actor@example.com');
      expect(prisma.user.findUnique).toHaveBeenLastCalledWith({
        where: { email: 'mfg-actor@example.com' },
        include: { companies: { include: { company: true, role: true } } },
      });
    },
  );
  it('returns and audits the canonical identity when assigning a new employee', async () => {
    const { users, auth, prisma } = setup();
    const created = await users.createAndAssignUser(
      'company',
      {
        email: 'MFG-Actor@Example.COM',
        password,
        name: 'Actor',
        roleId: 'reader',
      },
      'operator',
    );
    expect(created.email).toBe('mfg-actor@example.com');
    await expect(
      auth.validateUser(created.email, password),
    ).resolves.toMatchObject({ id: created.id });
    expect(prisma.userCompanyRole.create).toHaveBeenCalledWith({
      data: { userId: created.id, companyId: 'company', roleId: 'reader' },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'operator',
        companyId: 'company',
        entity: 'user',
        entityId: created.id,
        action: 'USER_CREATE',
        details: { email: created.email, roleId: 'reader', isActive: true },
      },
    });
  });
  it.each(['mfg-actor@example.com', 'MFG-Actor@Example.COM'])(
    'rejects collisions with existing %s without changing or selecting the account',
    async (email) => {
      const { rows, users, prisma } = setup();
      const existing = {
        id: 'legacy',
        email,
        passwordHash: 'unchanged',
        name: 'Existing',
        isActive: true,
        companies: [],
      };
      rows.push(existing);
      await expect(
        users.createAndAssignUser(
          'company',
          {
            email: 'MfG-Actor@example.com',
            password,
            name: 'New',
            roleId: 'reader',
          },
          'operator',
        ),
      ).rejects.toEqual(new ConflictException('该邮箱已被注册'));
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          email: { equals: 'mfg-actor@example.com', mode: 'insensitive' },
        },
        select: { id: true },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.userCompanyRole.create).not.toHaveBeenCalled();
      expect(rows).toEqual([existing]);
    },
  );
  it('keeps findByEmail exact for auth and invitation identity checks', async () => {
    const { rows, users, prisma } = setup();
    rows.push({
      id: 'legacy',
      email: 'Legacy@example.com',
      passwordHash: 'unchanged',
      name: 'Existing',
      isActive: true,
      companies: [],
    });
    await expect(users.findByEmail('legacy@example.com')).resolves.toBeNull();
    await expect(
      users.findByEmail('Legacy@example.com'),
    ).resolves.toMatchObject({ id: 'legacy' });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

function setupInvitations() {
  const base = setup();
  const invitation = {
    id: 'invite',
    email: ' Invited@Example.COM ',
    name: 'Invited',
    roleId: 'reader',
    companyId: 'company',
    createdById: 'operator',
    acceptedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
  };
  const invitationDb = {
    findUnique: jest.fn().mockResolvedValue(invitation),
    create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'invite', ...data, role: { id: 'reader' } }),
    ),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    update: jest.fn().mockResolvedValue({}),
  };
  const prisma = {
    ...base.prisma,
    userCompanyRole: {
      ...base.prisma.userCompanyRole,
      findFirst: jest.fn().mockResolvedValue(null),
    },
    userInvitation: invitationDb,
    $transaction: jest.fn(),
  };
  // Distinct transaction mocks verify all acceptance writes stay inside the transaction.
  const tx = {
    user: { create: base.prisma.user.create },
    userInvitation: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    userCompanyRole: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  prisma.$transaction.mockImplementation(
    (callback: (client: typeof tx) => unknown) => callback(tx),
  );
  const users = new UsersService(prisma as never);
  return { ...base, users, prisma, tx, invitation };
}
const uniqueError = (target: string) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target: [target] },
  });

describe('UsersService invitation email identity', () => {
  it('stores a canonical new invitation and checks case-insensitive membership', async () => {
    const { users, prisma } = setupInvitations();
    const invite = await users.createInvitation('company', 'operator', {
      email: ' Invited@Example.COM ',
      roleId: 'reader',
    });
    expect(invite.email).toBe('invited@example.com');
    expect(prisma.userCompanyRole.findFirst).toHaveBeenCalledWith({
      where: {
        companyId: 'company',
        user: { email: { equals: 'invited@example.com', mode: 'insensitive' } },
      },
      select: { id: true },
    });
  });
  it('accepts an old mixed-case invitation into a new canonical login without modifying existing users', async () => {
    const { users, auth, prisma, tx } = setupInvitations();
    const user = await users.acceptInvitation('opaque-token', password);
    expect(user?.email).toBe('invited@example.com');
    await expect(
      auth.validateUser('INVITED@example.com', password),
    ).resolves.toMatchObject({ id: user?.id });
    expect(tx.userInvitation.updateMany).toHaveBeenCalledTimes(1);
    const claim = tx.userInvitation.updateMany.mock.calls[0] as [
      {
        where: { id: string; acceptedAt: null; expiresAt: { gte: Date } };
        data: { acceptedAt: Date };
      },
    ];
    expect(claim[0].where).toEqual({
      id: 'invite',
      acceptedAt: null,
      expiresAt: { gte: claim[0].data.acceptedAt },
    });
    expect(tx.userCompanyRole.create).toHaveBeenCalledWith({
      data: { userId: user?.id, companyId: 'company', roleId: 'reader' },
    });
    expect(tx.userInvitation.update).toHaveBeenCalledWith({
      where: { id: 'invite' },
      data: { acceptedById: user?.id },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.userInvitation.updateMany).not.toHaveBeenCalled();
    expect(prisma.userCompanyRole.create).not.toHaveBeenCalled();
  });
  it.each(['invited@example.com', 'Invited@Example.COM'])(
    'refuses invitation creation and acceptance for existing %s',
    async (email) => {
      const { users, rows, prisma } = setupInvitations();
      const existing = {
        id: 'existing',
        email,
        name: 'Existing',
        passwordHash: 'unchanged',
        isActive: true,
        companies: [],
      };
      rows.push(existing);
      await expect(
        users.createInvitation('company', 'operator', {
          email: 'INVITED@example.com',
          roleId: 'reader',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        users.acceptInvitation('opaque-token', password),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.userInvitation.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(rows).toEqual([existing]);
    },
  );
  it('refuses a token claimed or expired during password hashing before creating an account', async () => {
    const { users, prisma, tx } = setupInvitations();
    tx.userInvitation.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      users.acceptInvitation('opaque-token', password),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(tx.userCompanyRole.create).not.toHaveBeenCalled();
    expect(tx.userInvitation.update).not.toHaveBeenCalled();
  });
  it('maps a concurrent canonical email collision to conflict without linking an existing user', async () => {
    const { users, prisma, tx } = setupInvitations();
    prisma.user.create.mockRejectedValue(uniqueError('email'));
    await expect(
      users.acceptInvitation('opaque-token', password),
    ).rejects.toEqual(
      new ConflictException('该邮箱已注册，不能通过邀请链接重置已有账号'),
    );
    expect(tx.userCompanyRole.create).not.toHaveBeenCalled();
    expect(tx.userInvitation.update).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    await expect(
      users.createUser('Direct@example.com', password, 'Direct'),
    ).rejects.toEqual(new ConflictException('该邮箱已被注册'));
  });
  it('preserves non-email failures and stops acceptance after membership failure', async () => {
    const { users, tx, prisma } = setupInvitations();
    const failure = uniqueError('userId_companyId');
    tx.userCompanyRole.create.mockRejectedValue(failure);
    await expect(users.acceptInvitation('opaque-token', password)).rejects.toBe(
      failure,
    );
    expect(tx.userInvitation.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
