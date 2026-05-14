import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  MinLength,
  IsBoolean,
  IsInt,
  Max,
  Min,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ description: '邮箱（登录账号）' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: '密码（至少6位）' })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiProperty({ description: '姓名' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: '角色ID（不填则使用默认角色）' })
  @IsOptional()
  @IsString()
  roleId?: string;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ description: '姓名' })
  @IsOptional()
  @IsString()
  name?: string;
}

export class UpdateUserRoleDto {
  @ApiProperty({ description: '角色ID' })
  @IsString()
  @IsNotEmpty()
  roleId!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: '新临时密码（至少6位）' })
  @IsString()
  @MinLength(6)
  password!: string;
}

export class CreateInvitationDto {
  @ApiProperty({ description: '员工邮箱' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ description: '员工姓名' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: '角色ID' })
  @IsString()
  @IsNotEmpty()
  roleId!: string;

  @ApiPropertyOptional({ description: '有效期小时数，默认72小时' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  expiresInHours?: number;
}
