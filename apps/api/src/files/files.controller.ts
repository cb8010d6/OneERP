import {
  Controller,
  Get,
  Post,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FilesService } from './files.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { RequirePermissions } from '../core/decorators/permissions.decorator';
import { Permission } from '../core/permissions/permissions';
import type { JwtUserPayload } from '../core/http/request.types';

@ApiTags('文件库 (Files)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @RequirePermissions(Permission.FileRecordCreate)
  @ApiOperation({ summary: '上传文件到公司文件库' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Query('folder') folder?: string,
  ) {
    return this.filesService.uploadFile(file, companyId, user.id, folder);
  }

  @Get()
  @RequirePermissions(Permission.FileRecordRead)
  @ApiOperation({ summary: '获取公司文件列表' })
  async getFiles(@CurrentCompany() companyId: string) {
    return this.filesService.getFilesByCompany(companyId);
  }

  @Get('download-url')
  @RequirePermissions(Permission.FileRecordRead)
  @ApiOperation({ summary: '获取文件的临时安全下载链接' })
  async getDownloadUrl(
    @Query('path') objectPath: string,
    @CurrentCompany() companyId: string,
  ) {
    if (!objectPath.startsWith(companyId)) {
      throw new UnauthorizedException('无权访问或下载其他公司的文件');
    }

    const url = await this.filesService.getFilePresignedUrl(objectPath);
    return { url };
  }
}
