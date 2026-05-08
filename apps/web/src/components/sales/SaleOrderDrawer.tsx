'use client';

import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { DataGrid } from '@/components/ui/data-grid/DataGrid';
import api from '@/lib/api';
import { CheckCircle2, Save, Activity, Layers, Info, Loader2, Truck } from 'lucide-react';
import { ShipmentsTable } from './ShipmentsTable';
import { ShipmentTimeline } from './ShipmentTimeline';
import type { ColumnDef } from '@tanstack/react-table';
import toast from 'react-hot-toast';

interface OrderLine {
  id: string; // DataGrid 行唯一键
  orderItemId?: string;
  productId: string;
  productCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

interface PartnerOption {
  id: string;
  name: string;
  code?: string | null;
}

interface ProductOption {
  id: string;
  sku: string;
  name: string;
}

interface TimelineEvent {
  id: string;
  action: string;
  createdAt: string;
  user?: {
    name?: string;
  };
}

export interface StockTransaction {
  id: string;
  type: string;
  materialId: string;
  material?: { id: string; sku: string; name: string; unit: string };
  quantity: number;
  batchNo?: string | null;
  referenceNo?: string | null;
  note?: string | null;
  sourceLocation?: { id: string; name: string; code?: string | null; warehouse?: { id: string; name: string } } | null;
  destLocation?: { id: string; name: string; code?: string | null; warehouse?: { id: string; name: string } } | null;
  createdAt: string;
}

interface SaleOrderFormProps {
  open: boolean;
  onClose: () => void;
  orderId?: string | null;
  onSaved?: () => void;
}

type TabType = 'LINES' | 'INFO' | 'SHIPMENTS' | 'CHATTER';

export function SaleOrderDrawer({ open, onClose, orderId, onSaved }: SaleOrderFormProps) {
  const [activeTab, setActiveTab] = useState<TabType>('LINES');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  const [status, setStatus] = useState('DRAFT');
  const [orderNo, setOrderNo] = useState<string>('SO-NEW-DRAFT');

  const [partnerId, setPartnerId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [stockTransactions, setStockTransactions] = useState<StockTransaction[]>([]);

  const [lines, setLines] = useState<OrderLine[]>([]);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);

  const formatMoney = (val: number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(val);
  const productMap = useMemo(() => {
    return new Map(products.map((p) => [p.id, p]));
  }, [products]);
  const partnerName = useMemo(() => partners.find((p) => p.id === partnerId)?.name || '', [partners, partnerId]);
  const isEditable = status === 'DRAFT' || status === 'SUBMITTED';
  const validLines = useMemo(
    () =>
      lines.filter(
        (line) =>
          Boolean(line.productId) &&
          Number.isFinite(line.quantity) &&
          Number.isFinite(line.unitPrice) &&
          line.quantity > 0 &&
          line.unitPrice >= 0,
      ),
    [lines],
  );
  const invalidConfiguredLines = useMemo(
    () =>
      lines.filter(
        (line) =>
          Boolean(line.productId) &&
          (!Number.isFinite(line.quantity) || !Number.isFinite(line.unitPrice) || line.quantity <= 0 || line.unitPrice < 0),
      ),
    [lines],
  );
  const canSaveDraft =
    isEditable &&
    !saving &&
    Boolean(partnerId) &&
    Boolean(orderDate) &&
    validLines.length > 0 &&
    invalidConfiguredLines.length === 0;

  const loadBaseOptions = async () => {
    const [partnerRes, productRes] = await Promise.all([
      api.get<{ data: PartnerOption[] }>('/v1/resource/partner?page=1&limit=200&orderBy={"createdAt":"desc"}'),
      api.get<{ data: ProductOption[] }>('/v1/resource/product?page=1&limit=200&orderBy={"createdAt":"desc"}'),
    ]);

    const partnerData = partnerRes.data?.data ?? [];
    const productData = productRes.data?.data ?? [];

    setPartners(partnerData);
    setProducts(productData);

    return { partnerData, productData };
  };

  const resetNewForm = () => {
    setStatus('DRAFT');
    setOrderNo('SO-NEW-DRAFT');
    setPartnerId('');
    setOrderDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    setTimeline([]);
    setStockTransactions([]);
    setSelectedLineIds([]);
    setLines([
      {
        id: `L-${Date.now()}`,
        productId: '',
        productCode: '',
        description: '',
        quantity: 1,
        unitPrice: 0,
      },
    ]);
  };

  const loadOrderDetail = async (id: string, productData?: ProductOption[]) => {
    const productLookup = new Map((productData ?? products).map((item) => [item.id, item]));
    const detail = await api.get<any>(`/orders/${id}`);
    const order = detail.data;
    setOrderNo(order.orderNo || id);
    setStatus(order.status || 'DRAFT');
    setPartnerId(order.partnerId || '');
    setOrderDate(order.expectedDate ? new Date(order.expectedDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
    setNotes(order.notes || '');
    setSelectedLineIds([]);
    setLines(
      (order.items || []).map((item: any) => {
        const product = productLookup.get(item.productId);
        return {
          id: item.id,
          orderItemId: item.id,
          productId: item.productId,
          productCode: product?.sku || '',
          description: product?.name || item.productId,
          quantity: Number(item.quantity || 0),
          unitPrice: Number(item.unitPrice || 0),
        };
      }),
    );

    const timelineRes = await api.get<{ events: TimelineEvent[] }>(`/orders/${id}/timeline`);
    setTimeline(timelineRes.data?.events ?? []);

    try {
      const stockRes = await api.get<{ transactions: StockTransaction[] }>(`/orders/${id}/stock-transactions`);
      setStockTransactions(stockRes.data?.transactions ?? []);
    } catch {
      setStockTransactions([]);
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;
    const run = async () => {
      setLoading(true);
      try {
        const base = await loadBaseOptions();
        if (!active) return;
        if (orderId) {
          await loadOrderDetail(orderId, base.productData);
        } else {
          resetNewForm();
        }
      } catch (error: any) {
        toast.error(error?.response?.data?.message || '加载销售订单失败');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    run();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  const handleCellUpdate = (rowId: string, columnId: string, value: string) => {
    if (!isEditable) return;

    setLines((prev) => prev.map((line) => {
      if (line.id !== rowId) return line;
      const updated = { ...line };

      if (columnId === 'quantity') updated.quantity = Math.max(1, Number(value) || 1);
      if (columnId === 'unitPrice') updated.unitPrice = Math.max(0, Number(value) || 0);
      if (columnId === 'productId') {
        const product = productMap.get(value);
        updated.productId = value;
        updated.productCode = product?.sku || '';
        updated.description = product?.name || '';
      }

      return updated;
    }));
  };

  const columns = useMemo<ColumnDef<OrderLine>[]>(() => [
    {
      accessorKey: 'productId',
      header: '产品',
      cell: (info) => {
        const value = String(info.getValue() ?? '');
        const product = productMap.get(value);
        if (!value) {
          return <span className="text-slate-400">请选择产品</span>;
        }
        return <span className="font-medium text-slate-800">{product ? `${product.sku} · ${product.name}` : value}</span>;
      },
      meta: {
        options: products.map((product) => ({
          label: `${product.sku} · ${product.name}`,
          value: product.id,
        })),
      },
    },
    { accessorKey: 'description', header: '描述', cell: (info) => <span className="text-slate-600">{String(info.getValue() ?? '')}</span> },
    { 
      accessorKey: 'quantity', 
      header: '数量',
      cell: (info) => <span className="font-mono text-blue-700 font-semibold">{info.getValue() as number}</span>,
    },
    { 
      accessorKey: 'unitPrice', 
      header: '单价',
      cell: (info) => <span className="font-mono text-gray-700">{formatMoney(info.getValue() as number)}</span>,
    },
    { 
      id: 'subtotal',
      header: '小计',
      cell: (info) => {
        const row = info.row.original;
        const sub = row.quantity * row.unitPrice;
        return <span className="font-mono text-gray-900 font-semibold">{formatMoney(sub)}</span>;
      },
    },
  ], [products, productMap]);

  const { subtotal, tax, total } = useMemo(() => {
    const sub = lines.reduce((acc, row) => acc + (row.quantity * row.unitPrice), 0);
    const taxAmt = sub * 0.13;
    return { subtotal: sub, tax: taxAmt, total: sub + taxAmt };
  }, [lines]);

  const handleAddLine = () => {
    if (!isEditable) return;
    setLines([...lines, { 
      id: `L-${Date.now()}`,
      productId: '',
      productCode: '',
      description: '',
      quantity: 1,
      unitPrice: 0,
    }]);
  };

  const handleDeleteSelectedLines = () => {
    if (!isEditable) return;
    if (!selectedLineIds.length) {
      toast.error('请先勾选要删除的明细行');
      return;
    }

    setLines((prev) => prev.filter((line) => !selectedLineIds.includes(line.id)));
    setSelectedLineIds([]);
  };

  const buildOrderPayload = () => {
    if (!partnerId) {
      throw new Error('请选择客户');
    }
    if (!orderDate) {
      throw new Error('请选择交货日期');
    }
    if (!lines.length || !lines.some((line) => line.productId)) {
      throw new Error('请至少添加一条有效商品行');
    }
    if (invalidConfiguredLines.length > 0) {
      throw new Error(`存在 ${invalidConfiguredLines.length} 条明细数量/价格不合法`);
    }

    const items = validLines
      .map((line) => ({
        productId: line.productId,
        quantity: Math.max(1, Number(line.quantity || 1)),
        unitPrice: Math.max(0, Number(line.unitPrice || 0)),
      }));

    if (!items.length) {
      throw new Error('没有可保存的有效明细行');
    }

    return {
      partnerId,
      expectedDate: orderDate || null,
      notes: notes || null,
      items,
    };
  };

  const saveOrder = async () => {
    if (!isEditable) {
      toast.error('当前状态不允许编辑保存');
      return;
    }

    try {
      setSaving(true);
      const payload = buildOrderPayload();

      if (total <= 0) {
        throw new Error('订单总金额必须大于 0');
      }

      if (!orderId) {
        const created = await api.post('/orders', payload);
        toast.success('订单创建成功');
        setOrderNo(created.data?.orderNo || '已创建');
        onSaved?.();
        onClose();
        return;
      }

      await api.put(`/v1/resource/order/${orderId}`, {
        partnerId: payload.partnerId,
        expectedDate: payload.expectedDate,
        notes: payload.notes,
        totalAmount: total,
      });

      const detail = await api.get<any>(`/orders/${orderId}`);
      const existingItems = detail.data?.items ?? [];

      const existingItemIds = new Set<string>(existingItems.map((item: any) => String(item.id)));
      const keepItemIds = new Set<string>(
        lines.filter((line) => line.orderItemId).map((line) => String(line.orderItemId)),
      );

      const toDelete = Array.from(existingItemIds).filter((id) => !keepItemIds.has(id));
      await Promise.all(toDelete.map((id) => api.delete(`/v1/resource/orderItem/${id}`)));

      const upserts = lines
        .filter((line) => line.productId)
        .map((line) => {
          const rowPayload = {
            orderId,
            productId: line.productId,
            quantity: Math.max(1, Number(line.quantity || 1)),
            unitPrice: Math.max(0, Number(line.unitPrice || 0)),
            totalPrice: Math.max(1, Number(line.quantity || 1)) * Math.max(0, Number(line.unitPrice || 0)),
          };

          if (line.orderItemId) {
            return api.put(`/v1/resource/orderItem/${line.orderItemId}`, rowPayload);
          }
          return api.post('/v1/resource/orderItem', rowPayload);
        });

      await Promise.all(upserts);

      toast.success('订单保存成功');
      await loadOrderDetail(orderId);
      onSaved?.();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const runWorkflowTransition = async () => {
    if (!orderId) {
      toast.error('请先保存订单，再执行流转');
      return;
    }

    const actionMap: Record<string, string> = {
      DRAFT: 'submit',
      PENDING: 'start_production',
      IN_PRODUCTION: 'ship',
      SHIPPED: 'complete',
    };
    const action = actionMap[status];
    if (!action) {
      toast.error('当前状态无可执行流转动作');
      return;
    }

    try {
      setTransitioning(true);
      await api.post(`/v1/workflow/order/${orderId}/transition`, { action });
      toast.success('状态流转成功');
      await loadOrderDetail(orderId);
      onSaved?.();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || '状态流转失败');
    } finally {
      setTransitioning(false);
    }
  };

  const nextActionLabel: Record<string, string> = {
    DRAFT: '提交订单',
    PENDING: '开始生产',
    IN_PRODUCTION: '发货',
    SHIPPED: '完成订单',
  };

  const renderActions = () => (
    <div className="flex items-center gap-3">
      {(status === 'DRAFT' || status === 'SUBMITTED') ? (
        <>
          <button 
            type="button" 
            disabled={!canSaveDraft}
            onClick={saveOrder}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium text-sm hover:bg-gray-200 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Save className="h-4 w-4" />
            {saving ? '保存中...' : '保存草稿'}
          </button>
          <button 
            type="button" 
            disabled={transitioning || !orderId}
            onClick={runWorkflowTransition}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 transition shadow-sm shadow-blue-200"
          >
            <CheckCircle2 className="h-4 w-4" />
            {transitioning ? '流转中...' : (nextActionLabel[status] || '执行流转')}
          </button>
        </>
      ) : nextActionLabel[status] ? (
        <button
          type="button"
          disabled={transitioning}
          onClick={runWorkflowTransition}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 transition shadow-sm shadow-blue-200 disabled:opacity-70"
        >
          <CheckCircle2 className="h-4 w-4" />
          {transitioning ? '流转中...' : nextActionLabel[status]}
        </button>
      ) : (
        <div className="flex items-center gap-2">
           <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span className="text-sm font-semibold text-green-700">当前状态：{status}</span>
        </div>
      )}
    </div>
  );

  return (
    <Sheet 
      open={open} 
      onClose={onClose} 
      title={orderId ? `销售订单 ${orderNo}` : '新建销售订单 (New Sale Order)'} 
      widthClassName="w-[min(1200px,95vw)]"
    >
      {loading ? (
        <div className="h-[60vh] flex items-center justify-center text-slate-500 text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> 正在加载订单详情...
        </div>
      ) : (
      <div className="flex flex-col h-full bg-slate-50/50 -mx-5 -my-4 p-5">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-2xl bg-white p-5 border border-slate-200/60 shadow-sm">
          <div className="flex flex-col gap-1 w-full max-w-sm">
            <h2 className="text-2xl font-black tracking-tight text-slate-900">
              {orderNo}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold tracking-wide ${
                status === 'DRAFT' || status === 'SUBMITTED' ? 'bg-slate-100 text-slate-600' : 'bg-green-100 text-green-700'
              }`}>
                {status}
              </span>
              <span className="text-sm text-slate-500">客户: {partnerName || '未选择'}</span>
            </div>
          </div>
          {renderActions()}
        </div>

        <div className="flex gap-1 border-b border-slate-200 mb-5">
          {[
            { id: 'LINES', label: '商品明细', icon: Layers },
            { id: 'INFO', label: '开票与物流', icon: Info },
            { id: 'SHIPMENTS', label: '物流发货', icon: Truck },
            { id: 'CHATTER', label: '操作台账', icon: Activity }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id 
                  ? 'border-blue-600 text-blue-700' 
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto">
          {activeTab === 'LINES' && (
             <div className="flex flex-col h-full gap-4">
                {isEditable && (
                  <div className="flex justify-between items-center bg-blue-50/50 border border-blue-100 p-3 rounded-xl">
                    <p className="text-xs text-blue-800 flex items-center gap-2">
                       <span className="text-lg">i</span> 双击单元格可编辑，产品列支持下拉选择真实物料。
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleDeleteSelectedLines}
                        className="text-xs font-semibold text-rose-600 hover:text-rose-700 px-3 py-1 rounded bg-rose-100/60 hover:bg-rose-100 transition"
                      >
                        删除选中 ({selectedLineIds.length})
                      </button>
                      <button 
                        onClick={handleAddLine}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 px-3 py-1 rounded bg-blue-100/50 hover:bg-blue-100 transition"
                      >
                        + 新增空行
                      </button>
                    </div>
                  </div>
                )}
                
                <div className="bg-white rounded-xl border border-slate-200/60 shadow-sm p-2 flex-1">
                  <DataGrid 
                    columns={columns} 
                    data={lines} 
                    onCellUpdate={handleCellUpdate}
                    enableRowSelection
                    onSelectionChange={setSelectedLineIds}
                    height={400}
                  />
                </div>

                {isEditable ? (
                  <div className="text-xs text-slate-500 px-1">
                    有效明细 {validLines.length} 条，待修复明细 {invalidConfiguredLines.length} 条。
                  </div>
                ) : null}

                <div className="flex justify-end mt-2">
                  <div className="w-80 bg-white rounded-xl border border-slate-200/60 shadow-sm p-5 space-y-3">
                     <div className="flex justify-between items-center text-sm text-slate-600">
                        <span>小计 (Subtotal)</span>
                        <span className="font-mono">{formatMoney(subtotal)}</span>
                     </div>
                     <div className="flex justify-between items-center text-sm text-slate-600">
                        <span>税额 (Tax 13%)</span>
                        <span className="font-mono">{formatMoney(tax)}</span>
                     </div>
                     <div className="w-full h-px bg-slate-100 my-2" />
                     <div className="flex justify-between items-center text-lg font-black text-slate-900">
                        <span>总计 (Total)</span>
                        <span className="font-mono text-blue-700">{formatMoney(total)}</span>
                     </div>
                  </div>
                </div>
             </div>
          )}

          {activeTab === 'INFO' && (
            <div className="grid grid-cols-2 gap-6 bg-white p-6 rounded-2xl border border-slate-200/60">
               <div className="space-y-4 border-r border-slate-100 pr-6">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2">客户与发票</h3>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">选中客户</label>
                    <select
                      value={partnerId}
                      onChange={(e) => setPartnerId(e.target.value)}
                      disabled={!isEditable}
                      className="w-full text-sm p-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500"
                    >
                      <option value="">请选择客户</option>
                      {partners.map((partner) => (
                        <option key={partner.id} value={partner.id}>
                          {(partner.code ? `${partner.code} · ` : '') + partner.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">付款条款 (Payment Terms)</label>
                    <select 
                      disabled
                      className="w-full text-sm p-2 rounded-lg border border-slate-200 outline-none disabled:bg-slate-50 disabled:text-slate-500"
                    >
                       <option>月结 30天 (Net 30)</option>
                       <option>见票即付 (Due on Receipt)</option>
                    </select>
                  </div>
               </div>
               <div className="space-y-4 pl-2">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2">排程与其他</h3>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">交货日期 (Expected Date)</label>
                    <input 
                      type="date" 
                      value={orderDate} 
                      onChange={e => setOrderDate(e.target.value)}
                      disabled={!isEditable}
                      className="w-full text-sm p-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">内部备注 (Internal Notes)</label>
                    <textarea 
                      rows={3}
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      disabled={!isEditable}
                      className="w-full text-sm p-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500"
                      placeholder="只显示给内部员工的备注..."
                    />
                  </div>
               </div>
            </div>
          )}

          
          {activeTab === 'SHIPMENTS' && (
            <div className="space-y-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200/60 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">关联发货单 (Stock Pickings)</h3>
                  <span className="text-xs text-slate-500">共 {stockTransactions.length} 条记录</span>
                </div>
                {stockTransactions.length === 0 ? (
                  <div className="text-center py-12">
                    <Truck className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-sm text-slate-500">暂无关联的发货或库存过账记录</p>
                    <p className="text-xs text-slate-400 mt-1">当订单执行发货操作后，相关记录将在此展示</p>
                  </div>
                ) : (
                  <ShipmentsTable transactions={stockTransactions} />
                )}
              </div>
              <ShipmentTimeline transactions={stockTransactions} />
            </div>
          )}
          {activeTab === 'CHATTER' && (
             <div className="bg-white p-6 rounded-2xl border border-slate-200/60 max-w-3xl">
                {timeline.length === 0 ? (
                  <div className="text-sm text-slate-500">暂无台账记录。</div>
                ) : (
                  <div className="border-l-2 border-slate-100 ml-3 space-y-6">
                    {timeline.map((item) => (
                      <div key={item.id} className="relative pl-6">
                        <div className="absolute left-[-5px] top-1 h-2 w-2 rounded-full bg-blue-500 ring-4 ring-white" />
                        <p className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleString()}</p>
                        <p className="text-sm font-medium text-slate-800 mt-1">
                          {(item.user?.name || '系统')} 执行了 {item.action}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
             </div>
          )}
        </div>
      </div>
      )}
    </Sheet>
  );
}
