'use client';

import type { StockTransaction } from './SaleOrderDrawer';

interface ShipmentsTableProps {
  transactions: StockTransaction[];
}

export function ShipmentsTable({ transactions }: ShipmentsTableProps) {
  const typeConfig: Record<string, { label: string; color: string }> = {
    OUTBOUND: { label: '出库', color: 'bg-orange-100 text-orange-700' },
    INBOUND: { label: '入库', color: 'bg-green-100 text-green-700' },
    TRANSFER: { label: '调拨', color: 'bg-blue-100 text-blue-700' },
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">类型</th>
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">物料</th>
            <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">数量</th>
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">批次</th>
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">来源库位</th>
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">目标库位</th>
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">参考单号</th>
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">备注</th>
            <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">时间</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {transactions.map((tx) => {
            const cfg = typeConfig[tx.type] || { label: tx.type, color: 'bg-slate-100 text-slate-600' };
            return (
              <tr key={tx.id} className="hover:bg-slate-50/50 transition">
                <td className="py-2.5 px-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                </td>
                <td className="py-2.5 px-3">
                  <div className="font-medium text-slate-800">{tx.material?.name || tx.materialId}</div>
                  <div className="text-xs text-slate-400">{tx.material?.sku}</div>
                </td>
                <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">
                  {tx.quantity} <span className="text-xs text-slate-400">{tx.material?.unit}</span>
                </td>
                <td className="py-2.5 px-3 text-xs text-slate-600">{tx.batchNo || '-'}</td>
                <td className="py-2.5 px-3 text-xs text-slate-600">
                  {tx.sourceLocation ? (tx.sourceLocation.warehouse?.name ? `${tx.sourceLocation.warehouse.name}/` : '') + tx.sourceLocation.name : '-'}
                </td>
                <td className="py-2.5 px-3 text-xs text-slate-600">
                  {tx.destLocation ? (tx.destLocation.warehouse?.name ? `${tx.destLocation.warehouse.name}/` : '') + tx.destLocation.name : '-'}
                </td>
                <td className="py-2.5 px-3">
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-mono">{tx.referenceNo || '-'}</span>
                </td>
                <td className="py-2.5 px-3 text-xs text-slate-500 max-w-[200px] truncate" title={tx.note || ''}>{tx.note || '-'}</td>
                <td className="py-2.5 px-3 text-right text-xs text-slate-400">{new Date(tx.createdAt).toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
