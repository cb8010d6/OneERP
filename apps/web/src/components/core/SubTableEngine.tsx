'use client';

import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { UiFieldSchema, UiSubtableConfig } from '@/lib/ui-schema';
import { FormEngine } from './FormEngine';

interface SubTableEngineProps {
  schema: UiSubtableConfig;
  value: Record<string, unknown>[];
  onChange: (next: Record<string, unknown>[]) => void;
  readOnly?: boolean;
}

export function SubTableEngine({ schema, value, onChange, readOnly }: SubTableEngineProps) {
  const rows = Array.isArray(value) ? value : [];

  const handleAddRow = () => {
    if (readOnly) return;
    const newRow = schema.fields.reduce<Record<string, unknown>>((acc, field) => {
      acc[field.name] = field.type === 'boolean' ? false : '';
      return acc;
    }, {});
    onChange([...rows, { ...newRow, _tempId: Math.random().toString(36).substring(7) }]);
  };

  const handleRemoveRow = (index: number) => {
    if (readOnly) return;
    const next = [...rows];
    next.splice(index, 1);
    onChange(next);
  };

  const handleRowChange = (index: number, newRowData: Record<string, unknown>) => {
    if (readOnly) return;
    const next = [...rows];
    next[index] = { ...next[index], ...newRowData };
    onChange(next);
  };

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="w-12 px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
              #
            </th>
            {schema.fields.map((field) => (
              <th
                key={field.name}
                className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
              >
                {field.label}
                {field.required && <span className="text-rose-500 ml-1">*</span>}
              </th>
            ))}
            {!readOnly && (
              <th className="w-16 px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                操作
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {rows.map((row, index) => (
            <tr key={(row.id as string) || (row._tempId as string) || index}>
              <td className="whitespace-nowrap px-3 py-2 text-center text-xs text-gray-500">
                {index + 1}
              </td>
              {schema.fields.map((field) => (
                <td key={field.name} className="whitespace-nowrap px-3 py-2 align-top">
                  <div className="w-full min-w-[120px]">
                    {/* We can reuse FormEngine to render single fields by passing a mocked schema with one field */}
                    <FormEngine
                      schema={{
                        model: 'subtable-row',
                        label: 'row',
                        fields: [field],
                        views: { form: { fields: [field.name] }, list: { columns: [] } }
                      }}
                      value={row}
                      onChange={(nextRow) => handleRowChange(index, nextRow)}
                      readOnly={readOnly}
                      hideLabels
                    />
                  </div>
                </td>
              ))}
              {!readOnly && (
                <td className="whitespace-nowrap px-3 py-2 text-center align-middle">
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(index)}
                    className="text-gray-400 hover:text-rose-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={schema.fields.length + (readOnly ? 1 : 2)}
                className="px-6 py-4 text-center text-sm text-gray-500"
              >
                暂无行项明细
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {!readOnly && (
        <div className="bg-gray-50 px-4 py-2 border-t border-gray-200">
          <button
            type="button"
            onClick={handleAddRow}
            className="inline-flex items-center gap-1 rounded text-sm text-blue-600 hover:text-blue-700"
          >
            <Plus className="h-4 w-4" />
            添加行项
          </button>
        </div>
      )}
    </div>
  );
}
