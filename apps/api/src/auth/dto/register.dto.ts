import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ description: '邮箱' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: '密码' })
  @IsString()
  @MinLength(8, { message: '密码长度不能少于8位' })
  password!: string;

  @ApiProperty({ description: '姓名' })
  @IsString()
  @IsNotEmpty()
  name!: string;
}
