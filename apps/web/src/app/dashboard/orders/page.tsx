'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, PackageCheck, Search } from 'lucide-react';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/format';

type FulfillmentStatus =
  | 'READY'
  | 'COVERED_BY_PRODUCTION'
  | 'SHORTAGE'
  | 'UNMAPPED';

type OrderRow = {
  id: string;
  orderNo: string;
  status: string;
  totalAmount: number;
  expectedDate?: string | null;
  createdAt?: string;
  partner?: { name?: string };
  salesPerson?: { name?: string };
  fulfillmentSummary?: {
    overallStatus: FulfillmentStatus;
    lineCount: number;
    shortageLineCount: number;
    unmappedLineCount: number;
    totalShortageQty: number;
  };
};

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'DRAFT', label: '草稿' },
  { value: 'PENDING', label: '待处理' },
  { value: 'IN_PRODUCTION', label: '生产中' },
  { value: 'SHIPPED', label: '已发货' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'CANCELLED', label: '已取消' },
];

const orderStatusMap: Record<string, { label: string; className: string }> = {
  DRAFT: { label: '草稿', className: 'bg-slate-100 text-slate-700' },
  PENDING: { label: '待处理', className: 'bg-amber-100 text-amber-800' },
  IN_PRODUCTION: { label: '生产中', className: 'bg-blue-100 text-blue-800' },
  SHIPPED: { label: '已发货', className: 'bg-indigo-100 text-indigo-800' },
  COMPLETED: { label: '已完成', className: 'bg-emerald-100 text-emerald-800' },
  CANCELLED: { label: '已取消', className: 'bg-red-100 text-red-800' },
};

const fulfillmentStatusMap: Record<
  FulfillmentStatus,
  { label: string; className: string; tone: string }
> = {
  READY: {
    label: '现货可交',
    className: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    tone: 'text-emerald-700',
  },
  COVERED_BY_PRODUCTION: {
    label: '生产覆盖',
    className: 'bg-blue-50 text-blue-700 ring-blue-100',
    tone: 'text-blue-700',
  },
  SHORTAGE: {
    label: '存在缺口',
    className: 'bg-red-50 text-red-700 ring-red-100',
    tone: 'text-red-700',
  },
  UNMAPPED: {
    label: '缺成品映射',
    className: 'bg-amber-50 text-amber-700 ring-amber-100',
    tone: 'text-amber-700',
  },
};

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/orders', {
        params: {
          page: 1,
          limit: 50,
          search: search.trim() || undefined,
          status: status || undefined,
        },
      });
      setOrders((response.data?.data as OrderRow[]) ?? []);
    } catch {
      setError('订单列表加载失败');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const summary = useMemo(() => {
    return {
      total: orders.length,
      shortage: orders.filter(
        (order) => order.fulfillmentSummary?.overallStatus === 'SHORTAGE',
      ).length,
      unmapped: orders.filter(
        (order) => order.fulfillmentSummary?.overallStatus === 'UNMAPPED',
      ).length,
      covered: orders.filter(
        (order) =>
          order.fulfillmentSummary?.overallStatus === 'COVERED_BY_PRODUCTION',
      ).length,
    };
  }, [orders]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            销售订单
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            从订单列表直接识别现货、生产覆盖、缺口和成品映射风险。
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/dashboard/sales')}
          className="inline-flex w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 sm:w-auto"
        >
          新建销售订单
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard
          label="订单数"
          value={summary.total}
          tone="text-slate-900"
        />
        <SummaryCard
          label="存在缺口"
          value={summary.shortage}
          tone="text-red-700"
        />
        <SummaryCard
          label="缺成品映射"
          value={summary.unmapped}
          tone="text-amber-700"
        />
        <SummaryCard
          label="生产覆盖"
          value={summary.covered}
          tone="text-blue-700"
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_220px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索订单号或客户"
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
            />
          </label>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
          </div>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {orders.map((order) => {
                const orderStatus = orderStatusMap[order.status] ?? {
                  label: order.status,
                  className: 'bg-slate-100 text-slate-700',
                };
                const fulfillment =
                  order.fulfillmentSummary?.overallStatus ?? 'UNMAPPED';
                const fulfillmentStatus = fulfillmentStatusMap[fulfillment];
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => router.push(`/dashboard/orders/${order.id}`)}
                    className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-slate-300"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-semibold text-slate-900">
                          {order.orderNo}
                        </p>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {order.partner?.name || '-'}
                        </p>
                      </div>
                      <OrderStatusBadge status={orderStatus} />
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <FulfillmentBadge status={fulfillment} />
                      <div className="text-right">
                        <p className="text-xs text-slate-500">缺口</p>
                        <p
                          className={`font-semibold ${fulfillmentStatus.tone}`}
                        >
                          {order.fulfillmentSummary?.totalShortageQty ?? 0}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs">
                      <div>
                        <p className="text-slate-500">交付日期</p>
                        <p className="mt-1 font-medium text-slate-800">
                          {formatDate(order.expectedDate)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-slate-500">金额</p>
                        <p className="mt-1 truncate font-semibold text-slate-900">
                          {formatCurrency(order.totalAmount)}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="rounded-l-lg px-4 py-3">订单</th>
                  <th className="px-4 py-3">客户</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">交付风险</th>
                  <th className="px-4 py-3 text-right">缺口</th>
                  <th className="px-4 py-3">交付日期</th>
                  <th className="rounded-r-lg px-4 py-3 text-right">金额</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const orderStatus = orderStatusMap[order.status] ?? {
                    label: order.status,
                    className: 'bg-slate-100 text-slate-700',
                  };
                  const fulfillment =
                    order.fulfillmentSummary?.overallStatus ?? 'UNMAPPED';
                  const fulfillmentStatus = fulfillmentStatusMap[fulfillment];
                  return (
                    <tr
                      key={order.id}
                      onClick={() => router.push(`/dashboard/orders/${order.id}`)}
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                        {order.orderNo}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {order.partner?.name || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <OrderStatusBadge status={orderStatus} />
                      </td>
                      <td className="px-4 py-3">
                        <FulfillmentBadge status={fulfillment} />
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-semibold ${fulfillmentStatus.tone}`}
                      >
                        {order.fulfillmentSummary?.totalShortageQty ?? 0}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(order.expectedDate)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                        {formatCurrency(order.totalAmount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
            {orders.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                暂无订单
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function OrderStatusBadge({
  status,
}: {
  status: { label: string; className: string };
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
    >
      {status.label}
    </span>
  );
}

function FulfillmentBadge({ status }: { status: FulfillmentStatus }) {
  const fulfillmentStatus = fulfillmentStatusMap[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${fulfillmentStatus.className}`}
    >
      {status === 'SHORTAGE' || status === 'UNMAPPED' ? (
        <AlertTriangle className="h-3 w-3" />
      ) : (
        <PackageCheck className="h-3 w-3" />
      )}
      {fulfillmentStatus.label}
    </span>
  );
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : '-';
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
