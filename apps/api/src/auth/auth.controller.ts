import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";

@ApiTags("认证 (Auth)")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @HttpCode(HttpStatus.OK)
  @Post("login")
  @ApiOperation({ summary: "用户登录" })
  @Throttle({
    default: {
      ttl: 60_000, // 60 秒窗口
      limit: 5, // 每窗口最多 5 次尝试（防暴力破解核心配置）
    },
  })
  async login(@Body() signInDto: LoginDto) {
    const user = await this.authService.validateUser(
      signInDto.email,
      signInDto.password,
    );
    if (!user) {
      throw new UnauthorizedException("邮箱或密码错误");
    }
    return this.authService.login(user);
  }

  @Post("register")
  @ApiOperation({ summary: "用户注册" })
  @Throttle({
    default: {
      ttl: 60_000, // 60 秒窗口
      limit: 3, // 每窗口最多 3 次注册（防止批量注册攻击）
    },
  })
  async register(@Body() signUpDto: RegisterDto) {
    return this.authService.register(
      signUpDto.email,
      signUpDto.password,
      signUpDto.name,
    );
  }
}