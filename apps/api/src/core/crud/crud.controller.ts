import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { TenantGuard } from '../guards/tenant.guard';
import { CurrentCompany } from '../decorators/current-company.decorator';
import { CrudService } from './crud.service';
import { ResourceQueryDto } from './resource-query.dto';

@ApiTags('通用资源 (Generic CRUD)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('v1/resource')
export class CrudController {
  constructor(private readonly crudService: CrudService) {}

  @Get(':modelName')
  @ApiOperation({ summary: '获取资源列表（支持 filter/fields/orderBy）' })
  @ApiQuery({ name: 'filter', required: false, type: String })
  @ApiQuery({ name: 'fields', required: false, type: String })
  @ApiQuery({ name: 'include', required: false, type: String })
  @ApiQuery({ name: 'orderBy', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'searchFields', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  list(
    @Param('modelName') modelName: string,
    @CurrentCompany() companyId: string,
    @Query() query: ResourceQueryDto,
  ) {
    return this.crudService.list(modelName, query, companyId);
  }

  @Get(':modelName/:id')
  @ApiOperation({ summary: '获取资源详情' })
  @ApiQuery({ name: 'fields', required: false, type: String })
  @ApiQuery({ name: 'include', required: false, type: String })
  getOne(
    @Param('modelName') modelName: string,
    @Param('id') id: string,
    @CurrentCompany() companyId: string,
    @Query() query: ResourceQueryDto,
  ) {
    return this.crudService.findOne(modelName, id, query, companyId);
  }

  @Post(':modelName')
  @ApiOperation({ summary: '创建资源' })
  create(
    @Param('modelName') modelName: string,
    @CurrentCompany() companyId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crudService.create(modelName, body, companyId);
  }

  @Put(':modelName/:id')
  @ApiOperation({ summary: '更新资源' })
  update(
    @Param('modelName') modelName: string,
    @Param('id') id: string,
    @CurrentCompany() companyId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crudService.update(modelName, id, body, companyId);
  }

  @Delete(':modelName/:id')
  @ApiOperation({ summary: '删除资源' })
  remove(
    @Param('modelName') modelName: string,
    @Param('id') id: string,
    @CurrentCompany() companyId: string,
  ) {
    return this.crudService.remove(modelName, id, companyId);
  }
}
