const fs = require('fs');
const file = 'F:/enterprise-erp/apps/web/src/components/core/ListEngine.tsx';
let txt = fs.readFileSync(file, 'utf8');

txt = txt.replace(
  "import { useMemo, useState } from 'react';",
  "import { useMemo, useState, useCallback } from 'react';\nimport { DataGrid } from '../ui/data-grid/DataGrid';\nimport type { ColumnDef } from '@tanstack/react-table';"
);

const insertBlock = `
  const renderCellSafe = useCallback((row: Record<string, unknown>, column: string) => {
    return renderCell(row, column);
  }, [fieldMap]);

  const dataGridColumns = useMemo<ColumnDef<Record<string, unknown>, any>[]>(() => {
    return columns.map((column) => {
      const field = schema.fields.find((f) => f.name === column);
      return {
        id: column,
        accessorKey: column,
        header: field?.label ?? column,
        cell: (info) => {
          return renderCellSafe(info.row.original as Record<string, unknown>, column);
        },
      };
    });
  }, [columns, schema.fields, renderCellSafe]);
`;

txt = txt.replace(
  "  return (\n    <div className=\"overflow-hidden rounded-xl border border-gray-200 bg-white\">",
  insertBlock + "\n  return (\n    <div className=\"overflow-hidden rounded-xl border border-gray-200 bg-white\">"
);

const startIdx = txt.indexOf('<table className="w-full text-left text-sm">');
const endIdx = txt.indexOf('</table>');

if (startIdx !== -1 && endIdx !== -1) {
  const replacement = `
      <div className="px-4 py-2 bg-blue-50/50 border-b border-gray-200 text-xs text-blue-700 font-medium flex items-center justify-between">
        <span>✨ 核心引擎已通过 DataGrid 高性能虚拟网格接管 (支持配置列可见性与极速双击编辑)</span>
      </div>
      <div className="p-2 w-full">
        <DataGrid 
          columns={dataGridColumns} 
          data={viewRows as any[]} 
          height={500} 
        />
      </div>
  `;
  txt = txt.slice(0, startIdx) + replacement + txt.slice(endIdx + 8);
  fs.writeFileSync(file, txt, 'utf8');
  console.log('ListEngine replaced successfully.');
} else {
  console.log('Table not found');
}
