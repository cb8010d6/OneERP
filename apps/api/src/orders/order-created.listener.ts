import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';

interface OrderCreatedPayload {
  orderId: string;
  companyId: string;
  operatorId: string;
  partnerId: string;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
}

@Injectable()
export class OrderCreatedListener {
  private readonly logger = new Logger(OrderCreatedListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('order.created')
  async onOrderCreated(payload: OrderCreatedPayload) {
    try {
      const shortages: Array<{
        productId: string;
        materialId: string;
        requiredQty: number;
        availableQty: number;
      }> = [];

      for (const item of payload.items ?? []) {
        const product = await this.prisma.product.findFirst({
          where: { id: item.productId, companyId: payload.companyId },
          select: { id: true, materialId: true },
        });

        if (!product?.materialId) {
          continue;
        }

        const aggregate = await this.prisma.stockQuant.aggregate({
          where: {
            materialId: product.materialId,
            location: { companyId: payload.companyId },
          },
          _sum: { quantity: true },
        });

        const availableQty = Number(aggregate._sum.quantity ?? 0);
        const requiredQty = Number(item.quantity ?? 0);

        if (availableQty < requiredQty) {
          shortages.push({
            productId: item.productId,
            materialId: product.materialId,
            requiredQty,
            availableQty,
          });
        }
      }

      if (!shortages.length) {
        return;
      }

      await this.prisma.auditLog.create({
        data: {
          userId: payload.operatorId,
          action: 'SYSTEM_LOW_STOCK_ALERT',
          entity: 'order',
          entityId: payload.orderId,
          companyId: payload.companyId,
          details: {
            type: 'low_stock_after_order_created',
            message: '订单创建后检测到库存不足，建议自动触发采购流程评估。',
            shortages,
          },
        },
      });

      this.logger.warn(
        `低库存预警: order=${payload.orderId}, shortages=${shortages.length}`,
      );
    } catch (error) {
      this.logger.error(
        `订单创建事件处理失败: order=${payload.orderId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
