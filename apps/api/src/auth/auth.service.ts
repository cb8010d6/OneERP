import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type {
  AuthUserProfile,
  AuthenticatedUser,
} from '../core/http/request.types';

type AuthResult = {
  accessToken: string;
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
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async validateUser(
    email: string,
    pass: string,
  ): Promise<AuthenticatedUser | null> {
    const user = await this.usersService.findByEmail(email);
    if (
      user &&
      user.isActive &&
      (await bcrypt.compare(pass, user.passwordHash))
    ) {
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        companies: user.companies,
      };
    }
    return null;
  }

  login(user: AuthenticatedUser): AuthResult {
    const payload = { email: user.email, sub: user.id };
    return {
      accessToken: this.jwtService.sign(payload),
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
    const user = await this.usersService.acceptInvitation(token, password, name);
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
}
