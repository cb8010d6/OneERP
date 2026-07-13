import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { EventQueueService } from '../events/event-queue.service';

interface WorkflowTargetConfig {
  delegate: string;
  statusField: string;
  companyField?: string;
}

interface DefaultWorkflowState {
  value: string;
  label: string;
  sort: number;
  isInitial?: boolean;
  isFinal?: boolean;
}

interface DefaultWorkflowTransition {
  from: string;
  to: string;
  action: string;
  label: string;
}

interface DefaultWorkflowDefinition {
  name: string;
  statusField: string;
  states: DefaultWorkflowState[];
  transitions: DefaultWorkflowTransition[];
}

interface WorkflowStateRecord {
  id: string;
  value: string;
  label: string;
  sort: number;
  isInitial?: boolean;
  isFinal?: boolean;
}

interface WorkflowTransitionRecord {
  action: string;
  fromState: WorkflowStateRecord;
  toState: WorkflowStateRecord;
  label: string;
}

interface WorkflowDefinitionRecord {
  id: string;
  transitions: WorkflowTransitionRecord[];
}

export interface WorkflowTargetRecord {
  id: string;
  [key: string]: unknown;
}

type WorkflowDelegateName = 'order' | 'workOrder' | 'invoice';

interface WorkflowDelegate {
  findFirst(args: {
    where: Record<string, string>;
  }): Promise<WorkflowTargetRecord | null>;
  updateMany(args: {
    where: Record<string, string>;
    data: Record<string, string>;
  }): Promise<{ count: number }>;
  findUnique(args: {
    where: { id: string };
  }): Promise<WorkflowTargetRecord | null>;
}

interface WorkflowBootstrapTransaction {
  workflow: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
  workflowState: {
    upsert(args: unknown): Promise<WorkflowStateRecord>;
    findMany(args: unknown): Promise<WorkflowStateRecord[]>;
  };
  workflowTransition: {
    upsert(args: unknown): Promise<unknown>;
  };
}

interface WorkflowTransitionTransaction {
  order: WorkflowDelegate;
  workOrder: WorkflowDelegate;
  invoice: WorkflowDelegate;
  auditLog: {
    create(args: {
      data: {
        userId: string;
        action: string;
        entity: string;
        entityId: string;
        details: Prisma.InputJsonValue;
        companyId: string;
      };
    }): Promise<unknown>;
  };
}

interface WorkflowTransitionTxResult {
  updatedRecord: WorkflowTargetRecord | null;
  matchedTransition: WorkflowTransitionRecord;
}

export interface WorkflowTransitionResult {
  modelName: string;
  recordId: string;
  action: string;
  from: string;
  to: string;
  data: WorkflowTargetRecord | null;
}

