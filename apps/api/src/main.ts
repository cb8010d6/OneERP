import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { HelmetOptions } from 'helmet';
import type { RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './core/filters/all-exceptions.filter';

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:30055',
  'http://localhost:5173',
  'http://localhost:8080',
];
const allowedOrigins: string[] = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : DEFAULT_CORS_ORIGINS;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());

  const isProduction = process.env.NODE_ENV === 'production';

  const helmetMiddleware = helmet as unknown as (
    options: HelmetOptions,
  ) => RequestHandler;
  app.use(
    helmetMiddleware({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: [`'self'`],
          scriptSrc: isProduction
            ? [`'self'`]
            : [`'self'`, `'unsafe-inline'`, `'unsafe-eval'`],
          styleSrc: [`'self'`, `'unsafe-inline'`],
          imgSrc: [`'self'`, 'data:', 'https:'],
          fontSrc: [`'self'`, 'data:'],
          connectSrc: [`'self'`, 'http:', 'https:'],
        },
      },
      frameguard: { action: 'deny' },
      strictTransportSecurity: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true,
      xssFilter: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
      dnsPrefetchControl: { allow: false },
      ieNoOpen: true,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      originAgentCluster: true,
    }),
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS 策略拒绝: ${origin} 不在白名单中`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'x-company-id',
      'x-csrf-token',
    ],
  });

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('OneERP API')
      .setDescription('OneERP 后端接口文档')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = Number(process.env.PORT ?? 8000);
  await app.listen(port, '0.0.0.0');
  console.log(`OneERP API 已启动: http://localhost:${port}/api`);
  if (!isProduction) {
    console.log(`Swagger 接口文档地址: http://localhost:${port}/api/docs`);
  }
}
void bootstrap();
