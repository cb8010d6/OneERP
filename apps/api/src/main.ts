import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { HelmetOptions } from 'helmet';
import type { RequestHandler } from 'express';
import { AllExceptionsFilter } from './core/filters/all-exceptions.filter';

// CORS 白名单：通过环境变量 CORS_ORIGINS 配置（逗号分隔），未配置时使用开发默认值
const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080',
];
const allowedOrigins: string[] = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : DEFAULT_CORS_ORIGINS;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ── 安全响应头（Helmet） ──────────────────────────────────────
  const helmetMiddleware = helmet as unknown as (
    options: HelmetOptions,
  ) => RequestHandler;
  app.use(
    helmetMiddleware({
      // Content-Security-Policy: 限制资源加载来源
      contentSecurityPolicy: {
        directives: {
          defaultSrc: [`'self'`],
          // 允许 Swagger UI 加载内联脚本/样式及 CDN 资源
          scriptSrc: [`'self'`, `'unsafe-inline'`, `'unsafe-eval'`],
          styleSrc: [`'self'`, `'unsafe-inline'`],
          imgSrc: [`'self'`, 'data:', 'https:'],
          fontSrc: [`'self'`, 'data:'],
          // connectSrc 放开以便 Swagger "Try it out" 能调用 API
          connectSrc: [`'self'`, 'http:', 'https:'],
        },
      },
      // X-Frame-Options: 禁止被 iframe 嵌入，防止点击劫持
      frameguard: { action: 'deny' },
      // HSTS: 强制浏览器使用 HTTPS
      strictTransportSecurity: {
        maxAge: 31536000, // 1 年
        includeSubDomains: true,
        preload: true,
      },
      // X-Content-Type-Options: 禁止浏览器猜测 MIME 类型
      noSniff: true,
      // X-XSS-Protection: 启用旧版浏览器 XSS 过滤
      xssFilter: true,
      // Referrer-Policy: 控制 Referer 信息泄露
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // 禁止 Flash/PDF 跨域策略
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
      // 关闭 DNS 预取防止信息泄露
      dnsPrefetchControl: { allow: false },
      // IE 专用：阻止下载后直接执行
      ieNoOpen: true,
      // API 场景下关闭 COEP 避免影响跨域资源加载
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      originAgentCluster: true,
    }),
  );

  // 开启 CORS，仅允许白名单域名跨域请求
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // 允许无 origin 的请求（如服务端调用、Postman、移动端原生请求）
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS 策略拒绝: ${origin} 不在白名单中`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'x-company-id'],
  });

  // 设置全局前缀
  app.setGlobalPrefix('api');

  // 全局异常过滤器
  app.useGlobalFilters(new AllExceptionsFilter());

  // 全局校验管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // 配置 Swagger
  const config = new DocumentBuilder()
    .setTitle('EIP API')
    .setDescription('ERP/EIP 后端接口文档')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // 监听 0.0.0.0 使暴露在内网网段
  // 确保端口为 8000 避免和其他默认应用冲突
  await app.listen(process.env.PORT ?? 8000, '0.0.0.0');
  console.log(
    `EIP 核心服务已运行，内网任意设备均可通过 http://[主机局域网IP]:8000/api 访问 API`,
  );
  console.log(`Swagger 接口文档地址: http://localhost:8000/api/docs`);
}
void bootstrap();
