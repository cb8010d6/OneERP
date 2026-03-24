import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
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
import { LoggerMiddleware } from './core/middlewares/logger.middleware';
import { DepartmentsModule } from './departments/departments.module';
import { AppCacheModule } from './core/cache/cache.module';
import { CrudModule } from './core/crud/crud.module';
import { MetadataModule } from './core/metadata/metadata.module';
import { WorkflowModule } from './core/workflow/workflow.module';
import { AIModule } from './core/ai/ai.module';
import { AuditModule } from './core/audit/audit.module';
import { TenantContextMiddleware } from './core/middlewares/tenant-context.middleware';
import { KyselyModule } from './core/prisma/kysely.module';

@Module({
  imports: [
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
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware, TenantContextMiddleware).forRoutes('*');
  }
}
