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
import { useEffect, useMemo, useRef, useState } from 'react';
import { AsyncSelect, type AsyncSelectRecord } from '@/components/core/AsyncSelect';
import type { UiFieldReference } from '@/lib/ui-schema';

type DataGridColumnMeta<TData> = {
  editable?: boolean;
  options?: Array<{ label: string; value: string }>;
  reference?: UiFieldReference;
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
}

export function DataGrid<TData extends { id: string }>({
  columns,
  data,
  onCellUpdate,
  onRowClick,
  enableRowSelection = false,
  onSelectionChange,
  height = 460,
}: DataGridProps<TData>) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [editingCell, setEditingCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [editingValue, setEditingValue] = useState('');

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
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const gridTemplate = useMemo(() => {
    const base = table
      .getVisibleFlatColumns()
      .map((column) => {
        const size = column.getSize();
        return `${Math.max(size || 140, 120)}px`;
      });

    if (enableRowSelection) {
      return ['44px', ...base].join(' ');
    }
    return base.join(' ');
  }, [enableRowSelection, table]);

  const selectedCount = rows.reduce((acc, row) => acc + (row.getIsSelected() ? 1 : 0), 0);
  const allChecked = rows.length > 0 && selectedCount === rows.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2">
        {table.getAllLeafColumns().map((column) => {
          const visible = column.getIsVisible();
          return (
            <label key={column.id} className="inline-flex items-center gap-1 rounded bg-gray-50 px-2 py-1 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={visible}
                onChange={(event) => column.toggleVisibility(event.target.checked)}
              />
              {String(column.columnDef.header ?? column.id)}
            </label>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="grid border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-600" style={{ gridTemplateColumns: gridTemplate }}>
          {enableRowSelection ? (
            <div className="border-r border-gray-200 px-3 py-2 text-center">
              <input
                type="checkbox"
                checked={allChecked}
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
            headerGroup.headers.map((header) => (
              <div key={header.id} className="border-r border-gray-200 px-3 py-2 last:border-r-0">
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </div>
            )),
          )}
        </div>

        <div ref={parentRef} className="overflow-auto" style={{ height }}>
          <div style={{ height: totalSize, position: 'relative' }}>
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              return (
                <div
                  key={row.id}
                  className={`grid border-b border-gray-100 text-sm text-gray-700 ${
                    onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''
                  }`}
                  style={{
                    gridTemplateColumns: gridTemplate,
                    position: 'absolute',
                    transform: `translateY(${virtualRow.start}px)`,
                    width: '100%',
                  }}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {enableRowSelection ? (
                    <div className="border-r border-gray-100 px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={row.getIsSelected()}
                        onChange={(event) => row.toggleSelected(event.target.checked)}
                      />
                    </div>
                  ) : null}
                  {row.getVisibleCells().map((cell) => {
                    const columnMeta =
                      ((cell.column.columnDef as { meta?: DataGridColumnMeta<TData> }).meta ?? {});
                    const isEditing =
                      editingCell?.rowId === row.original.id && editingCell?.columnId === cell.column.id;
                    const options = columnMeta.options;
                    const reference = columnMeta.reference;
                    const isEditable = columnMeta.editable !== false;
                    return (
                      <div
                        key={cell.id}
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
  );
}
