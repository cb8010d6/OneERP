import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CustomFieldType } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../decorators/current-company.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { TenantGuard } from '../guards/tenant.guard';
import { MetadataService } from './metadata.service';
import type { UiSchema } from './schema.types';

@ApiTags('系统字典 (Metadata)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('v1/metadata')
export class MetadataController {
  constructor(private readonly metadataService: MetadataService) {}

  @Get()
  @ApiOperation({ summary: '获取全部模型元数据' })
  listSchemas(@CurrentCompany() companyId: string) {
    return this.metadataService.listSchemas(companyId);
  }

  @Get(':modelName/custom-fields')
  @ApiOperation({ summary: '获取模型自定义字段定义' })
  listCustomFields(
    @Param('modelName') modelName: string,
    @CurrentCompany() companyId: string,
  ) {
    return this.metadataService.listCustomFields(modelName, companyId);
  }

  @Post(':modelName/custom-fields')
  @ApiOperation({ summary: '新增或更新模型自定义字段定义' })
  upsertCustomField(
    @Param('modelName') modelName: string,
    @CurrentCompany() companyId: string,
    @Body()
    body: {
      fieldName: string;
      label: string;
      type: CustomFieldType;
      required?: boolean;
      referenceModel?: string;
      referenceLabelField?: string;
      referenceValueField?: string;
      referenceRelationField?: string;
    },
  ) {
    return this.metadataService.upsertCustomField(modelName, companyId, body);
  }

  @Delete(':modelName/custom-fields/:fieldName')
  @ApiOperation({ summary: '删除模型自定义字段定义' })
  removeCustomField(
    @Param('modelName') modelName: string,
    @Param('fieldName') fieldName: string,
    @CurrentCompany() companyId: string,
  ) {
    return this.metadataService.removeCustomField(
      modelName,
      companyId,
      fieldName,
    );
  }

  @Get(':modelName')
  @ApiOperation({ summary: '获取指定模型元数据' })
  getSchema(
    @Param('modelName') modelName: string,
    @CurrentCompany() companyId: string,
  ) {
    return this.metadataService.getSchema(modelName, companyId);
  }

  @Put(':modelName')
  @ApiOperation({ summary: '更新或注册模型元数据' })
  upsertSchema(
    @Param('modelName') modelName: string,
    @Body() schema: UiSchema,
  ) {
    return this.metadataService.upsertSchema(modelName, schema);
  }
}
