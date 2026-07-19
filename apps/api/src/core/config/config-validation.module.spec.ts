import { ConfigValidationService } from './config-validation.module';

describe('ConfigValidationService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      JWT_SECRET: 'test-jwt-secret',
      MINIO_ACCESS_KEY: 'test-minio-access-key',
      MINIO_SECRET_KEY: 'test-minio-secret-key',
      CORS_ORIGINS: 'http://localhost:3000',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('accepts required non-placeholder environment variables', () => {
    expect(() => new ConfigValidationService()).not.toThrow();
  });

  it('rejects missing required environment variables', () => {
    delete process.env.JWT_SECRET;

    expect(() => new ConfigValidationService()).toThrow(/JWT_SECRET/);
  });

  it('rejects insecure production defaults', () => {
    process.env.NODE_ENV = 'production';
    process.env.POSTGRES_PASSWORD = 'test-postgres-password';
    process.env.DATABASE_URL = 'postgresql://oneerp:test@localhost:5432/oneerp';
    process.env.JWT_SECRET = 'EIP_SECRET_KEY_SUPER_SECURE';

    expect(() => new ConfigValidationService()).toThrow(
      /default insecure value/,
    );
  });
});
