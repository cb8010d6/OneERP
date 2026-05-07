import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Headers,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('认证 (Auth)')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOperation({ summary: '用户登录（返回 accessToken + refreshToken）' })
  async login(@Body() signInDto: LoginDto) {
    const user = await this.authService.validateUser(
      signInDto.email,
      signInDto.password,
    );
    if (!user) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    return this.authService.login(user);
  }

  @Post('register')
  @ApiOperation({ summary: '用户注册' })
  register(@Body() signUpDto: RegisterDto) {
    return this.authService.register(
      signUpDto.email,
      signUpDto.password,
      signUpDto.name,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  @ApiOperation({ summary: '刷新 access token（需要 refreshToken）' })
  async refresh(@Body() body: { refreshToken: string }) {
    if (!body.refreshToken) {
      throw new UnauthorizedException('缺少 refreshToken');
    }
    return this.authService.refresh(body.refreshToken);
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  @ApiOperation({ summary: '登出（撤销 refreshToken）' })
  async logout(
    @Headers('authorization') authorization: string,
    @Body() body: { refreshToken?: string },
  ) {
    if (!authorization) {
      throw new UnauthorizedException('未登录');
    }
    const token = authorization.replace('Bearer ', '');
    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const decoded = this.jwtService.decode(token) as Record<
        string,
        unknown
      > | null;
      const sub = decoded?.sub;
      if (typeof sub !== 'string' || !sub) {
        throw new UnauthorizedException('无效的 token');
      }
      await this.authService.logout(sub, body.refreshToken);
      return { message: '已登出' };
    } catch {
      throw new UnauthorizedException('登出失败');
    }
  }
}
