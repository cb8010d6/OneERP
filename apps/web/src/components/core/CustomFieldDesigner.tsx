'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchCustomFields,
  fetchSchema,
  removeCustomField,
  upsertCustomField,
  type CustomFieldDefinition,
  type CustomFieldType,
} from '@/lib/dynamic-resource';

const MODEL_OPTIONS = [
  { value: 'partner', label: '伙伴 (partner)' },
  { value: 'order', label: '订单 (order)' },
  { value: 'product', label: '产品 (product)' },
];

interface FormState {
  fieldName: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  referenceModel: string;
  referenceLabelField: string;
  referenceValueField: string;
  referenceRelationField: string;
}

const initialForm: FormState = {
  fieldName: '',
  label: '',
  type: 'STRING',
  required: false,
  referenceModel: '',
  referenceLabelField: 'name',
  referenceValueField: 'id',
  referenceRelationField: '',
};

export function CustomFieldDesigner() {
  const [modelName, setModelName] = useState<string>(MODEL_OPTIONS[0].value);
  const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedModelLabel = useMemo(
    () => MODEL_OPTIONS.find((option) => option.value === modelName)?.label ?? modelName,
    [modelName],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [definitions] = await Promise.all([
        fetchCustomFields(modelName),
        fetchSchema(modelName),
      ]);
      setFields(definitions);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载自定义字段失败');
    } finally {
      setLoading(false);
    }
  }, [modelName]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const trimmedFieldName = form.fieldName.trim();
    const trimmedLabel = form.label.trim();
    if (!trimmedFieldName || !trimmedLabel) {
      setError('字段编码与字段名称不能为空');
      return;
    }

    if (form.type === 'REF' && !form.referenceModel.trim()) {
      setError('引用字段必须填写 referenceModel');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      await upsertCustomField(modelName, {
        fieldName: trimmedFieldName,
        label: trimmedLabel,
        type: form.type,
        required: form.required,
        referenceModel: form.type === 'REF' ? form.referenceModel.trim() : undefined,
        referenceLabelField: form.type === 'REF' ? form.referenceLabelField.trim() : undefined,
        referenceValueField: form.type === 'REF' ? form.referenceValueField.trim() : undefined,
        referenceRelationField: form.type === 'REF' ? form.referenceRelationField.trim() : undefined,
      });

      setMessage(`字段 ${trimmedFieldName} 已保存`);
      setForm(initialForm);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (fieldName: string) => {
    setError(null);
    setMessage(null);
    try {
      await removeCustomField(modelName, fieldName);
      setMessage(`字段 ${fieldName} 已删除`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败');
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-1 md:col-span-1">
            <label className="text-sm font-medium text-gray-700">模型</label>
            <select
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
            >
              {MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1 md:col-span-1">
            <label className="text-sm font-medium text-gray-700">字段编码</label>
            <input
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
              placeholder="例如 loyaltyLevel"
              value={form.fieldName}
              onChange={(event) => setForm((prev) => ({ ...prev, fieldName: event.target.value }))}
            />
          </div>

          <div className="space-y-1 md:col-span-1">
            <label className="text-sm font-medium text-gray-700">字段名称</label>
            <input
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
              placeholder="例如 客户等级"
              value={form.label}
              onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
            />
          </div>

          <div className="space-y-1 md:col-span-1">
            <label className="text-sm font-medium text-gray-700">类型</label>
            <select
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
              value={form.type}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, type: event.target.value as CustomFieldType }))
              }
            >
              <option value="STRING">String</option>
              <option value="NUMBER">Number</option>
              <option value="REF">Ref</option>
            </select>
          </div>
        </div>

        {form.type === 'REF' ? (
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">referenceModel</label>
              <input
                className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
                placeholder="partner"
                value={form.referenceModel}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, referenceModel: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">referenceLabelField</label>
              <input
                className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
                value={form.referenceLabelField}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, referenceLabelField: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">referenceValueField</label>
              <input
                className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
                value={form.referenceValueField}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, referenceValueField: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">referenceRelationField</label>
              <input
                className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
                placeholder="可选"
                value={form.referenceRelationField}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, referenceRelationField: event.target.value }))
                }
              />
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.required}
              onChange={(event) => setForm((prev) => ({ ...prev, required: event.target.checked }))}
              className="h-4 w-4 rounded border-gray-300"
            />
            必填
          </label>

          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white transition hover:bg-gray-700 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存字段'}
          </button>
        </div>

        {message ? <p className="mt-3 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800">{selectedModelLabel} 自定义字段</h3>
        <p className="mt-1 text-xs text-gray-500">字段会自动注入 DynamicView 表单和列表，数据保存在 customAttributes JSON 中。</p>

        {loading ? (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">加载中...</div>
        ) : fields.length ? (
          <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">字段编码</th>
                  <th className="px-3 py-2">名称</th>
                  <th className="px-3 py-2">类型</th>
                  <th className="px-3 py-2">必填</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {fields.map((field) => (
                  <tr key={field.id}>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{field.fieldName}</td>
                    <td className="px-3 py-2 text-gray-800">{field.label}</td>
                    <td className="px-3 py-2 text-gray-700">{field.type}</td>
                    <td className="px-3 py-2 text-gray-700">{field.required ? '是' : '否'}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                        onClick={() => void remove(field.fieldName)}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-500">当前模型还没有自定义字段。</div>
        )}
      </div>
    </div>
  );
}
