import { Injectable } from '@nestjs/common';

export type CrudHookEvent =
  | 'beforeValidate'
  | 'beforeInsert'
  | 'afterInsert'
  | 'beforeUpdate'
  | 'afterUpdate'
  | 'beforeDelete'
  | 'afterDelete';

export interface CrudHookContext {
  modelName: string;
  operation: 'create' | 'update' | 'delete';
  companyId?: string;
  id?: string;
  data?: Record<string, unknown>;
  existing?: unknown;
  result?: unknown;
}

export type CrudHookHandler = (
  ctx: CrudHookContext,
) => void | Partial<CrudHookContext> | Promise<void | Partial<CrudHookContext>>;

@Injectable()
export class CrudHooksService {
  private readonly hooks = new Map<
    CrudHookEvent,
    Map<string, CrudHookHandler[]>
  >();

  register(event: CrudHookEvent, modelName: string, handler: CrudHookHandler) {
    const eventHooks =
      this.hooks.get(event) ?? new Map<string, CrudHookHandler[]>();
    const key = this.normalize(modelName);
    const handlers = eventHooks.get(key) ?? [];

    handlers.push(handler);
    eventHooks.set(key, handlers);
    this.hooks.set(event, eventHooks);
  }

  async execute(
    event: CrudHookEvent,
    ctx: CrudHookContext,
  ): Promise<CrudHookContext> {
    const eventHooks = this.hooks.get(event);
    if (!eventHooks) {
      return ctx;
    }

    const modelHandlers = eventHooks.get(this.normalize(ctx.modelName)) ?? [];
    const globalHandlers = eventHooks.get('*') ?? [];
    const handlers = [...globalHandlers, ...modelHandlers];

    let nextCtx = ctx;
    for (const handler of handlers) {
      const patch = await handler(nextCtx);
      if (patch && typeof patch === 'object') {
        nextCtx = { ...nextCtx, ...patch };
      }
    }

    return nextCtx;
  }

  private normalize(modelName: string) {
    return modelName.trim();
  }
}
