'use client';

import { useEffect, useState } from 'react';
import { SaleOrderDrawer } from '@/components/sales/SaleOrderDrawer';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import Pagination from '@/components/Pagination';
import Link from 'next/link';
import {
  ClipboardList,
  Filter,
  Loader2,
  Plus,
  Search,
  ShoppingCart,
} from 'lucide-react';

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

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const PAGE_SIZE = 100;

const STATUS_OPTIONS = [
  { key: 'ALL', label: '全部' },
  { key: 'DRAFT', label: '草稿待确认' },
  { key: 'PENDING', label: '待处理' },
  { key: 'IN_PRODUCTION', label: '生产中' },
  { key: 'SHIPPED', label: '已发货' },
  { key: 'CANCELLED', label: '已取消' },
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
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] =
    useState<(typeof STATUS_OPTIONS)[number]['key']>('ALL');
  const [pagination, setPagination] = useState({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const { page, limit, total, totalPages } = pagination;

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');

    void api
      .get<PaginatedResponse<SalesOrderListItem>>('/orders', {
        params: {
          page,
          limit,
          search: search.trim() || undefined,
          status: statusFilter === 'ALL' ? undefined : statusFilter,
        },
      })
      .then((response) => {
        if (!current) return;
        const result = response.data;
        if (result.total > 0 && result.page > result.totalPages) {
          setPagination({
            page: result.totalPages,
            limit: result.limit,
            total: result.total,
            totalPages: result.totalPages,
          });
          return;
        }
        setOrders(result.data);
        setPagination({
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        });
      })
      .catch(() => {
        if (!current) return;
        setError('订单列表加载失败，请重试。');
        setOrders([]);
        setPagination((previous) => ({
          ...previous,
          total: 0,
          totalPages: 1,
        }));
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [limit, page, refreshKey, search, statusFilter]);

  const changeSearch = (value: string) => {
    setSearch(value);
    setPagination((previous) => ({ ...previous, page: 1 }));
  };

  const changeStatus = (value: (typeof STATUS_OPTIONS)[number]['key']) => {
    setStatusFilter(value);
    setPagination((previous) => ({ ...previous, page: 1 }));
  };

  return (
    <div className="h-full space-y-4 bg-slate-50/50 p-3 sm:space-y-6 sm:p-6 lg:p-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="min-w-0">
          <h1 className="flex items-center gap-3 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
            <ShoppingCart className="h-6 w-6 shrink-0 text-blue-600 sm:h-8 sm:w-8" />
            <span className="min-w-0 truncate">销售订单 (Sales Orders)</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500 sm:text-base">
            查询客户订单、跟进交付进度，或新建销售订单。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/sales/requirements"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-5 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 sm:w-auto"
          >
            <ClipboardList className="h-4 w-4" />
            客户需求
          </Link>
          <button
            onClick={() => {
              setSelectedOrderId(null);
              setDrawerOpen(true);
            }}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-200 transition hover:bg-slate-800 sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            新建订单 (Create SO)
          </button>
        </div>
      </div>

      <div className="overflow-x-auto border-b border-slate-200">
        <div className="flex min-w-max gap-5 text-sm font-medium sm:gap-6">
          {STATUS_OPTIONS.map((item) => {
            const active = statusFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                className={
                  active
                    ? 'shrink-0 border-b-2 border-blue-600 pb-3 text-blue-700'
                    : 'shrink-0 border-b-2 border-transparent pb-3 text-slate-500 hover:text-slate-800'
                }
                onClick={() => changeStatus(item.key)}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200/60 bg-white shadow-sm sm:rounded-2xl">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/40 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setRefreshKey((value) => value + 1);
                }
              }}
              placeholder="搜索单号、客户..."
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-4 text-sm outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <button
            className="flex w-full items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-800 sm:w-auto sm:py-1.5"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            <Filter className="h-4 w-4" /> 刷新
          </button>
        </div>

        {error ? (
          <div
            role="alert"
            className="flex flex-col gap-3 border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setRefreshKey((value) => value + 1)}
              className="self-start rounded-md border border-red-200 bg-white px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100 sm:self-auto"
            >
              重试
            </button>
          </div>
        ) : null}

        <div className="hidden min-w-full md:block">
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
          ) : orders.length === 0 && !error ? (
            <div className="px-6 py-12 text-sm text-slate-500">
              暂无订单数据，可点击右上角新建订单。
            </div>
          ) : !error ? (
            orders.map((order) => (
              <div
                key={order.id}
                onDoubleClick={() => {
                  setSelectedOrderId(order.id);
                  setDrawerOpen(true);
                }}
                className="grid grid-cols-5 px-6 py-4 border-b last:border-b-0 border-slate-100 hover:bg-slate-50/80 transition cursor-pointer select-none items-center group"
              >
                <div className="font-bold text-blue-700 group-hover:text-blue-800">
                  <button
                    type="button"
                    aria-label={`打开订单 ${order.orderNo}`}
                    onClick={() => {
                      setSelectedOrderId(order.id);
                      setDrawerOpen(true);
                    }}
                    className="rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    {order.orderNo}
                  </button>
                </div>
                <div className="text-slate-900 font-medium">
                  {order.partner?.name || '未命名客户'}
                </div>
                <div className="text-slate-500 text-sm font-mono">
                  {formatDate(order.expectedDate)}
                </div>
                <div className="text-slate-900 font-mono font-semibold">
                  {formatCurrency(order.totalAmount)}
                </div>
                <div>
                  <span className={`inline-block px-2.5 py-1 text-[11px] font-bold rounded-md tracking-wide ${statusClass(order.status)}`}>
                    {order.status}
                  </span>
                </div>
              </div>
            ))
          ) : null}
        </div>

        <div className="space-y-3 p-3 md:hidden">
          {loading ? (
            <div className="flex items-center gap-2 rounded-lg border border-slate-100 px-4 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> 正在加载订单...
            </div>
          ) : orders.length === 0 && !error ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-500">
              暂无订单数据，可点击上方按钮新建订单。
            </div>
          ) : !error ? (
            orders.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => {
                  setSelectedOrderId(order.id);
                  setDrawerOpen(true);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-slate-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-bold text-blue-700">
                      {order.orderNo}
                    </p>
                    <p className="mt-1 truncate text-sm font-medium text-slate-900">
                      {order.partner?.name || '未命名客户'}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-bold tracking-wide ${statusClass(order.status)}`}
                  >
                    {order.status}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs">
                  <div>
                    <p className="text-slate-500">交期</p>
                    <p className="mt-1 font-mono text-slate-800">
                      {formatDate(order.expectedDate)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-500">金额</p>
                    <p className="mt-1 truncate font-mono font-semibold text-slate-900">
                      {formatCurrency(order.totalAmount)}
                    </p>
                  </div>
                </div>
              </button>
            ))
          ) : null}
        </div>

        {!loading && !error ? (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            onPageChange={(nextPage) =>
              setPagination((previous) => ({ ...previous, page: nextPage }))
            }
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-1 px-2 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <span>
          点击订单号或双击桌面订单行打开抽屉；可用 Tab 定位订单号后按 Enter。手机端点击订单卡片打开。
        </span>
        <span>{loading ? '正在加载本页订单...' : `本页 ${orders.length} 项记录`}</span>
      </div>

      <SaleOrderDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        orderId={selectedOrderId}
        onSaved={() => {
          setRefreshKey((value) => value + 1);
        }}
      />
    </div>
  );
}

function formatDate(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : '-';
}
