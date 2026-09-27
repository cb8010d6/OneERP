import type { PrismaClient } from '@prisma/client';

/** Read-only identity check. Never rename or merge a legacy admin implicitly. */
export async function preflightAdminEmail(
  users: Pick<PrismaClient['user'], 'findMany'>,
  input: string,
): Promise<string> {
  const email = input.trim().toLowerCase();
  if (!email) {
    throw new Error(
      'INIT_ADMIN_EMAIL is required for production initialization',
    );
  }

  const matches = await users.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { email: true },
    take: 2,
  });
  if (matches.length > 1 || matches.some((user) => user.email !== email)) {
    throw new Error(
      'INIT_ADMIN_EMAIL conflicts with an existing noncanonical or ambiguous user identity. ' +
        'Initialization stopped before writes. Have an administrator review the case-insensitive ' +
        'email matches and resolve the identity explicitly before retrying; no account was renamed or merged.',
    );
  }
  return email;
}
