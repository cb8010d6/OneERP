import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { PermissionsGuard } from '../core/guards/permissions.guard';

@Module({
  providers: [FilesService, PermissionsGuard],
  controllers: [FilesController],
})
export class FilesModule {}
