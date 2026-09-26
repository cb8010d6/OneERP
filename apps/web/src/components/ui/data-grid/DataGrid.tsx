'use client';

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  RowSelectionState,
  useReactTable,
  VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Columns3, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AsyncSelect, type AsyncSelectRecord } from '@/components/core/AsyncSelect';
import type { UiFieldReference } from '@/lib/ui-schema';
import { useI18n } from '@/lib/i18n';

type DataGridColumnMeta<TData> = {
  label?: string;
  editable?: boolean;
  options?: Array<{ label: string; value: string }>;
  reference?: UiFieldReference;
  sortDirection?: 'asc' | 'desc';
  onReferenceSelect?: (
    rowId: string,
    columnId: string,
    value: string,
    record: AsyncSelectRecord,
    row: TData,
  ) => void;
};

interface DataGridProps<TData extends { id: string }> {
  // TanStack column definitions are invariant in TValue; a grid containing
  // heterogeneous string/number columns must erase TValue at this boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[];
  data: TData[];
  onCellUpdate?: (rowId: string, columnId: string, value: string) => void;
  onRowClick?: (row: TData) => void;
  enableRowSelection?: boolean;
  onSelectionChange?: (rowIds: string[]) => void;
  height?: number;
  viewId?: string;
}

function columnVisibilityStorageKey(viewId: string) {
  return `oneerp:data-grid:${viewId}:columns`;
}

