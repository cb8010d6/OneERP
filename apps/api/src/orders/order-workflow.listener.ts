import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InventoryService } from '../inventory/inventory.service';

interface WorkflowActionPayload {
  recordId: string;
  companyId: string;
  operatorId: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class OrderWorkflowListener {
  private readonly logger = new Logger(OrderWorkflowListener.name);

  constructor(private readonly inventoryService: InventoryService) {}

  @OnEvent('workflow.action.sale_order.shipped')
  async onSaleOrderShipped(payload: WorkflowActionPayload) {
    try {
      await this.inventoryService.postSaleOrderShipment(
        payload.companyId,
        payload.recordId,
        {
          sourceLocationId: this.asString(payload.data?.sourceLocationId),
          batchNo: this.asString(payload.data?.batchNo),
          note:
            this.asString(payload.data?.shipmentNote) ??
            this.asString(payload.data?.note),
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

  private asString(value: unknown) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    return undefined;
  }
}
