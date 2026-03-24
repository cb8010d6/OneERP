import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './core/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 开启 CORS 允许跨域请求，移动端、桌面端、Web端都能访问这个 API
  app.enableCors();

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
