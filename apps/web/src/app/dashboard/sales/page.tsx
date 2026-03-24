'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SaleOrderDrawer } from '@/components/sales/SaleOrderDrawer';
import api from '@/lib/api';
import { ShoppingCart, Plus, Search, Filter, Loader2 } from 'lucide-react';

interface SalesOrderListItem {
  id: string;
  orderNo: string;
  status: string;
  totalAmount: number;
  expectedDate: string | null;
  createdAt: string;
  partner?: {
    name?: string;
  };
}

const STATUS_OPTIONS = [
  { key: 'ALL', label: '全部' },
  { key: 'DRAFT', label: '草稿待确认' },
  { key: 'PENDING', label: '待处理' },
  { key: 'IN_PRODUCTION', label: '生产中' },
  { key: 'SHIPPED', label: '已发货' },
  { key: 'COMPLETED', label: '已完成' },
] as const;

function statusClass(status: string) {
  if (status === 'PENDING') return 'bg-amber-100 text-amber-700';
  if (status === 'IN_PRODUCTION') return 'bg-sky-100 text-sky-700';
  if (status === 'SHIPPED') return 'bg-indigo-100 text-indigo-700';
  if (status === 'COMPLETED') return 'bg-green-100 text-green-700';
  if (status === 'CANCELLED') return 'bg-rose-100 text-rose-700';
  return 'bg-slate-100 text-slate-600';
}

export default function SalesModulePage() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orders, setOrders] = useState<SalesOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]['key']>('ALL');

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('limit', '100');
      if (search.trim()) {
        params.set('search', search.trim());
      }
      if (statusFilter !== 'ALL') {
        params.set('status', statusFilter);
      }

      const response = await api.get<{ data: SalesOrderListItem[] }>(`/orders?${params.toString()}`);
      setOrders(response.data?.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const totalCount = orders.length;
  const countByStatus = useMemo(() => {
    return orders.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [orders]);

  return (
    <div className="h-full bg-slate-50/50 p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 flex items-center gap-3">
            <ShoppingCart className="h-8 w-8 text-blue-600" />
            销售订单 (Sales Orders)
          </h1>
          <p className="text-slate-500 mt-1">
            企业级高密度管理，已接入真实后端数据流与状态机。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setSelectedOrderId(null);
              setDrawerOpen(true);
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition shadow-lg shadow-slate-200"
          >
            <Plus className="h-4 w-4" />
            新建订单 (Create SO)
          </button>
        </div>
      </div>

      <div className="flex border-b border-slate-200 gap-6 text-sm font-medium">
        {STATUS_OPTIONS.map((item) => {
          const count = item.key === 'ALL' ? totalCount : (countByStatus[item.key] ?? 0);
          const active = statusFilter === item.key;
          return (
            <button
              key={item.key}
              className={active
                ? 'pb-3 border-b-2 border-blue-600 text-blue-700'
                : 'pb-3 border-b-2 border-transparent text-slate-500 hover:text-slate-800'}
              onClick={() => setStatusFilter(item.key)}
            >
              {item.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/40">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  fetchOrders();
                }
              }}
              placeholder="搜索单号、客户..."
              className="pl-9 pr-4 py-2 w-full rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <button
            className="flex items-center gap-1 text-slate-500 hover:text-slate-800 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white"
            onClick={() => fetchOrders()}
          >
            <Filter className="h-4 w-4" /> 刷新
          </button>
        </div>

        <div className="min-w-full">
          <div className="grid grid-cols-5 px-6 py-3 border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-600 uppercase tracking-wider">
            <div>单号 (Order Number)</div>
            <div>客户 (Customer)</div>
            <div>交期 (Expected Date)</div>
            <div>总计 (Total Amount)</div>
            <div>状态 (Status)</div>
          </div>
          {loading ? (
            <div className="px-6 py-12 text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> 正在加载订单...
            </div>
          ) : orders.length === 0 ? (
            <div className="px-6 py-12 text-sm text-slate-500">暂无订单数据，可点击右上角新建订单。</div>
          ) : (
            orders.map((order) => (
              <div
                key={order.id}
                onDoubleClick={() => {
                  setSelectedOrderId(order.id);
                  setDrawerOpen(true);
                }}
                className="grid grid-cols-5 px-6 py-4 border-b last:border-b-0 border-slate-100 hover:bg-slate-50/80 transition cursor-pointer select-none items-center group"
              >
                <div className="font-bold text-blue-700 group-hover:text-blue-800">{order.orderNo}</div>
                <div className="text-slate-900 font-medium">{order.partner?.name || '未命名客户'}</div>
                <div className="text-slate-500 text-sm font-mono">
                  {order.expectedDate ? new Date(order.expectedDate).toISOString().slice(0, 10) : '-'}
                </div>
                <div className="text-slate-900 font-mono font-semibold">¥{order.totalAmount.toLocaleString()}</div>
                <div>
                  <span className={`inline-block px-2.5 py-1 text-[11px] font-bold rounded-md tracking-wide ${statusClass(order.status)}`}>
                    {order.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="text-sm text-slate-500 flex items-center justify-between px-2">
        <span>提示：双击任一订单行，即可划出高密度抽屉式表单（Drawer）</span>
        <span>共 {totalCount} 项记录</span>
      </div>

      <SaleOrderDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        orderId={selectedOrderId}
        onSaved={() => {
          fetchOrders();
        }}
      />
    </div>
  );
}
