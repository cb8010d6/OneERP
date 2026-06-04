import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AISettingsDto } from './dto/ai-settings.dto';

export type AIProvider = 'openai-compatible' | 'anthropic-compatible';
export type AIModelPurpose = 'default' | 'sql' | 'document';

export interface EffectiveAISettings {
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  defaultModel: string;
  proModel: string;
  useProForSql: boolean;
  useProForDocuments: boolean;
  timeoutMs: number;
}

const DEFAULT_PROVIDER: AIProvider = 'openai-compatible';
const DEFAULT_BASE_URL = 'https://token-plan-sgp.xiaomimimo.com/v1';
const DEFAULT_MODEL = 'mimo-v2.5';
const DEFAULT_PRO_MODEL = 'mimo-v2.5-pro';

@Injectable()
export class AISettingsService {
  private readonly logger = new Logger(AISettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getPublicSettings(companyId: string) {
    const setting = await this.prisma.aiProviderSetting.findUnique({
      where: { companyId },
    });
    const effective = await this.getEffectiveSettings(companyId);
    const apiKeySource = setting?.apiKeyEncrypted
      ? 'company'
      : effective.apiKey
        ? 'environment'
        : 'none';

    return {
      provider: effective.provider,
      baseUrl: effective.baseUrl,
      defaultModel: effective.defaultModel,
      proModel: effective.proModel,
      useProForSql: effective.useProForSql,
      useProForDocuments: effective.useProForDocuments,
      hasApiKey: Boolean(effective.apiKey),
      apiKeyPreview:
        apiKeySource === 'company' ? setting?.apiKeyPreview : undefined,
      apiKeySource,
      source: setting ? 'company' : 'environment',
    };
  }

  async updateSettings(companyId: string, dto: AISettingsDto) {
    const data: {
      provider?: AIProvider;
      baseUrl?: string;
      apiKeyEncrypted?: string | null;
      apiKeyPreview?: string | null;
      defaultModel?: string;
      proModel?: string;
      useProForSql?: boolean;
      useProForDocuments?: boolean;
    } = {};

    if (dto.provider) data.provider = dto.provider;
    if (dto.baseUrl) data.baseUrl = this.normalizeBaseUrl(dto.baseUrl);
    if (dto.defaultModel) data.defaultModel = dto.defaultModel.trim();
    if (dto.proModel) data.proModel = dto.proModel.trim();
    if (typeof dto.useProForSql === 'boolean') {
      data.useProForSql = dto.useProForSql;
    }
    if (typeof dto.useProForDocuments === 'boolean') {
      data.useProForDocuments = dto.useProForDocuments;
    }

    const apiKey = dto.apiKey?.trim();
    if (apiKey) {
      data.apiKeyEncrypted = this.encrypt(apiKey);
      data.apiKeyPreview = this.maskApiKey(apiKey);
    } else if (dto.clearApiKey) {
      data.apiKeyEncrypted = null;
      data.apiKeyPreview = null;
    }

    await this.prisma.aiProviderSetting.upsert({
      where: { companyId },
      create: {
        companyId,
        provider: data.provider ?? DEFAULT_PROVIDER,
        baseUrl: data.baseUrl ?? this.defaultBaseUrl(),
        defaultModel: data.defaultModel ?? this.defaultModel(),
        proModel: data.proModel ?? this.defaultProModel(),
        useProForSql: data.useProForSql ?? true,
        useProForDocuments: data.useProForDocuments ?? true,
        apiKeyEncrypted: data.apiKeyEncrypted,
        apiKeyPreview: data.apiKeyPreview,
      },
      update: data,
    });

    return this.getPublicSettings(companyId);
  }

  async testConnection(companyId: string, dto?: AISettingsDto) {
    const settings = await this.getEffectiveSettings(companyId, 'default', dto);
    if (!settings.apiKey) {
      return { ok: false, message: '缺少 AI API key' };
    }
    if (settings.provider !== 'openai-compatible') {
      return {
        ok: false,
        message: '当前版本仅支持 OpenAI-compatible /v1 调用',
      };
    }

    try {
      const response = await fetch(
        this.buildChatCompletionsUrl(settings.baseUrl),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: settings.model,
            temperature: 0,
            max_tokens: 16,
            messages: [
              { role: 'system', content: 'Return only OK.' },
              { role: 'user', content: 'ping' },
            ],
          }),
          signal: AbortSignal.timeout(settings.timeoutMs),
        },
      );

      if (!response.ok) {
        return {
          ok: false,
          message: `AI 连接失败，HTTP ${response.status}`,
        };
      }

