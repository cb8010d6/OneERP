import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class AcceptInviteDto {
  @ApiProperty({ description: '邀请令牌' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ description: '新密码（至少6位）' })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiPropertyOptional({
    description: '员工姓名，不填则使用邀请中的姓名或邮箱前缀',
  })
  @IsOptional()
  @IsString()
  name?: string;
}
