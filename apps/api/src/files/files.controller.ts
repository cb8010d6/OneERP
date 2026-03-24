import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  Get,
  Query,
  Req,
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
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';

@ApiTags('文件库 (Files)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard) // 必须带 Token 且指定请求公司ID
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @ApiOperation({ summary: '上传文件到公司金库' })
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
  @UseInterceptors(FileInterceptor('file')) // 处理名为 `file` 的表单字段
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentCompany() companyId: string,
    @CurrentUser() user: any,
    @Query('folder') folder?: string,
  ) {
    // 您可以在此处添加权限检查，例如：如果角色是操作工，拒绝其上传 CAD
    return this.filesService.uploadFile(file, companyId, user.id, folder);
  }

  @Get()
  @ApiOperation({ summary: '获取公司文件列表' })
  async getFiles(@CurrentCompany() companyId: string) {
    return this.filesService.getFilesByCompany(companyId);
  }

  @Get('download-url')
  @ApiOperation({ summary: '获取文件的临时安全下载链接' })
  async getDownloadUrl(
    @Query('path') objectPath: string,
    @CurrentCompany() companyId: string,
  ) {
    // 关键防泄漏校验: 如果请求的图纸路径不属于当前人声明的公司目录下，或者强制用别的公司ID骗接口，都会被拦截
    if (!objectPath.startsWith(companyId)) {
      throw new UnauthorizedException('无权访问或下载其他公司的图纸资产');
    }

    const url = await this.filesService.getFilePresignedUrl(objectPath);
    return { url };
  }
}
