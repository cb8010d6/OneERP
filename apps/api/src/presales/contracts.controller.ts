import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { RequirePermissions } from '../core/decorators/permissions.decorator';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import type { JwtUserPayload } from '../core/http/request.types';
import { Permission } from '../core/permissions/permissions';
import { CreateContractDto } from './dto/create-contract.dto';
import { ContractDecisionDto } from './dto/contract-decision.dto';
import { PresalesService } from './presales.service';

@ApiTags('销售合同 (Contracts)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('presales/contracts')
export class ContractsController {
  constructor(private readonly presalesService: PresalesService) {}

  @Post('from-quote-version/:versionId')
  @RequirePermissions(Permission.ContractCreate)
  @ApiOperation({ summary: '从已接受报价版本登记合同 V1' })
  createFromQuoteVersion(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('versionId') versionId: string,
    @Body() data: CreateContractDto,
  ) {
    return this.presalesService.createContractFromQuoteVersion(
      companyId,
      user.id,
      versionId,
      data,
    );
  }

  @Post(':contractId/submit')
  @RequirePermissions(Permission.ContractSubmit)
  @ApiOperation({ summary: '提交合同审批' })
  submit(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('contractId') contractId: string,
  ) {
    return this.presalesService.submitContract(companyId, user.id, contractId);
  }

  @Post(':contractId/sales-manager/decision')
  @RequirePermissions(Permission.ContractApproveSales)
  @ApiOperation({ summary: '销售主管审批合同' })
  salesManagerDecision(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('contractId') contractId: string,
    @Body() data: ContractDecisionDto,
  ) {
    return this.presalesService.decideContract(
      companyId,
      user.id,
      contractId,
      'SALES_MANAGER',
      data,
    );
  }

  @Post(':contractId/finance/decision')
  @RequirePermissions(Permission.ContractReviewFinance)
  @ApiOperation({ summary: '财务复核合同' })
  financeDecision(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('contractId') contractId: string,
    @Body() data: ContractDecisionDto,
  ) {
    return this.presalesService.decideContract(
      companyId,
      user.id,
      contractId,
      'FINANCE',
      data,
    );
  }

  @Post(':contractId/business/decision')
  @RequirePermissions(Permission.ContractReviewBusiness)
  @ApiOperation({ summary: '商务复核合同' })
  businessDecision(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('contractId') contractId: string,
    @Body() data: ContractDecisionDto,
  ) {
    return this.presalesService.decideContract(
      companyId,
      user.id,
      contractId,
      'BUSINESS',
      data,
    );
  }
}
