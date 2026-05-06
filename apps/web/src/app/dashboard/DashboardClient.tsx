'use client';

import React, { useEffect, useState } from 'react';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { Activity, Box, CreditCard, ShoppingBag, Sparkles, Truck } from 'lucide-react';
import { Sheet } from '../../components/ui/Sheet';
import { Chat2DashPanel } from '../../components/ai/Chat2DashPanel';

interface RecentOrder {
  id: string;
  orderNo: string;
  status: string;
  partner?: {
    name?: string;
  } | null;
}

export default function DashboardClient() {
  const { currentCompanyId, token } = useAuthStore();
  const [chat2DashOpen, setChat2DashOpen] = useState(false);
  const [stats, setStats] = useState({
    totalOrders: 0,
    activeOrders: 0,
    totalStockValue: 0,
    lowStockItems: 0
  });

  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);

  useEffect(() => {
    const fetchStats = async () => {
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
      }
    };
    if (currentCompanyId && token) {
      fetchStats();
    }
  }, [currentCompanyId, token]);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={() => setChat2DashOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-medium text-cyan-700 transition hover:bg-cyan-100"
        >
          <Sparkles className="h-4 w-4" />
          打开 Chat2Dash
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Stat Cards */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex items-center">
          <div className="p-3 rounded-lg bg-blue-50 text-blue-600 mr-4">
            <ShoppingBag className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">总订单数</p>
            <p className="text-2xl font-bold text-gray-900">{stats.totalOrders}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex items-center">
          <div className="p-3 rounded-lg bg-indigo-50 text-indigo-600 mr-4">
            <Activity className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">生产品产中</p>
            <p className="text-2xl font-bold text-gray-900">{stats.activeOrders}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex items-center">
          <div className="p-3 rounded-lg bg-green-50 text-green-600 mr-4">
            <CreditCard className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">库存总价值 (元)</p>
            <p className="text-2xl font-bold text-gray-900">¥{(stats.totalStockValue).toLocaleString()}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex items-center">
          <div className="p-3 rounded-lg bg-red-50 text-red-600 mr-4">
            <Box className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">低库存预警</p>
            <p className="text-2xl font-bold text-gray-900">{stats.lowStockItems}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
             <Truck className="h-5 w-5 mr-2 text-gray-500" /> 近期订单动态
          </h3>
          <div className="space-y-4">
             {recentOrders.length > 0 ? recentOrders.map(order => (
               <div key={order.id} className="p-4 rounded-lg bg-gray-50 border border-gray-100 flex justify-between items-center">
                  <div>
                     <p className="font-medium text-gray-900">{order.orderNo}</p>
                     <p className="text-sm text-gray-500">客户: {order.partner?.name || '未知'}</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                     order.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' :
                     order.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                     'bg-blue-100 text-blue-800'
                  }`}>
                    {order.status === 'PENDING' ? '待处理' : 
                     order.status === 'PROCESSING' ? '生产中' : 
                     order.status === 'COMPLETED' ? '已完成' : order.status}
                  </span>
               </div>
             )) : (
               <div className="text-sm text-gray-500 text-center py-4">暂无近期订单</div>
             )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">系统公告</h3>
          <div className="prose text-gray-600 text-sm">
             <p>欢迎使用现代企业EIP系统。您的账号已绑定多公司管理权限，请在左侧侧边栏切换需要管理的企业数据域。</p>
             <p>系统已升级至最新版本，全面支持基于隔离数据沙箱的库存和订单流转。</p>
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
