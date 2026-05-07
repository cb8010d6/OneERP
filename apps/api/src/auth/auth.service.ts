import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import type {
  AuthUserProfile,
  AuthenticatedUser,
} from '../core/http/request.types';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

type AuthResult = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  user: AuthUserProfile;
  companies: Array<{
    id: string;
    name: string;
    role: string;
  }>;
};

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async validateUser(
    email: string,
    pass: string,
  ): Promise<AuthenticatedUser | null> {
    const user = await this.usersService.findByEmail(email);
    if (user && (await bcrypt.compare(pass, user.passwordHash))) {
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        companies: user.companies,
      };
    }
    return null;
  }

  async login(user: AuthenticatedUser): Promise<AuthResult> {
    const payload = { email: user.email, sub: user.id };
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    });
    const refreshToken = await this.createRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: 15 * 60, // 15 minutes in seconds
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      companies: user.companies.map((membership) => ({
        id: membership.company.id,
        name: membership.company.name,
        role: membership.role.name,
      })),
    };
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: {
        user: {
          include: {
            companies: {
              include: { company: true, role: true },
            },
          },
        },
      },
    });

    if (!stored) {
      throw new UnauthorizedException('无效的 refresh token');
    }

    if (stored.revoked) {
      // Token reuse detected — revoke all tokens for this user (security)
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId },
        data: { revoked: true },
      });
      throw new UnauthorizedException('Refresh token 已被撤销，请重新登录');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token 已过期，请重新登录');
    }

    // Revoke the old refresh token (rotation)
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });

    const user = stored.user;
    const payload = { email: user.email, sub: user.id };
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    });
    const newRefreshToken = await this.createRefreshToken(user.id);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      accessTokenExpiresIn: 15 * 60,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      companies: user.companies.map((membership) => ({
        id: membership.company.id,
        name: membership.company.name,
        role: membership.role.name,
      })),
    };
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      // Revoke specific token
      await this.prisma.refreshToken.updateMany({
        where: { token: refreshToken, userId },
        data: { revoked: true },
      });
    } else {
      // Revoke all tokens for user
      await this.prisma.refreshToken.updateMany({
        where: { userId },
        data: { revoked: true },
      });
    }
  }

  async register(
    email: string,
    pass: string,
    name: string,
  ): Promise<AuthResult> {
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email already exists');
    }

    const user = await this.usersService.createUser(email, pass, name);
    return this.login({
      id: user.id,
      email: user.email,
      name: user.name,
      companies: [],
    });
  }

  private async createRefreshToken(userId: string): Promise<string> {
    const token = randomBytes(40).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

    await this.prisma.refreshToken.create({
      data: {
        token,
        userId,
        expiresAt,
      },
    });

    return token;
  }
}
