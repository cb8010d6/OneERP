'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LayoutGrid, Rows3, SquarePen } from 'lucide-react';
import { FormEngine } from './FormEngine';
import { Sheet } from '../ui/Sheet';
import { KanbanEngine } from './KanbanEngine';
import { ListEngine } from './ListEngine';
import { createResource, fetchResourceList, fetchSchema, updateResource } from '@/lib/dynamic-resource';
import api from '@/lib/api';
import type { UiSchema } from '@/lib/ui-schema';
import { useAuthStore } from '@/store/authStore';
import { useI18n } from '@/lib/i18n';

type ViewMode = 'list' | 'kanban';

interface DynamicViewProps {
  modelName: string;
  title?: string;
  externalDraft?: Record<string, unknown> | null;
}

function hasPermission(permissions: readonly string[], required: string) {
  if (permissions.includes('ALL') || permissions.includes(required)) return true;
  const parts = required.split(':');
  const resource = parts[0];
  const action = parts[parts.length - 1];
  return permissions.includes(`${resource}:*`) || permissions.includes(`*:${action}`);
}

export function DynamicView({ modelName, title, externalDraft }: DynamicViewProps) {
  const { companies, currentCompanyId } = useAuthStore();
  const { t } = useI18n();
  const [schema, setSchema] = useState<UiSchema | null>(null);
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [orderBy, setOrderBy] = useState<Record<string, 'asc' | 'desc'> | undefined>(undefined);
  const [mode, setMode] = useState<ViewMode>('list');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [timeline, setTimeline] = useState<Array<Record<string, unknown>>>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);
  const [saving, setSaving] = useState(false);

  const initialFormValue = useMemo(() => {
    if (!schema) return {};
    return schema.fields.reduce<Record<string, unknown>>((acc, field) => {
      return setNestedValue(acc, field.name, '');
    }, {});
  }, [schema]);

  const activeTitle = title ?? schema?.label ?? modelName;
  const currentPermissions =
    companies.find((company) => company.id === currentCompanyId)?.permissions ?? [];
  const permissionResource = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  const canCreate = hasPermission(currentPermissions, `${permissionResource}:create`);
  const canUpdate = hasPermission(currentPermissions, `${permissionResource}:update`);
  const selectedCanSave =
    selected && typeof selected.id === 'string' && selected.id.trim()
      ? canUpdate
      : canCreate;

  const loadSchema = useCallback(async () => {
    try {
      setError(null);
      const nextSchema = await fetchSchema(modelName);
      setSchema(nextSchema);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载元数据失败');
    }
  }, [modelName]);

  const loadList = useCallback(async () => {
    if (!schema) return;

    setLoading(true);
    try {
      setError(null);
      const include = schema.views.list.columns.reduce<Record<string, unknown>>((acc, column) => {
        const field = schema.fields.find((item) => item.name === column);
        if (field?.type !== 'reference') {
          return acc;
        }

        const relationField =
          field.reference?.relationField ??
          (field.name.endsWith('Id') ? field.name.slice(0, -2) : undefined);

        if (relationField) {
          acc[relationField] = true;
        }
        return acc;
      }, {});

      const result = await fetchResourceList(modelName, {
        page,
        limit,
        search,
        searchFields: schema.views.list.searchFields,
        orderBy,
        include,
      });
      setData(result.data as Record<string, unknown>[]);
      setTotal(result.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载数据失败');
      setData([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [limit, modelName, orderBy, page, schema, search]);

  useEffect(() => {
    void loadSchema();
  }, [loadSchema]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!schema || !externalDraft) {
      return;
    }

    const mapped: Record<string, unknown> = {};
    for (const field of schema.fields) {
      const direct = externalDraft[field.name];
      if (direct !== undefined) {
        mapped[field.name] = direct;
      }
    }

    setSelected((previous) => ({
      ...(initialFormValue as Record<string, unknown>),
      ...(previous && typeof previous === 'object' ? previous : {}),
      ...mapped,
    }));
    setIsFormOpen(true);
  }, [externalDraft, initialFormValue, schema]);

  useEffect(() => {
    const selectedId = selected?.id;
    if (!isFormOpen || !selectedId) {
      setTimeline([]);
      return;
    }

    const fetchTimeline = async () => {
      setTimelineLoading(true);
      try {
        const response = await api.get(`/v1/timeline/${modelName}/${String(selectedId)}`);
        setTimeline((response.data?.events as Array<Record<string, unknown>>) ?? []);
      } catch {
        setTimeline([]);
      } finally {
        setTimelineLoading(false);
      }
    };

    void fetchTimeline();
  }, [mode, modelName, selected?.id]);

  const submitComment = async () => {
    const selectedId = selected?.id;
    const content = commentInput.trim();
    if (!selectedId || !content || commentSaving) {
      return;
    }

    setCommentSaving(true);
    try {
      await api.post(`/v1/timeline/${modelName}/${String(selectedId)}/comment`, {
        content,
      });
      setCommentInput('');
      const refreshed = await api.get(`/v1/timeline/${modelName}/${String(selectedId)}`);
      setTimeline((refreshed.data?.events as Array<Record<string, unknown>>) ?? []);
    } finally {
      setCommentSaving(false);
    }
  };

  const saveForm = async () => {
    if (!schema || !selected || saving || !selectedCanSave) {
      return;
    }

    setSaving(true);
    try {
      const recordId = selected.id;
      const payload = { ...selected };

      let persisted: Record<string, unknown>;
      if (typeof recordId === 'string' && recordId.trim()) {
        persisted = await updateResource(modelName, recordId, payload);
      } else {
        persisted = await createResource(modelName, payload);
      }

      setSelected(persisted);
      await loadList();
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onShortcutSave = () => {
      if (isFormOpen) {
        void saveForm();
      }
    };

    window.addEventListener('erp:shortcut-save', onShortcutSave as EventListener);
    return () => {
      window.removeEventListener('erp:shortcut-save', onShortcutSave as EventListener);
    };
  }, [mode, selected, schema]);

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
        {t('dynamicMetadataLoading')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900">{activeTitle}</h2>
          <p className="mt-1 text-sm text-gray-500">{schema.description ?? t('dynamicDefaultDescription')}</p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          <ViewButton
            icon={<Rows3 className="h-4 w-4" />}
            active={mode === 'list'}
            onClick={() => setMode('list')}
            label={t('dynamicList')}
          />
          <ViewButton
            icon={<LayoutGrid className="h-4 w-4" />}
            active={mode === 'kanban'}
            onClick={() => setMode('kanban')}
            label={t('dynamicKanban')}
          />
          <ViewButton
            icon={<SquarePen className="h-4 w-4" />}
            active={isFormOpen}
            disabled={!canCreate}
            onClick={() => {
              setSelected(initialFormValue);
              setIsFormOpen(true);
            }}
            label={t('dynamicNewEdit')}
          />
        </div>
      </div>

      {mode === 'list' ? (
        <ListEngine
          schema={schema}
          data={data}
          page={page}
          limit={limit}
          total={total}
          loading={loading}
          serverSearch
          onSearchChange={(value) => {
            setPage(1);
            setSearch(value);
          }}
          onSortChange={(field, direction) => {
            setPage(1);
            setOrderBy({ [field]: direction });
          }}
          onPageChange={(nextPage) => setPage(nextPage)}
          onRowClick={(row) => {
            setSelected(row);
            setIsFormOpen(true);
          }}
          fieldMap={schema.fields.reduce<Record<string, UiSchema['fields'][number]>>((acc, field) => {
            acc[field.name] = field;
            return acc;
          }, {})}
        />
      ) : null}

      {mode === 'kanban' ? (
        <KanbanEngine
          schema={schema}
          data={data}
          onCardClick={(row) => { setSelected(row); setIsFormOpen(true); }}
          onOptimisticTransition={(id, toStatus) => {
            setData((prev) =>
              prev.map((item) =>
                String(item.id ?? '') === id
                  ? { ...item, [schema.views.kanban?.statusField ?? 'status']: toStatus }
                  : item,
              ),
            );
          }}
          onRollbackTransition={(id, fromStatus) => {
            setData((prev) =>
              prev.map((item) =>
                String(item.id ?? '') === id
                  ? { ...item, [schema.views.kanban?.statusField ?? 'status']: fromStatus }
                  : item,
              ),
            );
          }}
          onTransitionSuccess={() => {
            void loadList();
          }}
        />
      ) : null}

      <Sheet
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={selected && selected.id ? `${t('dynamicEdit')} ${activeTitle}` : `${t('dynamicNew')} ${activeTitle}`}
        widthClassName="w-[min(1000px,95vw)]"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-10">
          <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-7">
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => void saveForm()}
                disabled={saving || !selectedCanSave}
                className="rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? t('commonSaving') : selectedCanSave ? t('dynamicSaveShortcut') : t('dynamicNoSavePermission')}
              </button>
            </div>
            <FormEngine
              schema={schema}
              value={(selected ?? initialFormValue) as Record<string, unknown>}
              onChange={(next) => setSelected(next)}
              onSubmit={() => {
                void saveForm();
              }}
            />
          </div>

          <aside className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">{t('dynamicTimeline')}</h3>
            <p className="mt-1 text-xs text-gray-500">{t('dynamicTimelineHint')}</p>

            <div className="mt-3 max-h-[65vh] space-y-2 overflow-auto">
              {timelineLoading ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">{t('dynamicTimelineLoading')}</div>
              ) : timeline.length ? (
                timeline.map((event, index) => (
                  <div key={String(event.id ?? index)} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-gray-800">{String(event.action ?? 'EVENT')}</p>
                      <span className="text-[11px] text-gray-500">{String(event.createdAt ?? '')}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-600">{String((event.user as Record<string, unknown> | undefined)?.name ?? (event.user as Record<string, unknown> | undefined)?.email ?? '系统')}</p>
                    {event.details ? (
                      <pre className="mt-2 overflow-auto rounded bg-white p-2 text-[11px] text-gray-600">{JSON.stringify(event.details, null, 2)}</pre>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-500">{t('dynamicTimelineEmpty')}</div>
              )}
            </div>

            <div className="mt-3 border-t border-gray-100 pt-3">
              <textarea
                value={commentInput}
                onChange={(event) => setCommentInput(event.target.value)}
                placeholder={t('dynamicCommentPlaceholder')}
                rows={3}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 outline-none focus:border-gray-300 focus:ring-2 focus:ring-gray-100"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => void submitComment()}
                  disabled={commentSaving || !commentInput.trim()}
                  className="rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {commentSaving ? t('dynamicSubmitting') : t('dynamicPublishComment')}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </Sheet>
    </div>
  );
}

function setNestedValue(
  source: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path.split('.');
  const next = { ...source };
  let cursor: Record<string, unknown> = next;

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const isLeaf = i === keys.length - 1;
    if (isLeaf) {
      cursor[key] = value;
      continue;
    }

    const current = cursor[key];
    const child =
      current && typeof current === 'object' && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : {};

    cursor[key] = child;
    cursor = child;
  }

  return next;
}

interface ViewButtonProps {
  icon: ReactNode;
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}

function ViewButton({ icon, active, disabled = false, label, onClick }: ViewButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition ${
        active ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
      } disabled:cursor-not-allowed disabled:opacity-50`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      {label}
    </button>
  );
}
