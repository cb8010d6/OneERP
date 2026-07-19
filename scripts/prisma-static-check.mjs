import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const STATIC_CHECK_DATABASE_URL =
  'postgresql://oneerp_static_check:unused@127.0.0.1:5432/oneerp_static_check';

export function resolveStaticDatabaseUrl(env) {
  return env.DATABASE_URL || STATIC_CHECK_DATABASE_URL;
}

export function runPrismaStaticChecks() {
  const env = {
    ...process.env,
    DATABASE_URL: resolveStaticDatabaseUrl(process.env),
  };

  const prismaCli = resolve('apps/api/node_modules/prisma/build/index.js');
  const schema = resolve('apps/api/prisma/schema.prisma');

  for (const command of ['validate', 'generate']) {
    const result = spawnSync(
      process.execPath,
      [prismaCli, command, '--schema', schema],
      {
        cwd: process.cwd(),
        env,
        stdio: 'inherit',
      },
    );

    if (result.error) {
      console.error(`Failed to start prisma ${command}:`, result.error.message);
      return 1;
    }

    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }

  return 0;
}

const isMain =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  process.exitCode = runPrismaStaticChecks();
}
