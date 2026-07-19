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
import { CreateQuoteVersionDto } from './dto/create-quote-version.dto';
import { QuoteDecisionDto } from './dto/quote-decision.dto';
import { PresalesService } from './presales.service';

@ApiTags('售前报价 (Quotes)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('presales/quotes')
export class QuotesController {
  constructor(private readonly presalesService: PresalesService) {}

  @Post(':quoteId/versions')
  @RequirePermissions(Permission.QuoteCreate)
  @ApiOperation({ summary: '复制当前报价版本为新草稿' })
  createVersion(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('quoteId') quoteId: string,
    @Body() data: CreateQuoteVersionDto,
  ) {
    return this.presalesService.createQuoteVersion(
      companyId,
      user.id,
      quoteId,
      data,
    );
  }

  @Post('versions/:versionId/send')
  @RequirePermissions(Permission.QuoteSend)
  @ApiOperation({ summary: '发出报价版本并固化状态' })
  sendVersion(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('versionId') versionId: string,
  ) {
    return this.presalesService.sendQuoteVersion(companyId, user.id, versionId);
  }

  @Post('versions/:versionId/decision')
  @RequirePermissions(Permission.QuoteRecordDecision)
  @ApiOperation({ summary: '记录客户接受或拒绝报价' })
  recordDecision(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('versionId') versionId: string,
    @Body() data: QuoteDecisionDto,
  ) {
    return this.presalesService.recordQuoteDecision(
      companyId,
      user.id,
      versionId,
      data.status,
    );
  }
}
