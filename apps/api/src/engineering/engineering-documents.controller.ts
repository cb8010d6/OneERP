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
  AddEngineeringRevisionDto,
  CreateEngineeringDocumentDto,
  ReviewEngineeringRevisionDto,
} from './dto/engineering-documents.dto';
import { EngineeringDocumentsService } from './engineering-documents.service';

@ApiTags('工程文档 (Engineering Documents)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('engineering-documents')
export class EngineeringDocumentsController {
  constructor(private readonly service: EngineeringDocumentsService) {}

  @Get()
  @RequirePermissions(Permission.EngineeringDocumentRead)
  list(@CurrentCompany() companyId: string, @Query('search') search?: string) {
    return this.service.list(companyId, search);
  }

  @Get('released-for-order/:orderId')
  @RequirePermissions(Permission.EngineeringDocumentRead)
  listReleasedForOrder(
    @CurrentCompany() companyId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.service.listReleasedForOrder(companyId, orderId);
  }

  @Post()
  @RequirePermissions(Permission.EngineeringDocumentCreate)
  @ApiOperation({ summary: '创建工程文档和首个不可变草稿版本' })
  create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() data: CreateEngineeringDocumentDto,
  ) {
    return this.service.createDocument(companyId, user.id, data);
  }

  @Post(':documentId/revisions')
  @RequirePermissions(Permission.EngineeringDocumentCreate)
  addRevision(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('documentId') documentId: string,
    @Body() data: AddEngineeringRevisionDto,
  ) {
    return this.service.addRevision(companyId, user.id, documentId, data);
  }

  @Post('revisions/:revisionId/submit')
  @RequirePermissions(Permission.EngineeringDocumentCreate)
  submit(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('revisionId') revisionId: string,
  ) {
    return this.service.submitRevision(companyId, user.id, revisionId);
  }

  @Post('revisions/:revisionId/review')
  @RequirePermissions(Permission.EngineeringDocumentReview)
  review(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('revisionId') revisionId: string,
    @Body() data: ReviewEngineeringRevisionDto,
  ) {
    return this.service.reviewRevision(companyId, user.id, revisionId, data);
  }

  @Post('revisions/:revisionId/release')
  @RequirePermissions(Permission.EngineeringDocumentApprove)
  release(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('revisionId') revisionId: string,
  ) {
    return this.service.releaseRevision(companyId, user.id, revisionId);
  }
}
