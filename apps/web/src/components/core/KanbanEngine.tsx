'use client';

import { useMemo, useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import type { UiKanbanColumn, UiSchema } from '@/lib/ui-schema';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';

interface KanbanEngineProps {
  schema: UiSchema;
  data: Record<string, unknown>[];
  onCardClick?: (card: Record<string, unknown>) => void;
  onOptimisticTransition?: (id: string, toStatus: string) => void;
  onRollbackTransition?: (id: string, fromStatus: string) => void;
  onTransitionSuccess?: () => void;
}

interface PendingTransition {
  modelName: string;
  id: string;
  fromStatus: string;
  toStatus: string;
  action: string;
}

export function KanbanEngine({
  schema,
  data,
  onCardClick,
  onOptimisticTransition,
  onRollbackTransition,
  onTransitionSuccess,
}: KanbanEngineProps) {
  const kanban = schema.views.kanban;
  const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(null);
  const [transitionData, setTransitionData] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Address React 18+ strict mode issues with drag and drop
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const columns = useMemo(() => {
    if (!kanban) return [] as UiKanbanColumn[];
    return kanban.columns.length
      ? kanban.columns
      : buildColumnsFromData(data, kanban.statusField);
  }, [kanban, data]);
  const activeFields = useMemo(() => {
    if (!kanban) return [];
    if (!pendingTransition) return [];
    const transitionForms = kanban.transitionForms ?? {};
    const configured = transitionForms[pendingTransition.toStatus] ?? [];
    if (configured.length) return configured;
    if (pendingTransition.toStatus === 'SHIPPED') {
      return [
        { name: 'sourceLocationId', label: '来源库位ID', placeholder: '请输入发货来源库位ID' },
        { name: 'batchNo', label: '批次号', placeholder: '可选' },
        { name: 'shipmentNote', label: '备注', placeholder: '可选' },
      ];
    }
    return [];
  }, [kanban, pendingTransition]);

  const handleDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result;

    if (!destination) return;
    if (source.droppableId === destination.droppableId) return;

    const fromStatus = source.droppableId;
    const toStatus = destination.droppableId;
    const id = draggableId;
    if (!id || !fromStatus || fromStatus === toStatus) return;

    const action = resolveTransitionAction(schema.model, fromStatus, toStatus);
    if (!action) {
      toast.error('未定义该状态流转动作');
      return;
    }

    setPendingTransition({
      modelName: schema.model,
      id,
      fromStatus,
      toStatus,
      action,
    });
    setTransitionData({});
  };

  if (!isMounted) return null;
  if (!kanban) {
    return <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-500">暂无看板配置</div>;
  }

  return (
    <>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4 items-start h-full min-h-[500px]">
          {columns.map((column) => {
            const cards = data.filter((item) => String(item[kanban.statusField]) === String(column.value));
            return (
              <div
                key={column.value}
                className="flex-shrink-0 w-80 flex flex-col max-h-[85vh] rounded-2xl border border-gray-200 bg-gray-50/80 p-3"
              >
                <header className="flex items-center justify-between mb-3 px-1 relative">
                  <div className="flex items-center gap-2">
                    {column.color && (
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: column.color }} />
                    )}
                    <span className="text-sm font-bold text-gray-800 tracking-wide">{column.label}</span>
                  </div>
                  <span className="rounded-full bg-white border border-gray-200 px-2.5 py-0.5 text-xs font-semibold text-gray-600 shadow-sm">
                    {cards.length}
                  </span>
                </header>

                <Droppable droppableId={String(column.value)}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 overflow-y-auto space-y-3 pb-2 transition-colors duration-200 ${
                        snapshot.isDraggingOver ? 'bg-blue-50/50 rounded-xl' : ''
                      }`}
                      style={{ minHeight: '150px' }}
                    >
                      {cards.map((card, index) => {
                        const cardId = String(card.id ?? index);
                        return (
                          <Draggable key={cardId} draggableId={cardId} index={index}>
                            {(providedDrag, snapshotDrag) => (
                              <div
                                ref={providedDrag.innerRef}
                                {...providedDrag.draggableProps}
                                {...providedDrag.dragHandleProps}
                                onClick={() => onCardClick?.(card)}
                                style={{
                                  ...providedDrag.draggableProps.style,
                                }}
                                className={`rounded-xl border bg-white p-3.5 text-left text-sm text-gray-800 transition-all ${
                                  snapshotDrag.isDragging
                                    ? 'border-blue-400 shadow-xl shadow-blue-100/50 ring-2 ring-blue-500/20 rotate-1 scale-105 z-10'
                                    : 'border-gray-200 shadow-sm hover:border-gray-300 hover:shadow-md'
                                }`}
                              >
                                <div className="font-semibold">{toDisplayText(card.name ?? card.title) || '未命名'}</div>
                                <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                                  <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                                    {toDisplayText(card.code ?? card.id)}
                                  </span>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>

      {pendingTransition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900">确认状态流转</h3>
            <p className="mt-1 text-sm text-gray-500">
              {pendingTransition.fromStatus} -&gt; <span className="font-semibold text-gray-800">{pendingTransition.toStatus}</span>
            </p>

            {activeFields.length > 0 ? (
              <div className="mt-4 space-y-3">
                {activeFields.map((field) => (
                  <div key={field.name}>
                    <label className="mb-1 block text-sm font-medium text-gray-700">{field.label}</label>
                    <input
                      value={transitionData[field.name] ?? ''}
                      onChange={(event) =>
                        setTransitionData((prev) => ({ ...prev, [field.name]: event.target.value }))
                      }
                      placeholder={field.placeholder}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-all"
                    />
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                onClick={() => {
                  setPendingTransition(null);
                  setTransitionData({});
                }}
              >
                取消
              </button>
              <button
                type="button"
                disabled={submitting}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center gap-2"
                onClick={async () => {
                  setSubmitting(true);
                  const optimisticId = pendingTransition.id;
                  const optimisticFrom = pendingTransition.fromStatus;
                  const optimisticTo = pendingTransition.toStatus;

                  onOptimisticTransition?.(optimisticId, optimisticTo);
                  try {
                    await api.post(
                      `/v1/workflow/${pendingTransition.modelName}/${pendingTransition.id}/transition`,
                      {
                        action: pendingTransition.action,
                        data: transitionData,
                      },
                    );
                    toast.success('流转成功');
                    setPendingTransition(null);
                    setTransitionData({});
                    onTransitionSuccess?.();
                  } catch (error: unknown) {
                    onRollbackTransition?.(optimisticId, optimisticFrom);
                    toast.error(getErrorMessage(error) || '流转失败');
                  } finally {
                    setSubmitting(false);
                  }
                }}
              >
                {submitting ? '提交中...' : '确认流转'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function resolveTransitionAction(modelName: string, fromStatus: string, toStatus: string) {
  const normalized = modelName.toLowerCase();
  if (normalized === 'order' || normalized === 'sale_order') {
    if (fromStatus === 'DRAFT' && toStatus === 'PENDING') return 'submit';
    if (fromStatus === 'PENDING' && toStatus === 'IN_PRODUCTION') return 'start_production';
    if (fromStatus === 'IN_PRODUCTION' && toStatus === 'SHIPPED') return 'ship';
    if (fromStatus === 'SHIPPED' && toStatus === 'COMPLETED') return 'complete';
    if (toStatus === 'CANCELLED') return 'cancel';
    return null;
  }

  return toStatus.trim().toLowerCase();
}

function buildColumnsFromData(
  data: Record<string, unknown>[],
  statusField: string,
): UiKanbanColumn[] {
  const values = Array.from(new Set(data.map((item) => item?.[statusField]).filter(Boolean)));
  return values.map((value) => ({ value: String(value), label: String(value) }));
}

function toDisplayText(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  return '';
}

function getErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') {
    return '';
  }

  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== 'object') {
    return '';
  }

  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== 'object') {
    return '';
  }

  const message = (data as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}
