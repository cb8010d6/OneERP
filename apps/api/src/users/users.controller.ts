import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CreateUserDto } from './dto/user.dto';

@ApiTags('用户管理 (Users)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: '获取公司所有用户列表' })
  getCompanyUsers(@CurrentCompany() companyId: string) {
    return this.usersService.getCompanyUsers(companyId);
  }

  @Post()
  @ApiOperation({ summary: '创建新用户并加入当前公司' })
  createUser(@CurrentCompany() companyId: string, @Body() dto: CreateUserDto) {
    return this.usersService.createAndAssignUser(companyId, dto);
  }

  @Put(':id/toggle-active')
  @ApiOperation({ summary: '启用/禁用用户' })
  toggleActive(
    @Param('id') userId: string,
    @CurrentCompany() companyId: string,
  ) {
    return this.usersService.toggleUserActive(userId, companyId);
  }
}
