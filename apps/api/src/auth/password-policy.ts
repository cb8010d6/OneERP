import { BadRequestException } from '@nestjs/common';

export function assertStrongPassword(password: string) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new BadRequestException('密码长度不能少于8位');
  }

  if (
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password)
  ) {
    throw new BadRequestException('密码必须包含大小写字母和数字');
  }
}
