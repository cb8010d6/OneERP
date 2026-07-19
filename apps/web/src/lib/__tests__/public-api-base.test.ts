import {
  DEFAULT_PUBLIC_API_BASE_URL,
  resolvePublicApiBaseUrl,
} from '../public-api-base';

describe('resolvePublicApiBaseUrl', () => {
  it('uses the same-origin proxy when no public API URL is configured', () => {
    expect(resolvePublicApiBaseUrl(undefined)).toBe('/api/proxy');
    expect(resolvePublicApiBaseUrl('   ')).toBe('/api/proxy');
    expect(DEFAULT_PUBLIC_API_BASE_URL).toBe('/api/proxy');
  });

  it('preserves an explicitly configured public API URL', () => {
    expect(resolvePublicApiBaseUrl(' https://erp.example.com/api ')).toBe(
      'https://erp.example.com/api',
    );
  });
});
