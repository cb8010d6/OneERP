import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentCompany } from '../decorators/current-company.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { TenantGuard } from '../guards/tenant.guard';
import {
  AIChat2SqlDto,
  AICommandDto,
  AIChat2DashDto,
} from './dto/ai-command.dto';
import { AIService } from './ai.service';

interface CurrentUserPayload {
  id: string;
}

@ApiTags('AI Copilot v1')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('v1/ai')
export class AIController {
  constructor(private readonly aiService: AIService) {}

  @Get('tools')
  @ApiOperation({ summary: '获取 Function Calling 工具描述' })
  async tools() {
    return {
      tools: await this.aiService.getToolSchemas(),
    };
  }

  @Post('command')
  @ApiOperation({ summary: '自然语言指令入口 (NL2Action)' })
  command(
    @Body() dto: AICommandDto,
    @CurrentCompany() companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.aiService.command(dto.input, companyId, user.id, {
      dryRun: Boolean(dto.dryRun),
      overrideTool: dto.overrideTool,
    });
  }

  @Post('chat2dash')
  @ApiOperation({ summary: 'Smart Dashboard 对话分析入口' })
  chat2dash(@Body() dto: AIChat2DashDto, @CurrentCompany() companyId: string) {
    return this.aiService.chat2dash(dto.input, companyId);
  }

  @Post('chat2sql')
  @ApiOperation({ summary: 'Chat2SQL 只读查询入口' })
  chat2sql(@Body() dto: AIChat2SqlDto, @CurrentCompany() companyId: string) {
    return this.aiService.chat2sql(dto.input, companyId);
  }

  @Post('documents/parse')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: '多模态单据解析（Draft）' })
  parseDocument(
    @UploadedFile() file: Express.Multer.File,
    @CurrentCompany() companyId: string,
  ) {
    return this.aiService.parseDocumentDraft(file, companyId);
  }
}
