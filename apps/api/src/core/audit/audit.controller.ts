import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../decorators/current-company.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { TenantGuard } from '../guards/tenant.guard';
import { AuditService } from './audit.service';
import { CreateTimelineCommentDto } from './dto/create-timeline-comment.dto';

interface CurrentUserPayload {
  id: string;
}

@ApiTags('审计时间线 (Audit Timeline)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('v1/timeline')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get(':modelName/:recordId')
  @ApiOperation({ summary: '获取指定单据的时间线事件' })
  getTimeline(
    @Param('modelName') modelName: string,
    @Param('recordId') recordId: string,
    @CurrentCompany() companyId: string,
  ) {
    return this.auditService.getTimeline(modelName, recordId, companyId);
  }

  @Post(':modelName/:recordId/comment')
  @ApiOperation({ summary: '向单据时间线写入人工批注' })
  addComment(
    @Param('modelName') modelName: string,
    @Param('recordId') recordId: string,
    @CurrentCompany() companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: CreateTimelineCommentDto,
  ) {
    return this.auditService.addComment(
      modelName,
      recordId,
      companyId,
      user.id,
      body.content,
    );
  }
}
