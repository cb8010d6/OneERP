import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerBehindProxyGuard } from './core/guards/throttler-behind-proxy.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { OrdersModule } from './orders/orders.module';
import { FilesModule } from './files/files.module';
import { InventoryModule } from './inventory/inventory.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ProductionModule } from './production/production.module';
import { FinanceModule } from './finance/finance.module';
import { PurchaseModule } from './purchase/purchase.module';
import { LoggerMiddleware } from './core/middlewares/logger.middleware';
import { RequestIdMiddleware } from './core/middlewares/request-id.middleware';
import { DepartmentsModule } from './departments/departments.module';
import { AppCacheModule } from './core/cache/cache.module';
import { CrudModule } from './core/crud/crud.module';
import { MetadataModule } from './core/metadata/metadata.module';
import { WorkflowModule } from './core/workflow/workflow.module';
import { AIModule } from './core/ai/ai.module';
import { AuditModule } from './core/audit/audit.module';
import { TenantContextMiddleware } from './core/middlewares/tenant-context.middleware';
import { KyselyModule } from './core/prisma/kysely.module';
import { ConfigValidationModule } from './core/config/config-validation.module';
import { MetricsModule } from './core/metrics/metrics.module';
import { PresalesModule } from './presales/presales.module';

@Module({
  imports: [
    ConfigValidationModule,
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 100 }],
    }),
    AppCacheModule,
    KyselyModule,
    PrismaModule,
    MetadataModule,
    WorkflowModule,
    AuditModule,
    MetricsModule,
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
    PurchaseModule,
    DepartmentsModule,
    PresalesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware, LoggerMiddleware, TenantContextMiddleware)
      .forRoutes('*');
  }
}
