export const DEFAULT_PUBLIC_API_BASE_URL = '/api/proxy';

export function resolvePublicApiBaseUrl(
  configured = process.env.NEXT_PUBLIC_API_BASE_URL,
) {
  const normalized = configured?.trim();
  return normalized || DEFAULT_PUBLIC_API_BASE_URL;
}
