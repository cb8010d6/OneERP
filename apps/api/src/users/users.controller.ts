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
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { RequirePermissions } from '../core/decorators/permissions.decorator';
import { Permission } from '../core/permissions/permissions';
import {
  CreateInvitationDto,
  CreateUserDto,
  ResetPasswordDto,
  UpdateUserRoleDto,
} from './dto/user.dto';
import type { JwtUserPayload } from '../core/http/request.types';

@ApiTags('用户管理 (Users)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions(Permission.UserRead)
  @ApiOperation({ summary: '获取公司所有用户列表' })
  getCompanyUsers(@CurrentCompany() companyId: string) {
    return this.usersService.getCompanyUsers(companyId);
  }

  @Get('roles')
  @RequirePermissions(Permission.RoleRead)
  @ApiOperation({ summary: '获取角色列表' })
  getRoles() {
    return this.usersService.getRoles();
  }

  @Get('permissions/me')
  @RequirePermissions(Permission.UserRead)
  @ApiOperation({ summary: '获取当前用户权限' })
  getMyPermissions(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
  ) {
    return this.usersService.getMyPermissions(user.id, companyId);
  }

  @Post()
  @RequirePermissions(Permission.UserCreate)
  @ApiOperation({ summary: '创建新用户并加入当前公司' })
  createUser(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreateUserDto,
  ) {
    return this.usersService.createAndAssignUser(companyId, dto, user.id);
  }

  @Post('invitations')
  @RequirePermissions(Permission.UserInvite)
  @ApiOperation({ summary: '生成员工邀请链接' })
  createInvitation(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.usersService.createInvitation(companyId, user.id, dto);
  }

  @Get('invitations')
  @RequirePermissions(Permission.UserInvite)
  @ApiOperation({ summary: '查看员工邀请状态' })
  listInvitations(@CurrentCompany() companyId: string) {
    return this.usersService.listInvitations(companyId);
  }

  @Put(':id/role')
  @RequirePermissions(Permission.UserUpdate)
  @ApiOperation({ summary: '修改员工角色' })
  updateRole(
    @Param('id') userId: string,
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.usersService.updateUserRole(userId, companyId, user.id, dto);
  }

  @Put(':id/toggle-active')
  @RequirePermissions(Permission.UserUpdate)
  @ApiOperation({ summary: '启用/禁用用户' })
  toggleActive(
    @Param('id') userId: string,
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
  ) {
    return this.usersService.toggleUserActive(userId, companyId, user.id);
  }

  @Post(':id/reset-password')
  @RequirePermissions(Permission.UserResetPassword)
  @ApiOperation({ summary: '重置员工临时密码' })
  resetPassword(
    @Param('id') userId: string,
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.usersService.resetPassword(userId, companyId, user.id, dto);
  }
}
