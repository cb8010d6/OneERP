import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentCompany } from '../decorators/current-company.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { TenantGuard } from '../guards/tenant.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { Permission, hasPermission } from '../permissions/permissions';
import type { RequestWithAuth } from '../http/request.types';
import {
  AIChat2SqlDto,
  AICommandDto,
  AIChat2DashDto,
} from './dto/ai-command.dto';
import { AISettingsDto } from './dto/ai-settings.dto';
import { AIService } from './ai.service';
import { AISettingsService } from './ai-settings.service';
import { validateUpload } from '../../files/upload-validation';
import { multerUploadOptions } from '../../files/multer-options';

interface CurrentUserPayload {
  id: string;
}

type UploadedDocument = {
  originalname: string;
  mimetype: string;
  size: number;
};

@ApiTags('AI Copilot v1')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('v1/ai')
export class AIController {
  constructor(
    private readonly aiService: AIService,
    private readonly aiSettingsService: AISettingsService,
  ) {}

  @Get('tools')
  @RequirePermissions(Permission.AiRead)
  @ApiOperation({ summary: '获取 Function Calling 工具描述' })
  async tools() {
    return {
      tools: await this.aiService.getToolSchemas(),
    };
  }

  @Get('settings')
  @RequirePermissions(Permission.AiRead)
  @ApiOperation({ summary: '获取当前公司 AI Provider 配置（密钥脱敏）' })
  settings(@CurrentCompany() companyId: string) {
    return this.aiSettingsService.getPublicSettings(companyId);
  }

  @Put('settings')
  @RequirePermissions(Permission.AiSettingsUpdate)
  @ApiOperation({ summary: '更新当前公司 AI Provider 配置' })
  updateSettings(
    @Body() dto: AISettingsDto,
    @CurrentCompany() companyId: string,
  ) {
    return this.aiSettingsService.updateSettings(companyId, dto);
  }

  @Post('settings/test')
  @RequirePermissions(Permission.AiSettingsUpdate)
  @ApiOperation({ summary: '测试当前公司 AI Provider 连接' })
  testSettings(
    @Body() dto: AISettingsDto,
    @CurrentCompany() companyId: string,
  ) {
    return this.aiSettingsService.testConnection(companyId, dto);
  }

  @Post('command')
  @RequirePermissions(Permission.AiRead)
  @ApiOperation({ summary: '自然语言指令入口 (NL2Action)' })
  command(
    @Body() dto: AICommandDto,
    @CurrentCompany() companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: RequestWithAuth,
  ) {
    if (dto.dryRun === false) {
      if (process.env.AI_WRITE_ENABLED !== 'true') {
        throw new ForbiddenException('AI 写操作未启用');
      }
      if (!hasPermission(request.userRole?.permissions, Permission.AiWrite)) {
        throw new ForbiddenException('当前角色无权执行 AI 写操作');
      }
    }

    return this.aiService.command(dto.input, companyId, user.id, {
      dryRun: dto.dryRun !== false,
      overrideTool: dto.overrideTool,
      confirmation: dto.confirmation,
    });
  }

  @Post('chat2dash')
  @RequirePermissions(Permission.AiRead)
  @ApiOperation({ summary: 'Smart Dashboard 对话分析入口' })
  chat2dash(@Body() dto: AIChat2DashDto, @CurrentCompany() companyId: string) {
    return this.aiService.chat2dash(dto.input, companyId);
  }

  @Post('chat2sql')
  @RequirePermissions(Permission.AiRead)
  @ApiOperation({ summary: 'Chat2SQL 只读查询入口' })
  chat2sql(@Body() dto: AIChat2SqlDto, @CurrentCompany() companyId: string) {
    return this.aiService.chat2sql(dto.input, companyId);
  }

  @Post('documents/parse')
  @RequirePermissions(Permission.AiRead)
  @UseInterceptors(FileInterceptor('file', multerUploadOptions))
  @ApiOperation({ summary: '多模态单据解析（Draft）' })
  parseDocument(
    @UploadedFile() file: UploadedDocument | undefined,
    @CurrentCompany() companyId: string,
  ) {
    validateUpload(file);
    return this.aiService.parseDocumentDraft(file, companyId);
  }
}
