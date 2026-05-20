'use client';

import { Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataGrid } from '../ui/data-grid/DataGrid';
import type { UiFieldSchema, UiSchema } from '@/lib/ui-schema';
import { useI18n } from '@/lib/i18n';

type DataGridRow = Record<string, unknown> & { id: string };

interface ListEngineProps {
  schema: UiSchema;
  data: Record<string, unknown>[];
  fieldMap?: Record<string, UiFieldSchema>;
  page?: number;
  limit?: number;
  total?: number;
  loading?: boolean;
  serverSearch?: boolean;
  onSearchChange?: (value: string) => void;
  onSortChange?: (field: string, direction: 'asc' | 'desc') => void;
  onPageChange?: (page: number) => void;
  onRowClick?: (row: Record<string, unknown>) => void;
}

export function ListEngine({
  schema,
  data,
  fieldMap,
  page = 1,
  limit = 20,
  total,
  serverSearch,
  onSearchChange,
  onSortChange,
  onPageChange,
  onRowClick,
}: ListEngineProps) {
  const { t } = useI18n();
  const columns = schema.views.list.columns;
  const [keyword, setKeyword] = useState('');
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const filteredRows = useMemo(() => {
    if (serverSearch || !keyword.trim()) return data;
    const text = keyword.toLowerCase();
    const searchableFields = schema.views.list.searchFields?.length
      ? schema.views.list.searchFields
      : columns;

    return data.filter((row) =>
      searchableFields.some((field) =>
        String(getNestedValue(row, field) ?? '').toLowerCase().includes(text),
      ),
    );
  }, [columns, data, keyword, schema.views.list.searchFields, serverSearch]);

  const sortedRows = useMemo(() => {
    if (!sortField || serverSearch) return filteredRows;

    const rows = [...filteredRows];
    rows.sort((a, b) => {
      const left = getNestedValue(a, sortField);
      const right = getNestedValue(b, sortField);
      if (left === right) return 0;
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;

      const compare = String(left).localeCompare(String(right), 'zh-CN', {
        numeric: true,
        sensitivity: 'base',
      });
      return sortDirection === 'asc' ? compare : -compare;
    });
    return rows;
  }, [filteredRows, serverSearch, sortDirection, sortField]);

  const viewRows = useMemo<DataGridRow[]>(
    () =>
      sortedRows.map((row, index) => ({
        ...row,
        id: String(row.id ?? `row-${page}-${index}`),
      })),
    [page, sortedRows],
  );

  const totalCount = total ?? viewRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  const toggleSort = useCallback((field: string) => {
    const direction = sortField === field && sortDirection === 'asc' ? 'desc' : 'asc';
    setSortField(field);
    setSortDirection(direction);
    onSortChange?.(field, direction);
  }, [onSortChange, sortDirection, sortField]);

  const renderCell = useCallback(
    (row: Record<string, unknown>, column: string) => {
      const field = fieldMap?.[column];
      const rawValue = getNestedValue(row, column);
      if (!field || field.type !== 'reference') {
        return String(rawValue ?? '');
      }

      const relationField =
        field.reference?.relationField ??
        (field.name.endsWith('Id') ? field.name.slice(0, -2) : undefined);
      const labelField = field.reference?.labelField ?? 'name';

      if (!relationField) {
        return String(rawValue ?? '');
      }

      const relation = row[relationField] as Record<string, unknown> | undefined;
      if (relation && typeof relation === 'object') {
        const label = relation[labelField];
        if (label !== undefined && label !== null && String(label).trim() !== '') {
          return String(label);
        }
      }

      return String(rawValue ?? '');
    },
    [fieldMap],
  );

  const dataGridColumns = useMemo<ColumnDef<DataGridRow, unknown>[]>(() => {
    return columns.map((column) => {
      const field = schema.fields.find((item) => item.name === column);
      return {
        id: column,
        accessorKey: column,
        header: () => (
          <button
            type="button"
            className="text-left"
            onClick={() => toggleSort(column)}
          >
            {field?.label ?? column}
          </button>
        ),
        cell: (info) => renderCell(info.row.original, column),
      };
    });
  }, [columns, renderCell, schema.fields, toggleSort]);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50/70 px-4 py-3">
        <div className="text-sm font-medium text-gray-700">
          {t('listTotalPrefix')} {totalCount} {t('listTotalSuffix')}
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={keyword}
            onChange={(event) => {
              const next = event.target.value;
              setKeyword(next);
              onSearchChange?.(next);
            }}
            placeholder={t('listSearchPlaceholder')}
            className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-2 focus:ring-gray-100"
          />
        </div>
      </div>

      <div className="p-2">
        <DataGrid
          columns={dataGridColumns}
          data={viewRows}
          height={500}
          onRowClick={(row) => onRowClick?.(row)}
        />
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-4 py-3">
        <button
          type="button"
          onClick={() => onPageChange?.(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('listPrevious')}
        </button>
        <span className="text-sm text-gray-500">
          {t('listPagePrefix')} {page} {t('listPageMiddle')} {totalPages} {t('listPageSuffix')}
        </span>
        <button
          type="button"
          onClick={() => onPageChange?.(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('listNext')}
        </button>
      </div>
    </div>
  );
}

function getNestedValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') {
      return undefined;
    }
    return (acc as Record<string, unknown>)[key];
  }, source);
}
