import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepartmentDto } from './departments.controller';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  async create(companyId: string, data: CreateDepartmentDto) {
    return this.prisma.department.create({
      data: {
        name: data.name,
        companyId,
      },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.department.findMany({
      where: { companyId },
    });
  }

  async update(companyId: string, id: string, data: CreateDepartmentDto) {
    const dept = await this.prisma.department.findFirst({
      where: { id, companyId },
    });
    if (!dept) throw new NotFoundException('该部门不存在或无权访问');

    return this.prisma.department.update({
      where: { id },
      data: { name: data.name },
    });
  }

  async remove(companyId: string, id: string) {
    const dept = await this.prisma.department.findFirst({
      where: { id, companyId },
    });
    if (!dept) throw new NotFoundException('该部门不存在或无权访问');

    return this.prisma.department.delete({
      where: { id },
    });
  }
}
