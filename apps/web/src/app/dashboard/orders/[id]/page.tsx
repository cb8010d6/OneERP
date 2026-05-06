'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '../../../../lib/api';
import { useAuthStore } from '../../../../store/authStore';
import { ArrowLeft, Loader2, FileText, Package } from 'lucide-react';
import toast from 'react-hot-toast';

interface OrderDetail {
  id: string;
  orderNo: string;
  status: string;
  totalAmount: number;
  expectedDate: string | null;
  notes: string | null;
  createdAt: string;
  partner: {
    id: string;
    name: string;
    contact: string;
    phone: string;
  };
  salesPerson: {
    id: string;
    name: string;
  };
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
  workOrders: Array<{
    id: string;
    workOrderNo: string;
    status: string;
    plannedQty: number;
    completedQty: number;
  }>;
  invoices: Array<{
    id: string;
    invoiceNo: string;
    status: string;
    amount: number;
    paidAmount: number;
  }>;
}

interface TimelineEvent {
  id: string;
  action: string;
  createdAt: string;
  user?: {
    name?: string | null;
    email?: string | null;
  } | null;
  details?: unknown;
}

const statusMap: Record<string, { label: string, color: string }> = {
  DRAFT: { label: '草稿', color: 'bg-gray-100 text-gray-800' },
  PENDING: { label: '待处理', color: 'bg-yellow-100 text-yellow-800' },
  IN_PRODUCTION: { label: '生产中', color: 'bg-blue-100 text-blue-800' },
  SHIPPED: { label: '已发货', color: 'bg-indigo-100 text-indigo-800' },
  COMPLETED: { label: '已完成', color: 'bg-green-100 text-green-800' },
  CANCELLED: { label: '已取消', color: 'bg-red-100 text-red-800' },
};

