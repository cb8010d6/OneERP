'use client';

import type { StockTransaction } from './SaleOrderDrawer';

interface ShipmentTimelineProps {
  transactions: StockTransaction[];
}

export function ShipmentTimeline({ transactions }: ShipmentTimelineProps) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200/60 shadow-sm">
      <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">库存过账流水摘要</h3>
      {transactions.length === 0 ? (
        <p className="text-sm text-slate-500">暂无过账记录。</p>
      ) : (
        <div className="border-l-2 border-blue-200 ml-3 space-y-4">
          {transactions.map((tx) => (
            <div key={tx.id} className="relative pl-6">
              <div className="absolute left-[-5px] top-1 h-2.5 w-2.5 rounded-full bg-blue-500 ring-4 ring-white" />
              <p className="text-xs text-slate-400">{new Date(tx.createdAt).toLocaleString()}</p>
              <p className="text-sm font-medium text-slate-800 mt-0.5">
                {tx.type === 'OUTBOUND' ? '🔴 出库过账' : tx.type === 'INBOUND' ? '🟢 入库过账' : '🔵 库间调拨'} —{' '}
                <span className="text-slate-600">{tx.material?.name || tx.materialId}</span>{' '}
                <span className="font-mono text-blue-700">× {tx.quantity} {tx.material?.unit}</span>
              </p>
              {tx.note && <p className="text-xs text-slate-500 mt-0.5">{tx.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
