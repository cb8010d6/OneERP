'use client';

import { useMemo, useState } from 'react';
import { ColumnDef, createColumnHelper } from '@tanstack/react-table';
import { DataGrid } from '@/components/ui/data-grid/DataGrid';

type DemoRow = {
  id: string;
  orderNo: string;
  customer: string;
  sku: string;
  qty: number;
  unitPrice: number;
  status: string;
};

const columnHelper = createColumnHelper<DemoRow>();

const columns: ColumnDef<DemoRow, any>[] = [
  columnHelper.accessor('orderNo', { header: '订单号', size: 160 }),
  columnHelper.accessor('customer', { header: '客户', size: 180 }),
  columnHelper.accessor('sku', { header: 'SKU', size: 180 }),
  columnHelper.accessor('qty', { header: '数量', size: 100 }),
  columnHelper.accessor('unitPrice', { header: '单价', size: 120 }),
  columnHelper.accessor('status', { header: '状态', size: 130 }),
];

function makeRows(count: number): DemoRow[] {
  const statuses = ['DRAFT', 'PENDING', 'IN_PRODUCTION', 'SHIPPED'];
  return Array.from({ length: count }).map((_, index) => ({
    id: `row-${index + 1}`,
    orderNo: `ORD-202603-${String(index + 1).padStart(4, '0')}`,
    customer: `客户-${(index % 25) + 1}`,
    sku: `SKU-${(index % 120) + 1}`,
    qty: (index % 10) + 1,
    unitPrice: 100 + (index % 50) * 5,
    status: statuses[index % statuses.length],
  }));
}

export default function DataGridLabPage() {
  const [rows, setRows] = useState<DemoRow[]>(() => makeRows(10000));

  const summary = useMemo(() => {
    const totalQty = rows.reduce((sum, row) => sum + row.qty, 0);
    const totalAmount = rows.reduce((sum, row) => sum + row.qty * row.unitPrice, 0);
    return {
      totalQty,
      totalAmount,
    };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-gray-900">Data Grid 基类演示</h2>
        <p className="mt-1 text-sm text-gray-500">
          支持列显隐、虚拟滚动（1万行）、单元格双击行内编辑。
        </p>
        <div className="mt-3 flex gap-6 text-sm text-gray-600">
          <span>总数量: {summary.totalQty}</span>
          <span>总金额: ¥{summary.totalAmount.toLocaleString()}</span>
        </div>
      </div>

      <DataGrid
        columns={columns}
        data={rows}
        onCellUpdate={(rowId, columnId, value) => {
          setRows((prev) =>
            prev.map((row) => {
              if (row.id !== rowId) return row;
              if (columnId === 'qty' || columnId === 'unitPrice') {
                const numeric = Number(value);
                return { ...row, [columnId]: Number.isFinite(numeric) ? numeric : row[columnId] } as DemoRow;
              }
              return { ...row, [columnId]: value } as DemoRow;
            }),
          );
        }}
      />
    </div>
  );
}
