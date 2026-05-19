'use client';

import React, { useEffect, useState } from 'react';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { Activity, Box, CreditCard, ShoppingBag, Sparkles, Truck } from 'lucide-react';
import { Badge, Button, EmptyState, Sheet, Skeleton, StatCard } from '../../components/ui';
import { Chat2DashPanel } from '../../components/ai/Chat2DashPanel';
import { useI18n } from '../../lib/i18n';
import { formatCurrency } from '../../lib/format';

export default function DashboardClient() {
  const { currentCompanyId, token } = useAuthStore();
  const { t, locale } = useI18n();
  const [chat2DashOpen, setChat2DashOpen] = useState(false);
  const [stats, setStats] = useState({
    totalOrders: 0,
    activeOrders: 0,
    totalStockValue: 0,
    lowStockItems: 0
  });

  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      setError(null);
      try {
        const [statsResponse, ordersResponse] = await Promise.all([
          api.get('/dashboard/stats'),
          api.get('/orders')
        ]);
        setStats(statsResponse.data);

        // 兼容两种返回格式: 直接数组 或 分页对象 { data, total, ... }
        const ordersPayload = ordersResponse.data;
        const orders = Array.isArray(ordersPayload)
          ? ordersPayload
          : (Array.isArray(ordersPayload?.data) ? ordersPayload.data : []);
        setRecentOrders(orders.slice(0, 5));
      } catch (e) {
        console.error('Fetch stats or orders failed', e);
        setError(e instanceof Error ? e.message : 'Dashboard data loading failed');
      } finally {
        setLoading(false);
      }
    };
    if (currentCompanyId && token) {
      fetchStats();
    }
  }, [currentCompanyId, token]);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button
          variant="secondary"
          onClick={() => setChat2DashOpen(true)}
          icon={<Sparkles className="h-4 w-4" />}
          className="border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100"
        >
          {t('dashboardOpenChat2Dash')}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard icon={ShoppingBag} label={t('dashboardTotalOrders')} value={stats.totalOrders} tone="blue" loading={loading} />
        <StatCard icon={Activity} label={t('dashboardInProduction')} value={stats.activeOrders} tone="indigo" loading={loading} />
        <StatCard icon={CreditCard} label={t('dashboardInventoryValue')} value={formatCurrency(stats.totalStockValue, locale)} tone="green" loading={loading} />
        <StatCard icon={Box} label={t('dashboardLowStock')} value={stats.lowStockItems} tone="red" loading={loading} />
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
             <Truck className="h-5 w-5 mr-2 text-gray-500" /> {t('dashboardRecentOrders')}
          </h3>
          <div className="space-y-4">
             {loading ? (
               <>
                 <Skeleton className="h-20 w-full" />
                 <Skeleton className="h-20 w-full" />
                 <Skeleton className="h-20 w-full" />
               </>
             ) : recentOrders.length > 0 ? recentOrders.map(order => (
               <div key={order.id} className="p-4 rounded-lg bg-gray-50 border border-gray-100 flex justify-between items-center">
                  <div>
                     <p className="font-medium text-gray-900">{order.orderNo}</p>
                     <p className="text-sm text-gray-500">{t('dashboardCustomer')}: {order.partner?.name || t('dashboardUnknown')}</p>
                  </div>
                  <Badge status={order.status}>{formatOrderStatus(order.status, locale)}</Badge>
               </div>
             )) : (
               <EmptyState title={t('dashboardNoRecentOrders')} className="py-8" />
             )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">{t('dashboardAnnouncements')}</h3>
          <div className="prose text-gray-600 text-sm">
             <p>{t('dashboardAnnouncement1')}</p>
             <p>{t('dashboardAnnouncement2')}</p>
          </div>
        </div>
      </div>

      <Sheet
        open={chat2DashOpen}
        title="Smart Dashboard - Chat2Dash"
        onClose={() => setChat2DashOpen(false)}
        widthClassName="w-[min(760px,96vw)]"
      >
        <Chat2DashPanel />
      </Sheet>
    </div>
  );
}

function formatOrderStatus(status: string | undefined, locale: string) {
  const labels: Record<string, Record<string, string>> = {
    'zh-CN': {
      DRAFT: '草稿',
      PENDING: '待处理',
      PENDING_APPROVAL: '待审批',
      SUBMITTED: '已提交',
      PROCESSING: '处理中',
      IN_PRODUCTION: '生产中',
      PARTIAL_SHIPPED: '部分发货',
      SHIPPED: '已发货',
      COMPLETED: '已完成',
    },
    'en-US': {
      DRAFT: 'Draft',
      PENDING: 'Pending',
      PENDING_APPROVAL: 'Pending Approval',
      SUBMITTED: 'Submitted',
      PROCESSING: 'Processing',
      IN_PRODUCTION: 'In Production',
      PARTIAL_SHIPPED: 'Partially Shipped',
      SHIPPED: 'Shipped',
      COMPLETED: 'Completed',
    },
  };

  return labels[locale]?.[String(status ?? '')] ?? status ?? '-';
}
