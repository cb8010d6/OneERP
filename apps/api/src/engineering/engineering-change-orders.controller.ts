import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { RequirePermissions } from '../core/decorators/permissions.decorator';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import type { JwtUserPayload } from '../core/http/request.types';
import { Permission } from '../core/permissions/permissions';
import {
  CreateEngineeringChangeOrderDto,
  DecideEngineeringChangeOrderDto,
} from './dto/engineering-change-orders.dto';
import { EngineeringChangeOrdersService } from './engineering-change-orders.service';

@ApiTags('工程变更单 (Engineering Change Orders)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('engineering-change-orders')
export class EngineeringChangeOrdersController {
  constructor(private readonly service: EngineeringChangeOrdersService) {}

  @Get()
  @RequirePermissions(Permission.EngineeringDocumentRead)
  list(
    @CurrentCompany() companyId: string,
    @Query('documentId') documentId?: string,
  ) {
    return this.service.list(companyId, documentId);
  }

  @Get('preview/:documentId/:targetRevisionId')
  @RequirePermissions(Permission.EngineeringDocumentCreate)
  preview(
    @CurrentCompany() companyId: string,
    @Param('documentId') documentId: string,
    @Param('targetRevisionId') targetRevisionId: string,
  ) {
    return this.service.preview(companyId, documentId, targetRevisionId);
  }

  @Post(':documentId')
  @RequirePermissions(Permission.EngineeringDocumentCreate)
  @ApiOperation({ summary: '创建覆盖全部受影响在制工单的工程变更单' })
  create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('documentId') documentId: string,
    @Body() data: CreateEngineeringChangeOrderDto,
  ) {
    return this.service.create(companyId, user.id, documentId, data);
  }

  @Post(':ecoId/submit')
  @RequirePermissions(Permission.EngineeringDocumentCreate)
  submit(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('ecoId') ecoId: string,
  ) {
    return this.service.submit(companyId, user.id, ecoId);
  }

  @Post(':ecoId/decision')
  @RequirePermissions(Permission.EngineeringDocumentApprove)
  decide(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('ecoId') ecoId: string,
    @Body() data: DecideEngineeringChangeOrderDto,
  ) {
    return this.service.decide(companyId, user.id, ecoId, data);
  }
}
