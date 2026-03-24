import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ description: '邮箱（登录账号）' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: '密码（至少6位）' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ description: '姓名' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '角色ID（不填则使用默认角色）' })
  @IsOptional()
  @IsString()
  roleId?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ description: '姓名' })
  @IsOptional()
  @IsString()
  name?: string;
}
