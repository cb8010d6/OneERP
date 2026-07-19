import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { MetadataModule } from '../metadata/metadata.module';
import { CrudController } from './crud.controller';
import { CrudHooksService } from './crud-hooks.service';
import { CrudService } from './crud.service';
import { PermissionsGuard } from '../guards/permissions.guard';

@Module({
  imports: [PrismaModule, MetadataModule, AuditModule],
  controllers: [CrudController],
  providers: [CrudService, CrudHooksService, PermissionsGuard],
  exports: [CrudService, CrudHooksService],
})
export class CrudModule {}
