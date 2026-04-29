import { Module, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ThrottlerModule } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { OrdersModule } from "./orders/orders.module";
import { FilesModule } from "./files/files.module";
import { InventoryModule } from "./inventory/inventory.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { ProductionModule } from "./production/production.module";
import { FinanceModule } from "./finance/finance.module";
import { LoggerMiddleware } from "./core/middlewares/logger.middleware";
import { DepartmentsModule } from "./departments/departments.module";
import { AppCacheModule } from "./core/cache/cache.module";
import { CrudModule } from "./core/crud/crud.module";
import { MetadataModule } from "./core/metadata/metadata.module";
import { WorkflowModule } from "./core/workflow/workflow.module";
import { AIModule } from "./core/ai/ai.module";
import { AuditModule } from "./core/audit/audit.module";
import { TenantContextMiddleware } from "./core/middlewares/tenant-context.middleware";
import { KyselyModule } from "./core/prisma/kysely.module";
import { ThrottlerBehindProxyGuard } from "./core/guards/throttler-behind-proxy.guard";

@Module({
  imports: [
    // ──────────────── 限流配置 ────────────────
    // 全局默认规则：同一 IP 在 60 秒内最多 100 次请求（正常业务使用足够，超出视为异常流量）
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60_000, // 60 秒时间窗口（毫秒）
          limit: 100, // 每窗口最大请求数
        },
      ],
    }),

    EventEmitterModule.forRoot(),
    AppCacheModule,
    KyselyModule,
    PrismaModule,
    MetadataModule,
    WorkflowModule,
    AuditModule,
    AIModule,
    CrudModule,
    AuthModule,
    UsersModule,
    OrdersModule,
    FilesModule,
    InventoryModule,
    DashboardModule,
    ProductionModule,
    FinanceModule,
    DepartmentsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // 将限流守卫注册为全局守卫，对所有路由生效
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware, TenantContextMiddleware).forRoutes("*");
  }
}