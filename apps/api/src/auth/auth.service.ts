import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import type {
  AuthUserProfile,
  AuthenticatedUser,
} from '../core/http/request.types';

type AuthResult = {
  accessToken: string;
  refreshToken: string;
  user: AuthUserProfile;
  companies: Array<{
    id: string;
    name: string;
    role: string;
    permissions: string[];
  }>;
};

@Injectable()
export class AuthService {
  private static readonly ACCESS_TOKEN_EXPIRES_IN = '15m';
  private static readonly REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  private static readonly LOGIN_LOCK_MS = 15 * 60 * 1000;
  private static readonly MAX_LOGIN_FAILURES = 5;

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async validateUser(
    email: string,
    pass: string,
  ): Promise<AuthenticatedUser | null> {
    const normalizedEmail = this.normalizeEmail(email);
    await this.assertLoginNotLocked(normalizedEmail);

    const user = await this.usersService.findByEmail(normalizedEmail);
    if (
      user &&
      user.isActive &&
      (await bcrypt.compare(pass, user.passwordHash))
    ) {
      await this.clearLoginFailures(normalizedEmail);
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        companies: user.companies,
      };
    }
    await this.recordLoginFailure(normalizedEmail);
    return null;
  }

  async login(user: AuthenticatedUser): Promise<AuthResult> {
    const refreshToken = await this.issueRefreshToken(user.id);
    return this.buildAuthResult(user, refreshToken);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const userId = this.parseRefreshTokenUserId(refreshToken);
    if (!userId) {
      throw new UnauthorizedException('刷新令牌无效');
    }

    const tokenHash = this.hashToken(refreshToken);
    const cacheKey = this.refreshCacheKey(userId, tokenHash);
    const cached = await this.cacheManager.get<{
      userId: string;
      issuedAt: string;
      gen?: number;
    }>(cacheKey);
    if (!cached) {
      throw new UnauthorizedException('刷新令牌无效或已过期');
    }

    const genKey = `auth:session-gen:${userId}`;
    const currentGen = await this.cacheManager.get<number>(genKey);
    if (currentGen && cached.gen !== undefined && cached.gen < currentGen) {
      await this.cacheManager.del(cacheKey);
      throw new UnauthorizedException('会话已被撤销，请重新登录');
    }

    const user = await this.usersService.findByIdWithCompanies(userId);
    if (!user?.isActive) {
      await this.cacheManager.del(cacheKey);
      throw new UnauthorizedException('账号已停用，请联系管理员');
    }

    await this.cacheManager.del(cacheKey);
    const nextRefreshToken = await this.issueRefreshToken(user.id);
    return this.buildAuthResult(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        companies: user.companies,
      },
      nextRefreshToken,
    );
  }

  async logout(refreshToken?: string) {
    const userId = refreshToken
      ? this.parseRefreshTokenUserId(refreshToken)
      : null;
    if (refreshToken && userId) {
      await this.cacheManager.del(
        this.refreshCacheKey(userId, this.hashToken(refreshToken)),
      );
    }
    return { success: true };
  }

  async logoutAll(userId: string) {
    const genKey = `auth:session-gen:${userId}`;
    await this.cacheManager.set(genKey, Date.now(), 7 * 24 * 60 * 60 * 1000);
    return { success: true };
  }

  private buildAuthResult(
    user: AuthenticatedUser,
    refreshToken: string,
  ): AuthResult {
    const payload = { email: user.email, sub: user.id };
    return {
      accessToken: this.jwtService.sign(payload, {
        expiresIn: AuthService.ACCESS_TOKEN_EXPIRES_IN,
      }),
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      companies: user.companies.map((membership) => ({
        id: membership.company.id,
        name: membership.company.name,
        role: membership.role.name,
        permissions: membership.role.permissions ?? [],
      })),
    };
  }

  async register(
    email: string,
    pass: string,
    name: string,
  ): Promise<AuthResult> {
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new UnauthorizedException('Email already exists');
    }

    const user = await this.usersService.createUser(email, pass, name);
    return this.login({
      id: user.id,
      email: user.email,
      name: user.name,
      companies: [],
    });
  }

  async acceptInvite(token: string, password: string, name?: string) {
    const user = await this.usersService.acceptInvitation(
      token,
      password,
      name,
    );
    if (!user) {
      throw new UnauthorizedException('邀请接受失败');
    }

    return this.login({
      id: user.id,
      email: user.email,
      name: user.name,
      companies: user.companies,
    });
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private loginFailedKey(email: string) {
    return `auth:login-failed:${email}`;
  }

  private loginLockedKey(email: string) {
    return `auth:login-locked:${email}`;
  }

  private async assertLoginNotLocked(email: string) {
    const lockedUntil = await this.cacheManager.get<number>(
      this.loginLockedKey(email),
    );
    if (lockedUntil && lockedUntil > Date.now()) {
      throw new HttpException(
        '登录失败次数过多，请15分钟后再试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordLoginFailure(email: string) {
    const key = this.loginFailedKey(email);
    const current = Number((await this.cacheManager.get<number>(key)) ?? 0) + 1;
    if (current >= AuthService.MAX_LOGIN_FAILURES) {
      await this.cacheManager.set(
        this.loginLockedKey(email),
        Date.now() + AuthService.LOGIN_LOCK_MS,
        AuthService.LOGIN_LOCK_MS,
      );
      await this.cacheManager.del(key);
      return;
    }
    await this.cacheManager.set(key, current, AuthService.LOGIN_LOCK_MS);
  }

  private async clearLoginFailures(email: string) {
    await this.cacheManager.del(this.loginFailedKey(email));
    await this.cacheManager.del(this.loginLockedKey(email));
  }

  private async issueRefreshToken(userId: string) {
    const token = `${userId}.${randomBytes(48).toString('base64url')}`;
    const genKey = `auth:session-gen:${userId}`;
    const gen = (await this.cacheManager.get<number>(genKey)) ?? 0;
    await this.cacheManager.set(
      this.refreshCacheKey(userId, this.hashToken(token)),
      { userId, issuedAt: new Date().toISOString(), gen },
      AuthService.REFRESH_TOKEN_TTL_MS,
    );
    return token;
  }

  private parseRefreshTokenUserId(refreshToken: string) {
    const [userId, secret] = refreshToken.split('.');
    if (!userId || !secret) return null;
    return userId;
  }

  private refreshCacheKey(userId: string, tokenHash: string) {
    return `auth:refresh:${userId}:${tokenHash}`;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
