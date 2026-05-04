import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkOrderDto, CreateWorkReportDto } from './dto/production.dto';
import { PaginationDto } from '../core/dto/pagination.dto';

export interface WorkOrderRecord {
  id: string;
  workOrderNo: string;
  orderId: string;
  productId: string;
  plannedQty: number;
  status: string;
  companyId: string;
}

export interface WorkReportRecord {
  id: string;
  workOrderId: string;
  workerId: string;
  goodQty: number;
  defectQty: number;
}

@Injectable()
export class ProductionService {
  constructor(private readonly prisma: PrismaService) {}

  async createWorkOrder(
    companyId: string,
    dto: CreateWorkOrderDto,
  ): Promise<WorkOrderRecord> {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, companyId },
    });
    if (!order) throw new NotFoundException('找不到对应的销售订单');

    return this.prisma.workOrder.create({
      data: {
        workOrderNo: `WO-${Date.now()}`,
        orderId: dto.orderId,
        productId: dto.productId,
        plannedQty: dto.plannedQty,
        status: 'PENDING',
        companyId,
      },
    });
  }

  async getWorkOrders(companyId: string, pagination: PaginationDto) {
    const { page = 1, limit = 20 } = pagination;
    const where = { companyId };

    const [data, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        where,
        include: {
          order: {
            select: { orderNo: true, partner: { select: { name: true } } },
          },
          reports: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.workOrder.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async submitWorkReport(
    companyId: string,
    workOrderId: string,
    workerId: string,
    dto: CreateWorkReportDto,
  ): Promise<WorkReportRecord> {
    const wo = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, companyId },
    });
    if (!wo) throw new NotFoundException('无效的生产工单');

    return this.prisma.$transaction(async (tx) => {
      const report = await tx.workReport.create({
        data: {
          workOrderId,
          workerId,
          goodQty: dto.goodQty,
          defectQty: dto.defectQty,
        },
      });

      // Update actualQty and status in WorkOrder
      const newActual = wo.actualQty + dto.goodQty;
      let newStatus = wo.status;
      if (newStatus === 'PENDING') newStatus = 'IN_PROGRESS';
      if (newActual >= wo.plannedQty) newStatus = 'COMPLETED';

      await tx.workOrder.update({
        where: { id: workOrderId },
        data: { actualQty: newActual, status: newStatus },
      });

      return report;
    });
  }
}
