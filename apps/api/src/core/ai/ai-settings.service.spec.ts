import { BadRequestException } from '@nestjs/common';
import { AISettingsService } from './ai-settings.service';

interface UpsertArgs {
  where: { companyId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

function createService() {
  let row: Record<string, unknown> | null = null;
  const prisma = {
    aiProviderSetting: {
      findUnique: jest.fn(() => Promise.resolve(row)),
      upsert: jest.fn((args: UpsertArgs) => {
        row = {
          ...(row ?? {}),
          ...args.create,
          ...args.update,
          companyId: args.where.companyId,
        };
        return Promise.resolve(row);
      }),
    },
  };

  return {
    service: new AISettingsService(prisma as never),
    prisma,
    getRow: () => row,
  };
}

describe('AISettingsService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      AI_SETTINGS_ENCRYPTION_KEY: 'test-encryption-secret',
      AI_API_KEY: '',
      OPENAI_API_KEY: '',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('encrypts stored API keys and only returns masked public settings', async () => {
    const { service, getRow } = createService();

    const result = await service.updateSettings('c1', {
      baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1/',
      apiKey: 'secret-test-key',
      defaultModel: 'mimo-v2.5',
      proModel: 'mimo-v2.5-pro',
    });

    expect(result.hasApiKey).toBe(true);
    expect(result.apiKeyPreview).toBe('••••-key');
    expect(String(getRow()?.apiKeyEncrypted)).not.toContain('secret-test-key');
  });

  it('decrypts company-level keys for runtime use', async () => {
    const { service } = createService();
    await service.updateSettings('c1', {
      apiKey: 'secret-runtime-key',
      defaultModel: 'mimo-v2.5',
      proModel: 'mimo-v2.5-pro',
    });

    const effective = await service.getEffectiveSettings('c1');

    expect(effective.apiKey).toBe('secret-runtime-key');
    expect(effective.model).toBe('mimo-v2.5');
  });

  it('requires an encryption secret before saving a company API key', async () => {
    process.env.AI_SETTINGS_ENCRYPTION_KEY = '';
    const { service } = createService();

    await expect(
      service.updateSettings('c1', { apiKey: 'secret-test-key' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
