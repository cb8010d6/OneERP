'use client';

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import type { UiKanbanColumn, UiSchema } from '@/lib/ui-schema';

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
  if (!kanban) {
    return <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-500">暂无看板配置</div>;
  }

  const columns = kanban.columns.length ? kanban.columns : buildColumnsFromData(data, kanban.statusField);
  const transitionForms = kanban.transitionForms ?? {};

  const activeFields = useMemo(() => {
    if (!pendingTransition) return [];
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
  }, [pendingTransition, transitionForms]);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        {columns.map((column) => {
          const cards = data.filter((item) => String(item[kanban.statusField]) === String(column.value));
          return (
            <div
              key={column.value}
              className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const payload = event.dataTransfer.getData('application/json');
                if (!payload) return;
                const card = JSON.parse(payload) as Record<string, unknown>;
                const id = String(card.id ?? '');
                const fromStatus = String(card[kanban.statusField] ?? '');
                const toStatus = String(column.value);
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
              }}
            >
              <header className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">{column.label}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-500">{cards.length}</span>
              </header>
              <div className="space-y-3">
                {cards.map((card, index) => (
                  <button
                    key={String(card.id ?? index)}
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('application/json', JSON.stringify(card));
                    }}
                    onClick={() => onCardClick?.(card)}
                    className="w-full rounded-xl border border-gray-200 bg-white p-3 text-left text-sm text-gray-800 shadow-sm transition hover:border-gray-300"
                  >
                    <div className="font-medium">{toDisplayText(card.name ?? card.title) || '未命名'}</div>
                    <div className="mt-1 text-xs text-gray-500">{toDisplayText(card.code ?? card.id)}</div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {pendingTransition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">确认状态流转</h3>
            <p className="mt-1 text-sm text-gray-500">
              {pendingTransition.fromStatus} -&gt; {pendingTransition.toStatus}
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
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700"
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
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60"
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
                  } catch (error: any) {
                    onRollbackTransition?.(optimisticId, optimisticFrom);
                    toast.error(error?.response?.data?.message || '流转失败');
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
