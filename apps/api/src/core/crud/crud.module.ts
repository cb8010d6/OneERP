import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { MetadataModule } from '../metadata/metadata.module';
import { CrudController } from './crud.controller';
import { CrudHooksService } from './crud-hooks.service';
import { CrudService } from './crud.service';

@Module({
  imports: [PrismaModule, MetadataModule, AuditModule],
  controllers: [CrudController],
  providers: [CrudService, CrudHooksService],
  exports: [CrudService, CrudHooksService],
})
export class CrudModule {}
