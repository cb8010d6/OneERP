import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';

interface WorkflowActionPayload {
  recordId: string;
  companyId: string;
  operatorId: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class OrderWorkflowListener {
  private readonly logger = new Logger(OrderWorkflowListener.name);

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('workflow.action.sale_order.shipped')
  async onSaleOrderShipped(payload: WorkflowActionPayload) {
    try {
      const shipmentItems = await this.resolveShipmentItems(payload);
      await this.inventoryService.postSaleOrderShipment(
        payload.companyId,
        payload.recordId,
        {
          sourceLocationId: this.asString(payload.data?.sourceLocationId),
          batchNo: this.asString(payload.data?.batchNo),
          note:
            this.asString(payload.data?.shipmentNote) ??
            this.asString(payload.data?.note),
          items: shipmentItems,
        },
        payload.operatorId,
      );
    } catch (error) {
      this.logger.error(
        `自动出库触发失败: order=${payload.recordId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  private async resolveShipmentItems(payload: WorkflowActionPayload) {
    const requestedItems = this.parseShipmentItems(payload.data?.items);
    if (requestedItems.length) {
      return requestedItems;
    }

    const order = await this.prisma.order.findFirst({
      where: { id: payload.recordId, companyId: payload.companyId },
      select: {
        items: {
          select: {
            productId: true,
            quantity: true,
          },
        },
      },
    });

    if (!order) {
      throw new Error(`销售订单不存在或无权限访问：${payload.recordId}`);
    }

    return order.items.map((item) => ({
      productId: item.productId,
      shipQuantity: Number(item.quantity ?? 0),
    }));
  }

  private parseShipmentItems(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const record = item as Record<string, unknown>;
        const productId = this.asString(record.productId);
        const shipQuantity = Number(record.shipQuantity ?? 0);

        if (!productId || !Number.isFinite(shipQuantity) || shipQuantity <= 0) {
          return null;
        }

        return { productId, shipQuantity };
      })
      .filter((item): item is { productId: string; shipQuantity: number } =>
        Boolean(item),
      );
  }

  private asString(value: unknown) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    return undefined;
  }
}
