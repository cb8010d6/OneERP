import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
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
bootstrap();