function readColumnVisibility(viewId?: string): VisibilityState {
  if (!viewId || typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(columnVisibilityStorageKey(viewId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    );
  } catch {
    return {};
  }
}

function getColumnLabel<TData>(
  columnDef: ColumnDef<TData, unknown>,
  columnId: string,
) {
  const meta = columnDef.meta as DataGridColumnMeta<TData> | undefined;
  if (meta?.label) return meta.label;
  return typeof columnDef.header === 'string' ? columnDef.header : columnId;
}

const HEADER_HEIGHT = 40;

export function DataGrid<TData extends { id: string }>({
  columns,
  data,
  onCellUpdate,
  onRowClick,
  enableRowSelection = false,
  onSelectionChange,
  height = 460,
  viewId,
}: DataGridProps<TData>) {
  const { t } = useI18n();
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => readColumnVisibility(viewId),
  );
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [editingCell, setEditingCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);

  useEffect(() => {
    if (!viewId) return;
    try {
      window.localStorage.setItem(
        columnVisibilityStorageKey(viewId),
        JSON.stringify(columnVisibility),
      );
    } catch {
      // Column preferences are optional; storage failures must not block the grid.
    }
  }, [columnVisibility, viewId]);

  // TanStack Table returns callable state accessors that React Compiler cannot
  // safely memoize; the component already owns their state explicitly.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: { columnVisibility, rowSelection },
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    enableRowSelection,
  });

  const rows = table.getRowModel().rows;
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enableRowSelection) {
      onSelectionChange?.([]);
      return;
    }
    const selectedIds = table
      .getSelectedRowModel()
      .rows.map((row) => row.original.id);
    onSelectionChange?.(selectedIds);
  }, [enableRowSelection, onSelectionChange, rowSelection, table]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    scrollMargin: HEADER_HEIGHT,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const visibleColumns = table.getVisibleFlatColumns();
  const columnWidths = visibleColumns.map((column) =>
    Math.max(column.getSize() || 140, 120),
  );
  const gridTemplate = [
    ...(enableRowSelection ? ['44px'] : []),
    ...columnWidths.map((width) => `${width}px`),
  ].join(' ');
  const gridWidth = columnWidths.reduce(
    (width, columnWidth) => width + columnWidth,
    enableRowSelection ? 44 : 0,
  );

  const selectedCount = rows.reduce((acc, row) => acc + (row.getIsSelected() ? 1 : 0), 0);
  const allChecked = rows.length > 0 && selectedCount === rows.length;

  return (
    <div className="space-y-3">
      <div className="relative flex justify-end">
        <button
          type="button"
          aria-label="列设置"
          aria-expanded={columnMenuOpen}
          onClick={() => setColumnMenuOpen((open) => !open)}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50"
          title="列设置"
        >
          <Columns3 className="h-4 w-4" />
          <span>列设置</span>
        </button>
        {columnMenuOpen ? (
          <div className="absolute right-0 top-10 z-20 min-w-48 rounded-md border border-gray-200 bg-white p-2 shadow-lg">
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-2 pb-2">
              <span className="text-xs font-medium text-gray-500">可见列</span>
              <button
                type="button"
                aria-label="恢复默认列"
                title="恢复默认列"
                onClick={() => setColumnVisibility({})}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
            {table.getAllLeafColumns().map((column) => {
              const visible = column.getIsVisible();
              const isLastVisibleColumn =
                visible && table.getVisibleLeafColumns().length === 1;
              return (
                <label
                  key={column.id}
                  className="flex items-center gap-2 rounded px-2 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={visible}
                    disabled={isLastVisibleColumn}
                    onChange={(event) =>
                      column.toggleVisibility(event.target.checked)
                    }
                  />
                  {getColumnLabel(column.columnDef, column.id)}
                </label>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div
          ref={parentRef}
          role="table"
          className="overflow-auto"
          style={{ height: height + HEADER_HEIGHT }}
        >
          <div
            role="rowgroup"
            style={{
              height: HEADER_HEIGHT + totalSize,
              position: 'relative',
              width: gridWidth,
              minWidth: '100%',
            }}
          >
            <div
              role="row"
              className="sticky top-0 z-10 grid h-10 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-600"
              style={{ gridTemplateColumns: gridTemplate, width: gridWidth, minWidth: '100%' }}
            >
              {enableRowSelection ? (
                <div role="columnheader" className="border-r border-gray-200 px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label={t('gridSelectAllRows')}
                    checked={allChecked}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      if (!event.target.checked) {
                        setRowSelection({});
                        return;
                      }
                      const next: RowSelectionState = {};
                      rows.forEach((row) => {
                        next[row.id] = true;
                      });
                      setRowSelection(next);
                    }}
                  />
                </div>
              ) : null}
              {table.getHeaderGroups().map((headerGroup) =>
                headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta as
                    | DataGridColumnMeta<TData>
                    | undefined;
                  const ariaSort =
                    meta?.sortDirection === 'asc'
                      ? 'ascending'
                      : meta?.sortDirection === 'desc'
                        ? 'descending'
                        : undefined;

                  return (
                    <div
                      key={header.id}
                      role="columnheader"
                      aria-sort={ariaSort}
                      title={getColumnLabel(header.column.columnDef, header.column.id)}
                      className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap border-r border-gray-200 px-3 py-2 last:border-r-0"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </div>
                  );
                }),
              )}
            </div>

          <div
            style={{
              height: totalSize,
              position: 'absolute',
              top: HEADER_HEIGHT,
              width: gridWidth,
              minWidth: '100%',
            }}
          >
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              return (
                <div
                  key={row.id}
                  role="row"
                  className={`grid border-b border-gray-100 text-sm text-gray-700 ${
                    onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''
                  }`}
                  style={{
                    gridTemplateColumns: gridTemplate,
                    position: 'absolute',
                    transform: `translateY(${virtualRow.start - HEADER_HEIGHT}px)`,
                    width: '100%',
                  }}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {enableRowSelection ? (
                    <div role="cell" className="border-r border-gray-100 px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${t('gridSelectRow')} ${virtualRow.index + 1}`}
                        checked={row.getIsSelected()}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => row.toggleSelected(event.target.checked)}
                      />
                    </div>
                  ) : null}
                  {row.getVisibleCells().map((cell) => {
                    const columnMeta =
                      ((cell.column.columnDef as { meta?: DataGridColumnMeta<TData> }).meta ?? {});
                    const options = columnMeta.options;
                    const reference = columnMeta.reference;
                    const isEditable = Boolean(onCellUpdate) && columnMeta.editable !== false;
                    const isEditing =
                      isEditable && editingCell?.rowId === row.original.id && editingCell?.columnId === cell.column.id;
                    return (
                      <div
                        key={cell.id}
                        role="cell"
                        className="border-r border-gray-100 px-3 py-2 last:border-r-0"
                        onDoubleClick={() => {
                          if (!isEditable) return;
                          const value = String(cell.getValue() ?? '');
                          setEditingCell({ rowId: row.original.id, columnId: cell.column.id });
                          setEditingValue(value);
                        }}
                      >
                        {isEditing ? (
                          reference ? (
                            <AsyncSelect
                              id={`${row.original.id}-${cell.column.id}`}
                              value={editingValue}
                              reference={reference}
                              className="w-full rounded border border-blue-300 px-2 py-1 text-xs"
                              onChange={(value) => {
                                setEditingValue(value);
                                onCellUpdate?.(row.original.id, cell.column.id, value);
                                setEditingCell(null);
                                setEditingValue('');
                              }}
                              onSelectRecord={(record) =>
                                columnMeta.onReferenceSelect?.(
                                  row.original.id,
                                  cell.column.id,
                                  String(record[reference.valueField ?? 'id'] ?? ''),
                                  record,
                                  row.original,
                                )
                              }
                            />
                          ) : options?.length ? (
                            <select
                              autoFocus
                              value={editingValue}
                              onChange={(event) => {
                                const value = event.target.value;
                                setEditingValue(value);
                                onCellUpdate?.(row.original.id, cell.column.id, value);
                              }}
                              onBlur={() => {
                                onCellUpdate?.(row.original.id, cell.column.id, editingValue);
                                setEditingCell(null);
                                setEditingValue('');
                              }}
                              className="w-full rounded border border-blue-300 px-2 py-1 text-xs"
                            >
                              <option value="">-- 请选择 --</option>
                              {options.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              autoFocus
                              value={editingValue}
                              onChange={(event) => setEditingValue(event.target.value)}
                              onBlur={() => {
                                onCellUpdate?.(row.original.id, cell.column.id, editingValue);
                                setEditingCell(null);
                                setEditingValue('');
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  onCellUpdate?.(row.original.id, cell.column.id, editingValue);
                                  setEditingCell(null);
                                  setEditingValue('');
                                }
                                if (event.key === 'Escape') {
                                  setEditingCell(null);
                                  setEditingValue('');
                                }
                              }}
                              className="w-full rounded border border-blue-300 px-2 py-1 text-xs"
                            />
                          )
                        ) : (
                          flexRender(cell.column.columnDef.cell, cell.getContext())
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
