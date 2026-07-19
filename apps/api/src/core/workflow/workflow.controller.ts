import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../decorators/current-company.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { TenantGuard } from '../guards/tenant.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { Permission } from '../permissions/permissions';
import { TransitionWorkflowDto } from './dto/transition-workflow.dto';
import { WorkflowService } from './workflow.service';

interface CurrentUserPayload {
  id: string;
}

@ApiTags('通用流程引擎 (Workflow)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('v1/workflow')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Post(':modelName/:id/transition')
  @RequirePermissions(Permission.WorkflowTransitionAuto)
  @ApiOperation({ summary: '执行模型状态流转' })
  transition(
    @Param('modelName') modelName: string,
    @Param('id') id: string,
    @Body() body: TransitionWorkflowDto,
    @CurrentCompany() companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.workflowService.transition(
      modelName,
      id,
      body.action,
      companyId,
      user.id,
      body.note,
      body.data,
    );
  }
}
