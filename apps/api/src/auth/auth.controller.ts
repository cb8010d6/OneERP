import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  UseGuards,
  ForbiddenException,
  Res,
  Req,
  Get,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { CsrfGuard } from '../core/guards/csrf.guard';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import type { JwtUserPayload } from '../core/http/request.types';
import { randomBytes } from 'crypto';

const REFRESH_COOKIE = 'rt';
const CSRF_COOKIE = 'csrf';
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};
const CSRF_COOKIE_OPTIONS = {
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

@ApiTags('认证 (Auth)')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOperation({ summary: '用户登录' })
  async login(
    @Body() signInDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.validateUser(
      signInDto.email,
      signInDto.password,
    );
    if (!user) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    const result = await this.authService.login(user);
    this.setRefreshCookie(res, result.refreshToken);
    this.setCsrfCookie(res);
    return {
      accessToken: result.accessToken,
      user: result.user,
      companies: result.companies,
    };
  }

  @Post('register')
  @ApiOperation({ summary: '用户注册（仅开发环境）' })
  async register(
    @Body() signUpDto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('生产环境不允许公开注册，请使用邀请链接');
    }
    const result = await this.authService.register(
      signUpDto.email,
      signUpDto.password,
      signUpDto.name,
    );
    this.setRefreshCookie(res, result.refreshToken);
    this.setCsrfCookie(res);
    return {
      accessToken: result.accessToken,
      user: result.user,
      companies: result.companies,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('accept-invite')
  @ApiOperation({ summary: '接受员工邀请并设置密码' })
  async acceptInvite(
    @Body() dto: AcceptInviteDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.acceptInvite(
      dto.token,
      dto.password,
      dto.name,
    );
    this.setRefreshCookie(res, result.refreshToken);
    this.setCsrfCookie(res);
    return {
      accessToken: result.accessToken,
      user: result.user,
      companies: result.companies,
    };
  }

  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Post('refresh')
  @ApiOperation({ summary: '使用 HttpOnly cookie 续签访问令牌' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = (req.cookies?.[REFRESH_COOKIE] as string) ?? '';
    if (!refreshToken) {
      throw new UnauthorizedException('刷新令牌缺失');
    }
    const result = await this.authService.refresh(refreshToken);
    this.setRefreshCookie(res, result.refreshToken);
    return {
      accessToken: result.accessToken,
      user: result.user,
      companies: result.companies,
    };
  }

  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Post('logout')
  @ApiOperation({ summary: '退出登录并撤销当前刷新令牌（无需 access token）' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = (req.cookies?.[REFRESH_COOKIE] as string) ?? '';
    await this.authService.logout(refreshToken);
    this.clearRefreshCookie(res);
    this.clearCsrfCookie(res);
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @Post('logout-all')
  @ApiOperation({ summary: '撤销当前用户所有刷新令牌' })
  async logoutAll(
    @CurrentUser() user: JwtUserPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logoutAll(user.id);
    this.clearRefreshCookie(res);
    this.clearCsrfCookie(res);
    return { success: true };
  }

  @Get('csrf')
  @ApiExcludeEndpoint()
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const existing = req.cookies?.[CSRF_COOKIE] as string | undefined;
    if (existing) {
      return { csrfToken: existing };
    }
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!refreshToken) {
      return { csrfToken: '' };
    }
    return { csrfToken: this.setCsrfCookie(res) };
  }

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE, token, REFRESH_COOKIE_OPTIONS);
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_OPTIONS.path });
  }

  private setCsrfCookie(res: Response) {
    const token = randomBytes(32).toString('base64url');
    res.cookie(CSRF_COOKIE, token, CSRF_COOKIE_OPTIONS);
    return token;
  }

  private clearCsrfCookie(res: Response) {
    res.clearCookie(CSRF_COOKIE, { path: CSRF_COOKIE_OPTIONS.path });
  }
}
