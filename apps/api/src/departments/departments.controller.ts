import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DepartmentsService } from './departments.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { RequirePermissions } from '../core/decorators/permissions.decorator';
import { Permission } from '../core/permissions/permissions';
import { IsString } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  name!: string;
}

@ApiTags('组织架构 (Departments)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Post()
  @RequirePermissions(Permission.DepartmentCreate)
  @ApiOperation({ summary: '创建部门' })
  create(
    @CurrentCompany() companyId: string,
    @Body() data: CreateDepartmentDto,
  ) {
    return this.departmentsService.create(companyId, data);
  }

  @Get()
  @RequirePermissions(Permission.DepartmentRead)
  @ApiOperation({ summary: '获取公司所有部门' })
  findAll(@CurrentCompany() companyId: string) {
    return this.departmentsService.findAll(companyId);
  }

  @Put(':id')
  @RequirePermissions(Permission.DepartmentUpdate)
  @ApiOperation({ summary: '更新部门名称' })
  update(
    @CurrentCompany() companyId: string,
    @Param('id') id: string,
    @Body() data: CreateDepartmentDto,
  ) {
    return this.departmentsService.update(companyId, id, data);
  }

  @Delete(':id')
  @RequirePermissions(Permission.DepartmentDelete)
  @ApiOperation({ summary: '删除部门' })
  remove(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.departmentsService.remove(companyId, id);
  }
}
