import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        companies: {
          include: { company: true, role: true },
        },
      },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async getCompanyUsers(companyId: string) {
    return this.prisma.userCompanyRole.findMany({
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
    });
  }

  async createAndAssignUser(companyId: string, dto: CreateUserDto) {
    const existing = await this.findByEmail(dto.email);
    if (existing) throw new ConflictException('该邮箱已被注册');

    const user = await this.createUser(dto.email, dto.password, dto.name);

    const role = dto.roleId
      ? await this.prisma.role.findUnique({ where: { id: dto.roleId } })
      : await this.prisma.role.findFirst();

    if (!role) throw new NotFoundException('系统中没有可用角色，请先创建角色');

    await this.prisma.userCompanyRole.create({
      data: { userId: user.id, companyId, roleId: role.id },
    });

    return { id: user.id, email: user.email, name: user.name };
  }

  async toggleUserActive(userId: string, companyId: string) {
    const ucr = await this.prisma.userCompanyRole.findUnique({
      where: { userId_companyId: { userId, companyId } },
      include: { user: true },
    });
    if (!ucr) throw new NotFoundException('用户不存在或不属于该公司');

    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive: !ucr.user.isActive },
      select: { id: true, isActive: true },
    });
  }

  async createUser(email: string, passwordPlain: string, name: string) {
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
}
