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
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { IsString } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  name!: string;
}

@ApiTags('组织架构 (Departments)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Post()
  @ApiOperation({ summary: '创建部门' })
  create(
    @CurrentCompany() companyId: string,
    @Body() data: CreateDepartmentDto,
  ) {
    return this.departmentsService.create(companyId, data);
  }

  @Get()
  @ApiOperation({ summary: '获取公司所有部门' })
  findAll(@CurrentCompany() companyId: string) {
    return this.departmentsService.findAll(companyId);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新部门名称' })
  update(
    @CurrentCompany() companyId: string,
    @Param('id') id: string,
    @Body() data: CreateDepartmentDto,
  ) {
    return this.departmentsService.update(companyId, id, data);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除部门' })
  remove(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.departmentsService.remove(companyId, id);
  }
}
