import { Injectable, Module } from '@nestjs/common';

const REQUIRED_VARS = [
  'JWT_SECRET',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'CORS_ORIGINS',
] as const;

const PRODUCTION_REQUIRED_VARS = [
  ...REQUIRED_VARS,
  'POSTGRES_PASSWORD',
  'DATABASE_URL',
] as const;

function assertConfig(): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const requiredVars = isProduction ? PRODUCTION_REQUIRED_VARS : REQUIRED_VARS;

  const missing: string[] = [];

  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (!value || value.trim() === '' || value.startsWith('CHANGE_ME')) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    const message = `Missing or invalid required environment variables: ${missing.join(', ')}`;
    throw new Error(
      `[CONFIG VALIDATION] ${message}. Application cannot start without valid configuration.`,
    );
  }

  if (isProduction) {
    if (process.env.JWT_SECRET === 'EIP_SECRET_KEY_SUPER_SECURE') {
      throw new Error(
        '[CONFIG VALIDATION] JWT_SECRET cannot use default insecure value in production',
      );
    }

    if (!process.env.CORS_ORIGINS || process.env.CORS_ORIGINS.trim() === '') {
      throw new Error(
        '[CONFIG VALIDATION] CORS_ORIGINS must be configured in production',
      );
    }

    if (
      process.env.MINIO_ACCESS_KEY === 'minio_admin' ||
      process.env.MINIO_SECRET_KEY === 'minio_password'
    ) {
      throw new Error(
        '[CONFIG VALIDATION] MinIO credentials cannot use default values in production',
      );
    }
  }
}

@Injectable()
export class ConfigValidationService {
  constructor() {
    assertConfig();
  }
}

@Module({
  providers: [ConfigValidationService],
})
export class ConfigValidationModule {}
