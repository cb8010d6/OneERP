const fs = require('fs');
const path = 'F:/enterprise-erp/apps/api/src/core/workflow/workflow.service.ts';
const content = `import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';

interface WorkflowTargetConfig {
  delegate: string;
  statusField: string;
  companyField?: string;
}

const WORKFLOW_TARGETS: Record<string, WorkflowTargetConfig> = {
  order: { delegate: 'order', statusField: 'status', companyField: 'companyId' },
  workOrder: { delegate: 'workOrder', statusField: 'status', companyField: 'companyId' },
  invoice: { delegate: 'invoice', statusField: 'status', companyField: 'companyId' },
};

const EVENT_MODEL_ALIASES: Record<string, string> = {
  order: 'sale_order',
};

const ACTION_EVENT_ALIASES: Record<string, string> = {
  submit: 'confirmed',
  start_production: 'in_production',
  ship: 'shipped',
  complete: 'completed',
  cancel: 'cancelled',
};

@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async transition(
    modelName: string,
    recordId: string,
    action: string,
    companyId: string,
    operatorId: string,
    note?: string,
    extraData?: Record<string, unknown>,
  ) {
    const normalizedModel = this.normalizeModelName(modelName);
    const target = WORKFLOW_TARGETS[normalizedModel];

    if (!target) {
      throw new BadRequestException(\`模型 \${modelName} 暂不支持 workflow\`);
    }

    const workflow = await this.prisma.workflow.findFirst({
      where: {
        modelName: normalizedModel,
        isActive: true,
        OR: [{ companyId }, { companyId: null }],
      },
      include: {
        transitions: {
          include: { fromState: true, toState: true },
        },
      },
      orderBy: [{ companyId: 'desc' }],
    });

    if (!workflow) {
      throw new NotFoundException(\`未找到模型 \${modelName} 的 workflow 定义\`);
    }

    const whereCondition = target.companyField
      ? { id: recordId, [target.companyField]: companyId }
      : { id: recordId };

    const { updatedRecord, matchedTransition } = await this.prisma.$transaction(async (tx) => {
      const txAny = tx as unknown as Record<string, any>;
      const txDelegate = txAny[target.delegate];
      
      if (!txDelegate) {
        throw new BadRequestException(\`模型 \${modelName} delegate 不存在\`);
      }

      const record = await txDelegate.findFirst({ where: whereCondition });
      if (!record) {
        throw new NotFoundException('目标业务单据不存在或无权限访问');
      }

      const currentState = record[target.statusField];
      const matched = workflow.transitions.find(
        (item: any) => item.action === action && item.fromState.value === currentState,
      );

      if (!matched) {
        throw new BadRequestException(
          \`单据当前状态为 [\${currentState}]，不支持 [\${action}] 动作。操作已被拒绝。\`,
        );
      }

      const updateResultParams: any = { id: recordId };
      updateResultParams[target.statusField] = currentState;

      const updateResult = await txDelegate.updateMany({
        where: updateResultParams,
        data: { [target.statusField]: matched.toState.value },
      });

      if (updateResult.count === 0) {
        throw new ConflictException('状态流转失败：该单据已在其他地方被修改过了，请刷新重试！');
      }

      const updatedRecordLocal = await txDelegate.findUnique({ where: { id: recordId } });

      await tx.auditLog.create({
        data: {
          userId: operatorId,
          action: 'WORKFLOW_TRANSITION',
          entity: modelName,
          entityId: recordId,
          details: JSON.parse(
            JSON.stringify({
              workflowId: workflow.id,
              action,
              from: currentState,
              to: matched.toState.value,
              note,
              data: extraData ?? {},
            }),
          ),
          companyId: companyId || 'system',
        },
      });

      return { updatedRecord: updatedRecordLocal, matchedTransition: matched };
    });

    const eventModel = EVENT_MODEL_ALIASES[normalizedModel] ?? normalizedModel;
    const toEvent = this.toEventKey(matchedTransition.toState.value);
    const actionEvent = ACTION_EVENT_ALIASES[action] ?? toEvent;
    
    const payload = {
      modelName: normalizedModel,
      eventModel,
      recordId,
      workflowId: workflow.id,
      companyId,
      operatorId,
      action,
      from: matchedTransition.fromState.value,
      to: matchedTransition.toState.value,
      note,
      data: extraData ?? {},
      record: updatedRecord,
    };

    this.eventEmitter.emit(\`workflow.action.\${eventModel}.\${toEvent}\`, payload);
    if (actionEvent !== toEvent) {
      this.eventEmitter.emit(\`workflow.action.\${eventModel}.\${actionEvent}\`, payload);
    }

    return {
      modelName: normalizedModel,
      recordId,
      action,
      from: matchedTransition.fromState.value,
      to: matchedTransition.toState.value,
      data: updatedRecord,
    };
  }

  private normalizeModelName(modelName: string) {
    const normalized = modelName?.trim();
    if (!normalized) {
      throw new BadRequestException('modelName 不能为空');
    }
    if (normalized === 'workorder' || normalized === 'workOrder') return 'workOrder';
    return normalized;
  }

  private toEventKey(value: string) {
    return value.trim().toLowerCase().replace(/\\s+/g, '_');
  }
}
`;
fs.writeFileSync(path, content, 'utf8');
