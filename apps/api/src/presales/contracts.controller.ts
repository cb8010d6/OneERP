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
}
