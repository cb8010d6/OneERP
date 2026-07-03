const DEFAULT_MAX_ATTEMPTS = 3;

interface UniqueRetryOptions {
  targetFields: string[];
  maxAttempts?: number;
}

interface PrismaKnownErrorLike {
  code?: string;
  meta?: {
    target?: string[] | string;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isPrismaUniqueConstraintError(
  error: unknown,
  targetFields: string[],
) {
  if (!isObject(error)) return false;

  const candidate = error as PrismaKnownErrorLike;
  if (candidate.code !== 'P2002') return false;

  const target = candidate.meta?.target;
  if (!target) return targetFields.length === 0;

  const targetList = Array.isArray(target) ? target : [target];
  return targetFields.some((field) => targetList.includes(field));
}

export async function withUniqueConstraintRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: UniqueRetryOptions,
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const canRetry =
        attempt < maxAttempts - 1 &&
        isPrismaUniqueConstraintError(error, options.targetFields);
      if (!canRetry) throw error;
    }
  }

  throw new Error('unreachable unique retry state');
}
