import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import {
  CreateInvitationDto,
  CreateUserDto,
  ResetPasswordDto,
  UpdateUserRoleDto,
} from './dto/user.dto';

type UserWithCompanyMemberships = Prisma.UserGetPayload<{
  include: {
    companies: {
      include: {
        company: true;
        role: true;
      };
    };
  };
}>;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findByEmail(email: string): Promise<UserWithCompanyMemberships | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        companies: {
          include: { company: true, role: true },
        },
      },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async getCompanyUsers(companyId: string) {
    const memberships = await this.prisma.userCompanyRole.findMany({
      where: { companyId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            isActive: true,
            createdAt: true,
          },
        },
        role: { select: { id: true, name: true } },
      },
      orderBy: { user: { createdAt: 'desc' } },
    });

    return memberships.map((membership) => ({
      id: membership.id,
      userId: membership.userId,
      companyId: membership.companyId,
      roleId: membership.roleId,
      role: membership.role,
      user: membership.user,
    }));
  }

  async createAndAssignUser(
    companyId: string,
    dto: CreateUserDto,
    operatorId: string,
  ) {
    const existing = await this.findByEmail(dto.email);
    if (existing) throw new ConflictException('该邮箱已被注册');

    const user = await this.createUser(dto.email, dto.password, dto.name);
    if (dto.isActive === false) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });
    }
    const role = await this.resolveRole(dto.roleId);
    await this.assertCanAssignRole(companyId, operatorId, role);

    await this.prisma.userCompanyRole.create({
      data: { userId: user.id, companyId, roleId: role.id },
    });

    await this.logUserAudit(companyId, operatorId, user.id, 'USER_CREATE', {
      email: user.email,
      roleId: role.id,
      isActive: dto.isActive !== false,
    });

    return { id: user.id, email: user.email, name: user.name };
  }

  async toggleUserActive(
    userId: string,
    companyId: string,
    operatorId: string,
  ) {
    if (userId === operatorId) {
      throw new ForbiddenException('不能禁用当前登录账号');
    }

    const ucr = await this.prisma.userCompanyRole.findUnique({
      where: { userId_companyId: { userId, companyId } },
      include: { user: true, role: true },
    });
    if (!ucr) throw new NotFoundException('用户不存在或不属于该公司');

    if (ucr.user.isActive && this.isAdminRole(ucr.role)) {
      await this.assertNotLastSuperAdmin(companyId, userId);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: !ucr.user.isActive },
      select: { id: true, isActive: true },
    });

    await this.logUserAudit(
      companyId,
      operatorId,
      userId,
      'USER_TOGGLE_ACTIVE',
      {
        isActive: updated.isActive,
      },
    );

    return updated;
  }

  async updateUserRole(
    userId: string,
    companyId: string,
    operatorId: string,
    dto: UpdateUserRoleDto,
  ) {
    if (userId === operatorId) {
      throw new ForbiddenException('不能修改当前登录账号的角色');
    }

    const membership = await this.prisma.userCompanyRole.findUnique({
      where: { userId_companyId: { userId, companyId } },
      include: { role: true },
    });
    if (!membership) throw new NotFoundException('用户不存在或不属于该公司');

    const nextRole = await this.resolveRole(dto.roleId);
    await this.assertCanAssignRole(companyId, operatorId, nextRole);
    if (this.isAdminRole(membership.role) && !this.isAdminRole(nextRole)) {
      await this.assertNotLastSuperAdmin(companyId, userId);
    }

    const updated = await this.prisma.userCompanyRole.update({
      where: { userId_companyId: { userId, companyId } },
      data: { roleId: nextRole.id },
      include: {
        role: { select: { id: true, name: true, permissions: true } },
        user: { select: { id: true, name: true, email: true, isActive: true } },
      },
    });

    await this.logUserAudit(companyId, operatorId, userId, 'USER_ROLE_UPDATE', {
      fromRoleId: membership.roleId,
      toRoleId: nextRole.id,
    });

    return updated;
  }

  async resetPassword(
    userId: string,
    companyId: string,
    operatorId: string,
    dto: ResetPasswordDto,
  ) {
    const membership = await this.prisma.userCompanyRole.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { userId: true },
    });
    if (!membership) throw new NotFoundException('用户不存在或不属于该公司');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    await this.logUserAudit(
      companyId,
      operatorId,
      userId,
      'USER_PASSWORD_RESET',
      {
        by: operatorId,
      },
    );

    return { id: userId, passwordReset: true };
  }

  async getRoles() {
    return this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, permissions: true },
    });
  }

  async getMyPermissions(userId: string, companyId: string) {
    const membership = await this.prisma.userCompanyRole.findUnique({
      where: { userId_companyId: { userId, companyId } },
      include: { role: true },
    });
    if (!membership) throw new NotFoundException('用户不存在或不属于该公司');
    return {
      role: {
        id: membership.role.id,
        name: membership.role.name,
      },
      permissions: membership.role.permissions,
    };
  }

  async createInvitation(
    companyId: string,
    operatorId: string,
    dto: CreateInvitationDto,
  ) {
    const role = await this.resolveRole(dto.roleId);
    await this.assertCanAssignRole(companyId, operatorId, role);
    const existingMembership = await this.prisma.userCompanyRole.findFirst({
      where: { companyId, user: { email: dto.email } },
      select: { id: true },
    });
    if (existingMembership) {
      throw new ConflictException('该邮箱已是当前企业员工');
    }
    const existingUser = await this.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('该邮箱已注册，请先使用新的员工邮箱');
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashInvitationToken(token);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + (dto.expiresInHours ?? 72));

    const invitation = await this.prisma.userInvitation.create({
      data: {
        email: dto.email,
        name: dto.name,
        roleId: role.id,
        companyId,
        createdById: operatorId,
        tokenHash,
        expiresAt,
      },
      include: {
        role: { select: { id: true, name: true } },
      },
    });

    await this.logUserAudit(
      companyId,
      operatorId,
      invitation.id,
      'USER_INVITE',
      {
        email: dto.email,
        roleId: role.id,
        expiresAt: invitation.expiresAt,
      },
    );

    return {
      id: invitation.id,
      email: invitation.email,
      name: invitation.name,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      token,
      invitePath: `/accept-invite?token=${encodeURIComponent(token)}`,
    };
  }

  async listInvitations(companyId: string) {
    return this.prisma.userInvitation.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        email: true,
        name: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
        role: { select: { id: true, name: true } },
        createdBy: { select: { id: true, email: true, name: true } },
        acceptedBy: { select: { id: true, email: true, name: true } },
      },
    });
  }

  async acceptInvitation(token: string, password: string, name?: string) {
    const invitation = await this.prisma.userInvitation.findUnique({
      where: { tokenHash: this.hashInvitationToken(token) },
      include: {
        company: true,
        role: true,
      },
    });

    if (!invitation) throw new BadRequestException('邀请链接无效');
    if (invitation.acceptedAt) throw new BadRequestException('邀请链接已使用');
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('邀请链接已过期');
    }
    const existingUser = await this.findByEmail(invitation.email);
    if (existingUser) {
      throw new ConflictException('该邮箱已注册，不能通过邀请链接重置已有账号');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const displayName =
      name?.trim() || invitation.name?.trim() || invitation.email.split('@')[0];

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: invitation.email,
          passwordHash,
          name: displayName,
          isActive: true,
        },
      });

      await tx.userCompanyRole.create({
        data: {
          userId: user.id,
          companyId: invitation.companyId,
          roleId: invitation.roleId,
        },
      });

      await tx.userInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date(), acceptedById: user.id },
      });

      return user;
    });

    await this.logUserAudit(
      invitation.companyId,
      invitation.createdById,
      result.id,
      'USER_INVITE_ACCEPT',
      { invitationId: invitation.id, email: invitation.email },
    );

    return this.findByEmail(result.email);
  }

  async createUser(
    email: string,
    passwordPlain: string,
    name: string,
  ): Promise<User> {
    const saltOrRounds = 10;
    const passwordHash = await bcrypt.hash(passwordPlain, saltOrRounds);

    return this.prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
      },
    });
  }

  private async resolveRole(roleId?: string) {
    const role = roleId
      ? await this.prisma.role.findUnique({ where: { id: roleId } })
      : ((await this.prisma.role.findFirst({ where: { name: 'Readonly' } })) ??
        (await this.prisma.role.findFirst()));

    if (!role) throw new NotFoundException('系统中没有可用角色，请先创建角色');
    return role;
  }

  private isAdminRole(role: { name: string; permissions: string[] }) {
    return role.name === 'SuperAdmin' || role.permissions.includes('ALL');
  }

  private async assertNotLastSuperAdmin(companyId: string, userId: string) {
    const activeSuperAdminCount = await this.prisma.userCompanyRole.count({
      where: {
        companyId,
        userId: { not: userId },
        user: { isActive: true },
        role: { permissions: { has: 'ALL' } },
      },
    });

    if (activeSuperAdminCount <= 0) {
      throw new ForbiddenException('不能移除或禁用最后一个 SuperAdmin');
    }
  }

  private async assertCanAssignRole(
    companyId: string,
    operatorId: string,
    role: { permissions: string[] },
  ) {
    if (!role.permissions.includes('ALL')) return;

    const operator = await this.prisma.userCompanyRole.findUnique({
      where: { userId_companyId: { userId: operatorId, companyId } },
      include: { role: true },
    });
    if (!operator?.role.permissions.includes('ALL')) {
      throw new ForbiddenException('只有 SuperAdmin 可以分配 SuperAdmin 角色');
    }
  }

  private hashInvitationToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async logUserAudit(
    companyId: string,
    operatorId: string,
    entityId: string,
    action: string,
    details: unknown,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId: operatorId,
        companyId,
        entity: 'user',
        entityId,
        action,
        details: JSON.parse(
          JSON.stringify(details ?? null),
        ) as Prisma.InputJsonValue,
      },
    });
  }
}
