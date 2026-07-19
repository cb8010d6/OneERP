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
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { RequirePermissions } from '../core/decorators/permissions.decorator';
import { Permission } from '../core/permissions/permissions';
import type { JwtUserPayload } from '../core/http/request.types';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { ListRequirementsDto } from './dto/list-requirements.dto';
import { PresalesService } from './presales.service';
import { AddFollowUpDto } from './dto/add-follow-up.dto';
import { CloseRequirementDto } from './dto/close-requirement.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';

@ApiTags('售前管理 (Presales)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('presales/requirements')
export class PresalesController {
  constructor(private readonly presalesService: PresalesService) {}

  @Post()
  @RequirePermissions(Permission.RequirementCreate)
  @ApiOperation({ summary: '创建客户需求单' })
  createRequirement(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() data: CreateRequirementDto,
  ) {
    return this.presalesService.createRequirement(companyId, user.id, data);
  }

  @Get()
  @RequirePermissions(Permission.RequirementRead)
  @ApiOperation({ summary: '分页查询当前公司的客户需求单' })
  listRequirements(
    @CurrentCompany() companyId: string,
    @Query() query: ListRequirementsDto,
  ) {
    return this.presalesService.listRequirements(companyId, query);
  }

  @Post(':id/follow-ups')
  @RequirePermissions(Permission.RequirementFollowUp)
  @ApiOperation({ summary: '追加客户需求跟进记录' })
  addFollowUp(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') requirementId: string,
    @Body() data: AddFollowUpDto,
  ) {
    return this.presalesService.addFollowUp(
      companyId,
      user.id,
      requirementId,
      data,
    );
  }

  @Post(':id/quotes')
  @RequirePermissions(Permission.QuoteCreate)
  @ApiOperation({ summary: '从客户需求单创建报价 V1' })
  createQuoteFromRequirement(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') requirementId: string,
    @Body() data: CreateQuoteDto,
  ) {
    return this.presalesService.createQuoteFromRequirement(
      companyId,
      user.id,
      requirementId,
      data,
    );
  }

  @Post(':id/close')
  @RequirePermissions(Permission.RequirementUpdate)
  @ApiOperation({ summary: '关闭客户需求单' })
  closeRequirement(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') requirementId: string,
    @Body() data: CloseRequirementDto,
  ) {
    return this.presalesService.closeRequirement(
      companyId,
      user.id,
      requirementId,
      data,
    );
  }
}