      return {
        ok: true,
        message: 'AI 连接成功',
        model: settings.model,
        baseUrl: settings.baseUrl,
      };
    } catch (error) {
      return {
        ok: false,
        message: `AI 连接失败: ${this.redactError(error, settings.apiKey)}`,
      };
    }
  }

  async getEffectiveSettings(
    companyId: string,
    purpose: AIModelPurpose = 'default',
    overrides?: AISettingsDto,
  ): Promise<EffectiveAISettings> {
    const setting = companyId
      ? await this.prisma.aiProviderSetting.findUnique({ where: { companyId } })
      : null;
    const provider = this.normalizeProvider(
      overrides?.provider ?? setting?.provider ?? process.env.AI_PROVIDER,
    );
    const baseUrl = this.normalizeBaseUrl(
      overrides?.baseUrl ?? setting?.baseUrl ?? this.defaultBaseUrl(),
    );
    const defaultModel = (
      overrides?.defaultModel ??
      setting?.defaultModel ??
      this.defaultModel()
    ).trim();
    const proModel = (
      overrides?.proModel ??
      setting?.proModel ??
      this.defaultProModel()
    ).trim();
    const useProForSql =
      overrides?.useProForSql ?? setting?.useProForSql ?? true;
    const useProForDocuments =
      overrides?.useProForDocuments ?? setting?.useProForDocuments ?? true;
    const overrideApiKey = overrides?.apiKey?.trim();
    const apiKey =
      overrideApiKey ||
      this.decryptStoredKey(setting?.apiKeyEncrypted) ||
      process.env.AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      '';
    const model =
      purpose === 'sql' && useProForSql
        ? proModel
        : purpose === 'document' && useProForDocuments
          ? proModel
          : defaultModel;

    return {
      provider,
      baseUrl,
      apiKey,
      model,
      defaultModel,
      proModel,
      useProForSql,
      useProForDocuments,
      timeoutMs: this.timeoutMs(),
    };
  }

  buildChatCompletionsUrl(baseUrl: string) {
    const normalized = this.normalizeBaseUrl(baseUrl);
    if (normalized.endsWith('/chat/completions')) {
      return normalized;
    }
    return `${normalized}/chat/completions`;
  }

  private defaultBaseUrl() {
    return (
      process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL
    );
  }

  private defaultModel() {
    return process.env.AI_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL;
  }

  private defaultProModel() {
    return process.env.AI_PRO_MODEL || this.defaultModel() || DEFAULT_PRO_MODEL;
  }

  private timeoutMs() {
    const value = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 30000);
    return Number.isFinite(value) && value > 0 ? value : 30000;
  }

  private normalizeProvider(value?: string): AIProvider {
    return value === 'anthropic-compatible' ? value : DEFAULT_PROVIDER;
  }

  private normalizeBaseUrl(value: string) {
    return value.trim().replace(/\/+$/, '');
  }

  private encrypt(plainText: string) {
    const key = this.encryptionKey();
    if (!key) {
      throw new BadRequestException(
        '缺少 AI_SETTINGS_ENCRYPTION_KEY，无法安全保存 API key',
      );
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      'v1',
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  private decryptStoredKey(encrypted?: string | null) {
    if (!encrypted) return undefined;
    try {
      const key = this.encryptionKey();
      if (!key) {
        this.logger.warn('公司级 AI API key 解密失败: 缺少加密密钥');
        return undefined;
      }
      const [version, iv, tag, payload] = encrypted.split(':');
      if (version !== 'v1' || !iv || !tag || !payload) {
        throw new Error('unsupported key payload');
      }
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(iv, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(payload, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      this.logger.warn(
        `公司级 AI API key 解密失败: ${this.redactError(error)}`,
      );
      return undefined;
    }
  }

  private encryptionKey() {
    const secret = process.env.AI_SETTINGS_ENCRYPTION_KEY?.trim();
    if (!secret) return null;
    if (/^[a-f0-9]{64}$/i.test(secret)) {
      return Buffer.from(secret, 'hex');
    }
    if (secret.startsWith('base64:')) {
      const decoded = Buffer.from(secret.slice('base64:'.length), 'base64');
      if (decoded.length === 32) return decoded;
    }
    return createHash('sha256').update(secret).digest();
  }

  private maskApiKey(apiKey: string) {
    if (apiKey.length <= 8) return '••••';
    return `••••${apiKey.slice(-4)}`;
  }

  private redactError(error: unknown, secret?: string) {
    const raw = error instanceof Error ? error.message : String(error);
    if (!secret) return raw;
    return raw.split(secret).join('[REDACTED]');
  }
}