function resolveOrderAction(from: string, to: string) {
  if (from === 'DRAFT' && to === 'PENDING') return 'submit';
  if (from === 'PENDING' && to === 'IN_PRODUCTION') return 'start_production';
  if (from === 'IN_PRODUCTION' && to === 'SHIPPED') return 'ship';
  if (from === 'SHIPPED' && to === 'COMPLETED') return 'complete';
  if (to === 'CANCELLED') return 'cancel';
  return null;
}

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { currentCompanyId } = useAuthStore();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const res = await api.get(`/orders/${params.id}`);
        setOrder(res.data);
      } catch {
        toast.error('加载订单详情失败');
        router.push('/dashboard/orders');
      } finally {
        setLoading(false);
      }
    };

    if (currentCompanyId && params.id) {
      fetchOrder();
    }
  }, [currentCompanyId, params.id, router]);

  useEffect(() => {
    const fetchTimeline = async () => {
      try {
        const res = await api.get(`/orders/${params.id}/timeline`);
        setTimeline(res.data?.events || []);
      } catch {
        setTimeline([]);
      }
    };

    if (currentCompanyId && params.id) {
      fetchTimeline();
    }
  }, [currentCompanyId, params.id]);

  const handleStatusChange = async (newStatus: string) => {
    if (!order) return;
    const action = resolveOrderAction(order.status, newStatus);
    if (!action) {
      toast.error('当前状态不支持此流转');
      return;
    }

    try {
      await api.post(`/v1/workflow/order/${params.id}/transition`, { action });
      toast.success('状态更新成功');
      setOrder(prev => prev ? { ...prev, status: newStatus } : null);
    } catch {
      toast.error('状态更新失败');
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!order) return null;

  const currentStatusInfo = statusMap[order.status] || { label: order.status, color: 'bg-gray-100 text-gray-800' };

  const relatedCards = (
    <>
      {/* Work Orders */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">关联生产工单</h2>
        {order.workOrders.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">暂无工单记录</p>
        ) : (
          <div className="space-y-3">
            {order.workOrders.map(wo => (
              <div key={wo.id} className="p-3 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-medium text-sm text-gray-900">{wo.workOrderNo}</span>
                  <span className="text-xs px-2 py-0.5 bg-gray-100 rounded text-gray-600">{wo.status}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>计划: {wo.plannedQty}</span>
                  <span className={wo.completedQty > 0 ? 'text-green-600 font-medium' : ''}>完成: {wo.completedQty}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {order.status === 'PENDING' && (
          <button
            onClick={() => router.push('/dashboard/production')}
            className="w-full mt-4 py-2 text-sm border border-dashed border-gray-300 text-blue-600 rounded-lg hover:bg-blue-50"
          >
            + 去安排生产
          </button>
        )}
      </div>

      {/* Invoices */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">关联财务发票</h2>
        {order.invoices.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">暂无发票记录</p>
        ) : (
          <div className="space-y-3">
            {order.invoices.map(inv => (
              <div key={inv.id} className="p-3 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-medium text-sm text-gray-900">{inv.invoiceNo}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    inv.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {inv.status}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>总额: ¥{inv.amount.toLocaleString()}</span>
                  <span className="text-blue-600">已收: ¥{inv.paidAmount.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => router.push('/dashboard/finance')}
          className="w-full mt-4 py-2 text-sm border border-dashed border-gray-300 text-blue-600 rounded-lg hover:bg-blue-50"
        >
          + 去开具发票
        </button>
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => router.back()} 
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">订单 {order.orderNo}</h1>
              <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${currentStatusInfo.color}`}>
                {currentStatusInfo.label}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">创建时间: {new Date(order.createdAt).toLocaleString()}</p>
          </div>
        </div>

        {/* Action Buttons based on status */}
        <div className="flex gap-2">
          {order.status === 'DRAFT' && (
            <button
              onClick={() => handleStatusChange('PENDING')}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
            >
              提交订单
            </button>
          )}
          {order.status === 'PENDING' && (
            <button
              onClick={() => handleStatusChange('IN_PRODUCTION')}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
            >
              开始生产
            </button>
          )}
          {order.status === 'IN_PRODUCTION' && (
            <button
              onClick={() => handleStatusChange('SHIPPED')}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
            >
              标记发货
            </button>
          )}
          {order.status === 'SHIPPED' && (
            <button
              onClick={() => handleStatusChange('COMPLETED')}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
            >
              完成订单
            </button>
          )}
          {(order.status !== 'COMPLETED' && order.status !== 'CANCELLED') && (
            <button
              onClick={() => {
                if (confirm('确定要取消此订单吗？')) {
                  handleStatusChange('CANCELLED');
                }
              }}
              className="px-4 py-2 border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50"
            >
              取消订单
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
        {/* Left 70%: core document + related tabs/cards */}
        <div className="lg:col-span-7 space-y-6">
          {/* Order Info */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
              <FileText className="h-5 w-5 mr-2 text-gray-400" /> 基础信息
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">客户名称</p>
                <p className="font-medium mt-1">{order.partner.name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">联系信息</p>
                <p className="font-medium mt-1">
                  {order.partner.contact} {order.partner.phone && `(${order.partner.phone})`}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">销售负责人</p>
                <p className="font-medium mt-1">{order.salesPerson.name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">交付日期</p>
                <p className="font-medium mt-1">
                  {order.expectedDate ? new Date(order.expectedDate).toLocaleDateString() : '未设置'}
                </p>
              </div>
            </div>
            {order.notes && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-sm text-gray-500">备注消息</p>
                <p className="text-sm mt-1">{order.notes}</p>
              </div>
            )}
          </div>

          {/* Items */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
              <Package className="h-5 w-5 mr-2 text-gray-400" /> 订单产品明细
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-500 bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 rounded-l-lg">产品ID</th>
                    <th className="px-4 py-3 text-right">单价 (¥)</th>
                    <th className="px-4 py-3 text-right">数量</th>
                    <th className="px-4 py-3 text-right rounded-r-lg">小计 (¥)</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id} className="border-b last:border-0 border-gray-100">
                      <td className="px-4 py-3 font-medium text-gray-900">{item.productId}</td>
                      <td className="px-4 py-3 text-right">{item.unitPrice.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-blue-600 font-medium">{item.quantity}</td>
                      <td className="px-4 py-3 text-right font-medium">{item.totalPrice.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="px-4 py-4 text-right font-medium text-gray-500">总计金额:</td>
                    <td className="px-4 py-4 text-right font-bold text-lg text-blue-600">
                      ¥{order.totalAmount.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {relatedCards}
          </div>
        </div>

        {/* Right 30%: chatter timeline */}
        <aside className="lg:col-span-3">
          <div className="sticky top-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold tracking-wide text-gray-900 uppercase">Chatter Timeline</h3>
            <p className="mt-1 text-xs text-gray-500">记录状态流转、系统事件与 AI 建议。</p>

            <div className="mt-4 space-y-3 max-h-[70vh] overflow-auto pr-1">
              {timeline.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-500">
                  暂无动态记录。
                </div>
              ) : (
                timeline.map((event) => (
                  <div key={event.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-gray-800">{event.action}</p>
                      <span className="text-[11px] text-gray-500">{new Date(event.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-600">{event.user?.name || event.user?.email || '系统'}</p>
                    {event.details !== undefined && (
                      <pre className="mt-2 overflow-auto rounded bg-white p-2 text-[11px] text-gray-600">{JSON.stringify(event.details, null, 2)}</pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