const WORKFLOW_TARGETS: Record<string, WorkflowTargetConfig> = {
  order: {
    delegate: 'order',
    statusField: 'status',
    companyField: 'companyId',
  },
  workOrder: {
    delegate: 'workOrder',
    statusField: 'status',
    companyField: 'companyId',
  },
  invoice: {
    delegate: 'invoice',
    statusField: 'status',
    companyField: 'companyId',
  },
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

const DEFAULT_WORKFLOW_DEFINITIONS: Record<string, DefaultWorkflowDefinition> =
  {
    order: {
      name: '销售订单流程',
      statusField: 'status',
      states: [
        { value: 'DRAFT', label: '草稿', sort: 10, isInitial: true },
        { value: 'PENDING_APPROVAL', label: '待审批', sort: 20 },
        { value: 'PENDING', label: '待处理', sort: 30 },
        { value: 'IN_PRODUCTION', label: '生产中', sort: 40 },
        { value: 'PARTIAL_SHIPPED', label: '部分发货', sort: 50 },
        { value: 'SHIPPED', label: '已发货', sort: 60 },
        { value: 'COMPLETED', label: '已完成', sort: 70, isFinal: true },
        { value: 'CANCELLED', label: '已取消', sort: 99, isFinal: true },
      ],
      transitions: [
        { from: 'DRAFT', to: 'PENDING', action: 'submit', label: '提交订单' },
        {
          from: 'DRAFT',
          to: 'PENDING_APPROVAL',
          action: 'submit_for_approval',
          label: '提交审批',
        },
        {
          from: 'PENDING_APPROVAL',
          to: 'PENDING',
          action: 'approve',
          label: '审批通过',
        },
        {
          from: 'PENDING',
          to: 'IN_PRODUCTION',
          action: 'start_production',
          label: '开始生产',
        },
        {
          from: 'IN_PRODUCTION',
          to: 'PARTIAL_SHIPPED',
          action: 'ship',
          label: '发货',
        },
        {
          from: 'PARTIAL_SHIPPED',
          to: 'SHIPPED',
          action: 'ship',
          label: '完成发货',
        },
        { from: 'SHIPPED', to: 'COMPLETED', action: 'complete', label: '完成' },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', label: '取消' },
        { from: 'PENDING', to: 'CANCELLED', action: 'cancel', label: '取消' },
        {
          from: 'IN_PRODUCTION',
          to: 'CANCELLED',
          action: 'cancel',
          label: '取消',
        },
        {
          from: 'PARTIAL_SHIPPED',
          to: 'CANCELLED',
          action: 'cancel',
          label: '取消',
        },
        {
          from: 'PENDING_APPROVAL',
          to: 'CANCELLED',
          action: 'cancel',
          label: '取消',
        },
        { from: 'SHIPPED', to: 'CANCELLED', action: 'cancel', label: '取消' },
      ],
    },
  };

@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventQueueService: EventQueueService,
  ) {}

  async transition(
    modelName: string,
    recordId: string,
    action: string,
    companyId: string,
    operatorId: string,
    note?: string,
    extraData?: Record<string, unknown>,
  ): Promise<WorkflowTransitionResult> {
    const normalizedModel = this.normalizeModelName(modelName);
    const target = WORKFLOW_TARGETS[normalizedModel];

    if (!target) {
      throw new BadRequestException(`模型 ${modelName} 暂不支持 workflow`);
    }

    const workflow = await this.findOrBootstrapWorkflow(
      normalizedModel,
      companyId,
    );

    if (!workflow) {
      throw new NotFoundException(`未找到模型 ${modelName} 的 workflow 定义`);
    }

    const whereCondition: Record<string, string> = { id: recordId };
    if (target.companyField) {
      whereCondition[target.companyField] = companyId;
    }

    const { updatedRecord, matchedTransition }: WorkflowTransitionTxResult =
      await this.prisma.$transaction(
        async (
          tx: WorkflowTransitionTransaction,
        ): Promise<WorkflowTransitionTxResult> => {
          const txDelegate = tx[target.delegate as WorkflowDelegateName];

          if (!txDelegate) {
            throw new BadRequestException(`模型 ${modelName} delegate 不存在`);
          }

          const record = await txDelegate.findFirst({ where: whereCondition });
          if (!record) {
            throw new NotFoundException('目标业务单据不存在或无权限访问');
          }

          const rawCurrentState = record[target.statusField];
          const currentState =
            typeof rawCurrentState === 'string'
              ? rawCurrentState
              : rawCurrentState == null
                ? ''
                : typeof rawCurrentState === 'number' ||
                    typeof rawCurrentState === 'boolean' ||
                    typeof rawCurrentState === 'bigint'
                  ? String(rawCurrentState)
                  : '';
          this.assertDomainTransitionAllowed(
            normalizedModel,
            action,
            currentState,
          );
          const matched = workflow.transitions.find(
            (item) =>
              item.action === action && item.fromState.value === currentState,
          );

          if (!matched) {
            throw new BadRequestException(
              `单据当前状态为 [${currentState}]，不支持 [${action}] 动作。操作已被拒绝。`,
            );
          }

          const updateResultParams: Record<string, string> = { id: recordId };
          updateResultParams[target.statusField] = currentState;

          const updateResult = await txDelegate.updateMany({
            where: updateResultParams,
            data: { [target.statusField]: matched.toState.value },
          });

          if (updateResult.count === 0) {
            throw new ConflictException(
              '状态流转失败：该单据已在其他地方被修改过了，请刷新重试！',
            );
          }

          const updatedRecordLocal = await txDelegate.findUnique({
            where: { id: recordId },
          });

          await tx.auditLog.create({
            data: {
              userId: operatorId,
              action: 'WORKFLOW_TRANSITION',
              entity: modelName,
              entityId: recordId,
              details: {
                workflowId: workflow.id,
                action,
                from: currentState,
                to: matched.toState.value,
                note,
                data: extraData ?? {},
              } as unknown as Prisma.InputJsonValue,
              companyId: companyId || 'system',
            },
          });

          return {
            updatedRecord: updatedRecordLocal,
            matchedTransition: matched,
          };
        },
      );

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

    await this.publishWorkflowActionEvent(
      eventModel,
      recordId,
      toEvent,
      payload,
    );
    if (actionEvent !== toEvent) {
      await this.publishWorkflowActionEvent(
        eventModel,
        recordId,
        actionEvent,
        payload,
      );
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
    if (normalized === 'workorder' || normalized === 'workOrder')
      return 'workOrder';
    return normalized;
  }

  private assertDomainTransitionAllowed(
    modelName: string,
    action: string,
    currentState: string,
  ) {
    const normalizedAction = action.trim().toLowerCase();
    if (modelName === 'order' && normalizedAction === 'ship') {
      throw new BadRequestException(
        '销售发货必须通过销售发货工作台执行，以确保库存原子过账和审计完整。',
      );
    }

    if (
      modelName === 'order' &&
      normalizedAction === 'cancel' &&
      ['PARTIAL_SHIPPED', 'SHIPPED'].includes(currentState)
    ) {
      throw new BadRequestException(
        '订单已有发货记录，取消前必须先通过库存冲销或销售退货恢复库存。',
      );
    }

    if (modelName === 'workOrder') {
      throw new BadRequestException(
        '生产工单状态必须通过生产报工工作台更新，以确保库存和工单进度原子一致。',
      );
    }

    if (modelName === 'invoice') {
      throw new BadRequestException(
        '发票状态必须通过财务工作台更新，以确保会计分录和应收状态一致。',
      );
    }
  }

  private toEventKey(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, '_');
  }

  private publishWorkflowActionEvent(
    eventModel: string,
    recordId: string,
    eventKey: string,
    payload: Record<string, unknown>,
  ) {
    const eventName = `workflow.action.${eventModel}.${eventKey}`;
    return this.eventQueueService.publish({
      eventName,
      idempotencyKey: `${eventName}:${recordId}`,
      companyId:
        typeof payload.companyId === 'string' ? payload.companyId : undefined,
      payload,
    });
  }

  private async findOrBootstrapWorkflow(
    modelName: string,
    companyId: string,
  ): Promise<WorkflowDefinitionRecord | null> {
    const found = await this.findActiveWorkflow(modelName, companyId);
    if (found) {
      return found;
    }

    const definition = DEFAULT_WORKFLOW_DEFINITIONS[modelName];
    if (!definition) {
      throw new NotFoundException(`未找到模型 ${modelName} 的 workflow 定义`);
    }

    try {
      await this.prisma.$transaction(
        async (tx: WorkflowBootstrapTransaction) => {
          const createdWorkflow = await tx.workflow.upsert({
            where: {
              companyId_modelName: {
                companyId,
                modelName,
              },
            },
            update: {
              name: definition.name,
              statusField: definition.statusField,
              isActive: true,
            },
            create: {
              companyId,
              modelName,
              name: definition.name,
              statusField: definition.statusField,
              isActive: true,
            },
          });

          for (const state of definition.states) {
            await tx.workflowState.upsert({
              where: {
                workflowId_value: {
                  workflowId: createdWorkflow.id,
                  value: state.value,
                },
              },
              update: {
                label: state.label,
                sort: state.sort,
                isInitial: state.isInitial ?? false,
                isFinal: state.isFinal ?? false,
              },
              create: {
                workflowId: createdWorkflow.id,
                value: state.value,
                label: state.label,
                sort: state.sort,
                isInitial: state.isInitial ?? false,
                isFinal: state.isFinal ?? false,
              },
            });
          }

          const states = await tx.workflowState.findMany({
            where: { workflowId: createdWorkflow.id },
          });
          const stateIdMap = new Map(
            states.map((item) => [item.value, item.id]),
          );

          for (const item of definition.transitions) {
            const fromStateId = stateIdMap.get(item.from);
            const toStateId = stateIdMap.get(item.to);
            if (!fromStateId || !toStateId) {
              continue;
            }

            await tx.workflowTransition.upsert({
              where: {
                workflowId_fromStateId_action: {
                  workflowId: createdWorkflow.id,
                  fromStateId,
                  action: item.action,
                },
              },
              update: {
                toStateId,
                label: item.label,
              },
              create: {
                workflowId: createdWorkflow.id,
                fromStateId,
                toStateId,
                action: item.action,
                label: item.label,
              },
            });
          }
        },
      );
    } catch {
      // Ignore race errors from concurrent bootstrap; we'll re-read below.
    }

    const bootstrapped = await this.findActiveWorkflow(modelName, companyId);
    if (!bootstrapped) {
      throw new NotFoundException(`未找到模型 ${modelName} 的 workflow 定义`);
    }

    return bootstrapped;
  }

  private findActiveWorkflow(
    modelName: string,
    companyId: string,
  ): Promise<WorkflowDefinitionRecord | null> {
    return this.prisma.workflow.findFirst({
      where: {
        modelName,
        isActive: true,
        OR: [{ companyId }, { companyId: null }],
      },
      include: {
        transitions: {
          include: { fromState: true, toState: true },
        },
      },
      orderBy: [{ companyId: 'desc' }],
    }) as Promise<WorkflowDefinitionRecord | null>;
  }
}
