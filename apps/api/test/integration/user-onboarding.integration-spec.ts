import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../src/prisma/prisma.service';
import { UsersService } from '../../src/users/users.service';

// Fail closed before constructing a client. This suite only creates UUID-scoped
// synthetic identities in an explicitly opted-in, disposable local database.
function assertTestDatabase() {
  let url: URL;
  try {
    url = new URL(process.env.DATABASE_URL ?? '');
  } catch {
    throw new Error('Integration tests require an explicit test DATABASE_URL');
  }
  if (
    process.env.ONEERP_INTEGRATION_TEST !== '1' ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^\/[a-zA-Z0-9_]+_test$/.test(url.pathname)
  ) {
    throw new Error(
      'Integration tests require ONEERP_INTEGRATION_TEST=1 and a local database ending in _test',
    );
  }
}
assertTestDatabase();

const password = 'SyntheticOnboard123!';
const otherPassword = 'OtherSynthetic123!';

describe('PostgreSQL user onboarding identity and invitation safety', () => {
  const prisma = new PrismaService();
  const users = new UsersService(prisma);
  let companyIds: string[];
  let inviterId: string;
  let roleIds: string[];
  let email: string;
  let afterAvailabilityRead: (() => Promise<void>) | undefined;
  let failAfterMembership = false;
  let availabilityReads = 0;

  beforeAll(async () => {
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        afterAvailabilityRead &&
        params.model === 'User' &&
        params.action === 'findFirst'
      ) {
        availabilityReads += 1;
        await afterAvailabilityRead();
      }
      if (
        failAfterMembership &&
        params.runInTransaction &&
        params.model === 'UserCompanyRole' &&
        params.action === 'create'
      ) {
        failAfterMembership = false;
        throw new Error('synthetic failure after actual membership insertion');
      }
      return result;
    });
    await prisma.$connect();
  });

  beforeEach(async () => {
    companyIds = [randomUUID(), randomUUID()];
    inviterId = randomUUID();
    roleIds = [];
    email = `onboard-${randomUUID()}@example.invalid`;
    await prisma.company.createMany({
      data: companyIds.map((id) => ({
        id,
        name: 'Synthetic onboarding company',
      })),
    });
    await prisma.user.create({
      data: {
        id: inviterId,
        email: `${inviterId}@example.invalid`,
        name: 'Synthetic inviter',
        passwordHash: 'not-a-login-hash',
      },
    });
    for (const [index, companyId] of companyIds.entries()) {
      const role = await prisma.role.create({
        data: {
          name: `Synthetic onboarding role ${randomUUID()}`,
          permissions: [],
        },
      });
      roleIds.push(role.id);
      await prisma.userCompanyRole.create({
        data: { userId: inviterId, companyId, roleId: roleIds[index] },
      });
    }
  });

  afterEach(async () => {
    afterAvailabilityRead = undefined;
    failAfterMembership = false;
    jest.restoreAllMocks();
    if (!companyIds?.length) return;
    // Only the synthetic tenants and unique identity created by this case are
    // removed. Invitations/audit references are deleted before their users.
    await prisma.auditLog.deleteMany({
      where: { companyId: { in: companyIds } },
    });
    await prisma.userInvitation.deleteMany({
      where: { companyId: { in: companyIds } },
    });
    await prisma.userCompanyRole.deleteMany({
      where: { companyId: { in: companyIds } },
    });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: inviterId },
          { email: { equals: email, mode: 'insensitive' } },
        ],
      },
    });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  function invite(index = 0, address = email) {
    return users.createInvitation(companyIds[index], inviterId, {
      email: address,
      name: 'Synthetic invitee',
      roleId: roleIds[index],
    });
  }
  function identities() {
    return prisma.user.findMany({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { companies: true },
    });
  }
  function savedInvitation(id: string) {
    return prisma.userInvitation.findUniqueOrThrow({ where: { id } });
  }
  function overlapAvailabilityReads() {
    availabilityReads = 0;
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    afterAvailabilityRead = async () => {
      arrived += 1;
      if (arrived === 2) release();
      if (arrived > 2) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          gate,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(new Error('Concurrent identity read barrier timed out')),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
  }
  function expectOneWinner(results: PromiseSettledResult<unknown>[]) {
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const loser = results.find((result) => result.status === 'rejected');
    expect(loser).toBeDefined();
    return loser?.status === 'rejected' ? (loser.reason as unknown) : undefined;
  }

  it('allows only one concurrent acceptance of the same token and creates exactly one identity and membership', async () => {
    const invitation = await invite();
    // A previously issued invite may still contain its original mixed casing.
    await prisma.userInvitation.update({
      where: { id: invitation.id },
      data: { email: email.toUpperCase() },
    });
    overlapAvailabilityReads();
    const results = await Promise.allSettled([
      users.acceptInvitation(invitation.token, password, 'First contender'),
      users.acceptInvitation(
        invitation.token,
        otherPassword,
        'Second contender',
      ),
    ]);
    expect(expectOneWinner(results)).toBeInstanceOf(BadRequestException);
    expect(availabilityReads).toBe(2);
    const stored = await identities();
    expect(stored).toHaveLength(1);
    expect(stored[0].email).toBe(email);
    expect(stored[0].companies).toHaveLength(1);
    expect(stored[0].companies[0]).toMatchObject({
      companyId: companyIds[0],
      roleId: roleIds[0],
    });
    const winnerIndex = results.findIndex(
      (result) => result.status === 'fulfilled',
    );
    expect(
      await bcrypt.compare(
        winnerIndex === 0 ? password : otherPassword,
        stored[0].passwordHash,
      ),
    ).toBe(true);
    expect(
      await bcrypt.compare(
        winnerIndex === 0 ? otherPassword : password,
        stored[0].passwordHash,
      ),
    ).toBe(false);
    expect(await savedInvitation(invitation.id)).toMatchObject({
      email: email.toUpperCase(),
      acceptedById: stored[0].id,
      acceptedAt: expect.any(Date) as unknown,
    });
    await expect(
      users.acceptInvitation(invitation.token, password),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await identities()).toHaveLength(1);
    expect(
      await prisma.auditLog.count({
        where: { companyId: companyIds[0], action: 'USER_INVITE_ACCEPT' },
      }),
    ).toBe(1);
  });

  it('rejects the losing invitation for the same canonical email without linking or reassigning the winning identity', async () => {
    const invitations = [
      await invite(0, email.toUpperCase()),
      await invite(1, email),
    ];
    overlapAvailabilityReads();
    const results = await Promise.allSettled(
      invitations.map((invitation, index) =>
        users.acceptInvitation(
          invitation.token,
          index === 0 ? password : otherPassword,
        ),
      ),
    );
    expect(expectOneWinner(results)).toBeInstanceOf(ConflictException);
    const winnerIndex = results.findIndex(
      (result) => result.status === 'fulfilled',
    );
    const loserIndex = 1 - winnerIndex;
    const stored = await identities();
    expect(stored).toHaveLength(1);
    expect(stored[0].companies).toHaveLength(1);
    expect(stored[0].companies[0]).toMatchObject({
      companyId: companyIds[winnerIndex],
      roleId: roleIds[winnerIndex],
    });
    expect(
      await bcrypt.compare(
        winnerIndex === 0 ? password : otherPassword,
        stored[0].passwordHash,
      ),
    ).toBe(true);
    expect(await savedInvitation(invitations[winnerIndex].id)).toMatchObject({
      acceptedById: stored[0].id,
      acceptedAt: expect.any(Date) as unknown,
    });
    expect(await savedInvitation(invitations[loserIndex].id)).toMatchObject({
      acceptedAt: null,
      acceptedById: null,
    });
    await expect(
      users.acceptInvitation(invitations[loserIndex].token, password),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await identities())[0]).toEqual(stored[0]);
  });

  it('converges concurrent mixed-case direct creation on the canonical database unique key', async () => {
    overlapAvailabilityReads();
    const results = await Promise.allSettled([
      users.createUser(email.toUpperCase(), password, 'Upper contender'),
      users.createUser(email, otherPassword, 'Lower contender'),
    ]);
    expect(expectOneWinner(results)).toBeInstanceOf(ConflictException);
    expect(availabilityReads).toBe(2);
    const stored = await identities();
    expect(stored).toHaveLength(1);
    expect(stored[0].email).toBe(email);
    expect(stored[0].companies).toHaveLength(0);
    const winnerIndex = results.findIndex(
      (result) => result.status === 'fulfilled',
    );
    expect(
      await bcrypt.compare(
        winnerIndex === 0 ? password : otherPassword,
        stored[0].passwordHash,
      ),
    ).toBe(true);
  });

  it('keeps direct creation and invitation acceptance from taking over each other in a canonical email race', async () => {
    const invitation = await invite();
    overlapAvailabilityReads();
    const results = await Promise.allSettled([
      users.createUser(email.toUpperCase(), password, 'Direct contender'),
      users.acceptInvitation(
        invitation.token,
        otherPassword,
        'Invitation contender',
      ),
    ]);
    expect(expectOneWinner(results)).toBeInstanceOf(ConflictException);
    const stored = await identities();
    expect(stored).toHaveLength(1);
    const directWon = results[0].status === 'fulfilled';
    expect(
      await bcrypt.compare(
        directWon ? password : otherPassword,
        stored[0].passwordHash,
      ),
    ).toBe(true);
    expect(stored[0].companies).toHaveLength(directWon ? 0 : 1);
    expect(await savedInvitation(invitation.id)).toMatchObject(
      directWon
        ? { acceptedAt: null, acceptedById: null }
        : {
            acceptedAt: expect.any(Date) as unknown,
            acceptedById: stored[0].id,
          },
    );
  });

  it('rolls back the token claim, user and actual membership insert on failure, then permits a clean retry', async () => {
    const invitation = await invite();
    failAfterMembership = true;
    await expect(
      users.acceptInvitation(invitation.token, password),
    ).rejects.toThrow('synthetic failure after actual membership insertion');
    expect(await identities()).toHaveLength(0);
    expect(await savedInvitation(invitation.id)).toMatchObject({
      acceptedAt: null,
      acceptedById: null,
    });
    expect(
      await prisma.userCompanyRole.count({
        where: { companyId: companyIds[0], userId: { not: inviterId } },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { companyId: companyIds[0], action: 'USER_INVITE_ACCEPT' },
      }),
    ).toBe(0);
    const accepted = await users.acceptInvitation(invitation.token, password);
    expect(accepted?.email).toBe(email);
    expect(await identities()).toHaveLength(1);
    expect((await identities())[0].companies).toHaveLength(1);
    expect(await savedInvitation(invitation.id)).toMatchObject({
      acceptedAt: expect.any(Date) as unknown,
      acceptedById: accepted?.id,
    });
  });

  it('rechecks stored expiry at the atomic claim after an initially valid invitation read', async () => {
    const invitation = await invite();
    afterAvailabilityRead = async () => {
      afterAvailabilityRead = undefined;
      // Change the real stored expiry after the service's initial token check;
      // the conditional UPDATE must observe it instead of the stale snapshot.
      await prisma.userInvitation.update({
        where: { id: invitation.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    };
    await expect(
      users.acceptInvitation(invitation.token, password),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await identities()).toHaveLength(0);
    expect(await savedInvitation(invitation.id)).toMatchObject({
      acceptedAt: null,
      acceptedById: null,
    });
  });

  it('refuses legacy mixed-case identities without overwriting credentials, changing identity or attaching membership', async () => {
    const invitation = await invite();
    const legacy = await prisma.user.create({
      data: {
        email: email.toUpperCase(),
        name: 'Legacy identity',
        passwordHash: 'unchanged-synthetic-hash',
        isActive: false,
      },
    });
    await expect(
      users.acceptInvitation(invitation.token, password),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      users.createUser(email, password, 'Replacement'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(invite(1, email)).rejects.toBeInstanceOf(ConflictException);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } }),
    ).toEqual(legacy);
    expect(await identities()).toHaveLength(1);
    expect((await identities())[0].companies).toHaveLength(0);
    expect(await savedInvitation(invitation.id)).toMatchObject({
      acceptedAt: null,
      acceptedById: null,
    });
    expect(await users.findByEmail(email)).toBeNull(); // No case-insensitive auth fallback.
  });

  it('refuses a forbidden role before creating or modifying any employee identity', async () => {
    const elevatedRole = await prisma.role.create({
      data: {
        name: `Synthetic elevated ${randomUUID()}`,
        permissions: ['ALL'],
      },
    });
    roleIds.push(elevatedRole.id);
    await expect(
      users.createAndAssignUser(
        companyIds[0],
        {
          email,
          password,
          name: 'Forbidden employee',
          roleId: elevatedRole.id,
        },
        inviterId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await identities()).toHaveLength(0);
    expect(
      await prisma.userCompanyRole.count({
        where: { companyId: companyIds[0], userId: { not: inviterId } },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { companyId: companyIds[0], action: 'USER_CREATE' },
      }),
    ).toBe(0);
  });
});
