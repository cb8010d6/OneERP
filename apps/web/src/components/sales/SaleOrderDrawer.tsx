'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet } from '@/components/ui/Sheet';
import { DataGrid } from '@/components/ui/data-grid/DataGrid';
import api from '@/lib/api';
import { AsyncSelect, type AsyncSelectRecord } from '@/components/core/AsyncSelect';
import { CheckCircle2, Save, Activity, Layers, Info, Loader2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import toast from 'react-hot-toast';
import { isSalesShipmentWorkbenchStatus } from '@/lib/sales-order-transition';

interface OrderLine {
  id: string; // DataGrid 行唯一键
  orderItemId?: string;
  productId: string;
  productCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

interface ProductOption {
  id: string;
  sku?: string;
  name?: string;
  listPrice: number;
}

interface TimelineEvent {
  id: string;
  action: string;
  createdAt: string;
  user?: {
    name?: string;
  };
}

interface SaleOrderFormProps {
  open: boolean;
  onClose: () => void;
  orderId?: string | null;
  onSaved?: () => void;
}

type TabType = 'LINES' | 'INFO' | 'CHATTER';

export function SaleOrderDrawer({ open, onClose, orderId, onSaved }: SaleOrderFormProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('LINES');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  const [status, setStatus] = useState('DRAFT');
  const [orderNo, setOrderNo] = useState<string>('SO-NEW-DRAFT');

  const [partnerId, setPartnerId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  const [products, setProducts] = useState<ProductOption[]>([]);
  const [partnerName, setPartnerName] = useState('');
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);

  const [lines, setLines] = useState<OrderLine[]>([]);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);

  const formatMoney = (val: number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(val);
  const productMap = useMemo(() => {
    return new Map(products.map((p) => [p.id, p]));
  }, [products]);
  const isEditable = status === 'DRAFT' || status === 'SUBMITTED' || status === 'PENDING_APPROVAL';
  const readString = (record: AsyncSelectRecord, key: string) => {
    const value = record[key];
    return value === undefined || value === null ? '' : String(value);
  };
  const readNumber = (record: AsyncSelectRecord, key: string) => {
    const value = Number(record[key] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };
  const mergeProductRecord = (record: AsyncSelectRecord) => {
    const id = readString(record, 'id');
    if (!id) return;

    const product: ProductOption = {
      id,
      sku: readString(record, 'sku'),
      name: readString(record, 'name'),
      listPrice: readNumber(record, 'listPrice'),
    };

    setProducts((prev) => {
      const next = new Map(prev.map((item) => [item.id, item]));
      next.set(product.id, product);
      return Array.from(next.values());
    });
  };
  const resolveLinePrice = (line: OrderLine) => {
    const product = productMap.get(line.productId);
    const productPrice = Number(product?.listPrice ?? 0);
    if (Number.isFinite(productPrice) && productPrice > 0) {
      return productPrice;
    }

    const fallbackPrice = Number(line.unitPrice ?? 0);
    return Number.isFinite(fallbackPrice) ? fallbackPrice : 0;
  };
  const validLines = useMemo(
    () =>
      lines.filter(
        (line) =>
          Boolean(line.productId) &&
          Number.isFinite(line.quantity) &&
          line.quantity > 0,
      ),
    [lines],
  );
  const invalidConfiguredLines = useMemo(
    () =>
      lines.filter(
        (line) =>
          Boolean(line.productId) &&
          (!Number.isFinite(line.quantity) || line.quantity <= 0 || resolveLinePrice(line) <= 0),
      ),
    [lines, productMap],
  );
  const subtotal = useMemo(
    () => lines.reduce((acc, row) => acc + (row.quantity * resolveLinePrice(row)), 0),
    [lines, productMap],
  );
  const tax = useMemo(() => subtotal * 0.13, [subtotal]);
  const total = useMemo(() => subtotal + tax, [subtotal, tax]);
  const canSaveDraft =
    isEditable &&
    !saving &&
    Boolean(partnerId) &&
    Boolean(orderDate) &&
    validLines.length > 0 &&
    invalidConfiguredLines.length === 0 &&
    total > 0;

  const resetNewForm = () => {
    setStatus('DRAFT');
    setOrderNo('SO-NEW-DRAFT');
    setPartnerId('');
    setPartnerName('');
    setOrderDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    setTimeline([]);
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

  const loadOrderProducts = async (productIds: string[]) => {
    const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
    const productEntries = await Promise.all(
      uniqueIds.map(async (productId) => {
        try {
          const res = await api.get<ProductOption>(`/v1/resource/product/${productId}`);
          return res.data;
        } catch {
          return null;
        }
      }),
    );

    const loadedProducts = productEntries.filter((item): item is ProductOption => Boolean(item?.id));
    if (loadedProducts.length) {
      setProducts((prev) => {
        const next = new Map(prev.map((item) => [item.id, item]));
        for (const product of loadedProducts) {
          next.set(product.id, product);
        }
        return Array.from(next.values());
      });
    }

    return new Map(loadedProducts.map((item) => [item.id, item]));
  };

  const loadOrderDetail = async (id: string) => {
    const detail = await api.get<any>(`/orders/${id}`);
    const order = detail.data;
    const orderItems = order.items ?? [];
    const productLookup = await loadOrderProducts(orderItems.map((item: any) => String(item.productId ?? '')));
    setOrderNo(order.orderNo || id);
    setStatus(order.status || 'DRAFT');
    setPartnerId(order.partnerId || '');
    setPartnerName(order.partner?.name || '');
    setOrderDate(order.expectedDate ? new Date(order.expectedDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
    setNotes(order.notes || '');
    setSelectedLineIds([]);
    setLines(
      orderItems.map((item: any) => {
        const product = productLookup.get(item.productId);
        return {
          id: item.id,
          orderItemId: item.id,
          productId: item.productId,
          productCode: product?.sku || '',
          description: product?.name || item.productId,
          quantity: Number(item.quantity || 0),
          unitPrice: Number(product?.listPrice ?? item.unitPrice ?? 0),
        };
      }),
    );

    const timelineRes = await api.get<{ events: TimelineEvent[] }>(`/orders/${id}/timeline`);
    setTimeline(timelineRes.data?.events ?? []);
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;
    const run = async () => {
      setLoading(true);
      try {
        if (!active) return;
        if (orderId) {
          await loadOrderDetail(orderId);
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
  }, [open, orderId]);

  const handleCellUpdate = (rowId: string, columnId: string, value: string) => {
    if (!isEditable) return;

    setLines((prev) => prev.map((line) => {
      if (line.id !== rowId) return line;
      const updated = { ...line };

      if (columnId === 'quantity') updated.quantity = Math.max(1, Number(value) || 1);
      if (columnId === 'unitPrice') return line;
      if (columnId === 'productId') {
        const product = productMap.get(value);
        updated.productId = value;
        updated.productCode = product?.sku || '';
        updated.description = product?.name || '';
        updated.unitPrice = Number(product?.listPrice ?? 0);
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
        reference: { model: 'product', labelField: 'name', valueField: 'id' },
        onReferenceSelect: (
          rowId: string,
          _columnId: string,
          value: string,
          record: AsyncSelectRecord,
        ) => {
          mergeProductRecord(record);
          setLines((prev) =>
            prev.map((line) => {
              if (line.id !== rowId) return line;
              return {
                ...line,
                productId: value,
                productCode: readString(record, 'sku'),
                description: readString(record, 'name'),
                unitPrice: readNumber(record, 'listPrice'),
              };
            }),
          );
        },
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
      header: '参考售价',
      cell: (info) => {
        const row = info.row.original;
        return <span className="font-mono text-gray-700">{formatMoney(resolveLinePrice(row))}</span>;
      },
      meta: { editable: false },
    },
    { 
      id: 'subtotal',
      header: '小计',
      cell: (info) => {
        const row = info.row.original;
        const sub = row.quantity * resolveLinePrice(row);
        return <span className="font-mono text-gray-900 font-semibold">{formatMoney(sub)}</span>;
      },
    },
  ], [productMap]);

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

      if (!orderId) {
        const created = await api.post('/orders', payload);
        toast.success('订单创建成功');
        setOrderNo(created.data?.orderNo || '已创建');
        onSaved?.();
        onClose();
        return;
      }

      await api.put(`/orders/${orderId}`, {
        partnerId: payload.partnerId,
        expectedDate: payload.expectedDate,
        notes: payload.notes,
      });

      await api.put(`/orders/${orderId}/items`, {
        items: payload.items,
      });

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

    if (isSalesShipmentWorkbenchStatus(status)) {
      onClose();
      router.push(`/dashboard/orders/${orderId}`);
      return;
    }

    const actionMap: Record<string, string> = {
      DRAFT: 'submit',
      PENDING_APPROVAL: 'approve',
      PENDING: 'start_production',
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
    PENDING_APPROVAL: '审批通过',
    PENDING: '开始生产',
    IN_PRODUCTION: '打开发货工作台',
    PARTIAL_SHIPPED: '继续发货',
    SHIPPED: '完成订单',
  };

  const toggleMobileLineSelection = (lineId: string) => {
    setSelectedLineIds((prev) =>
      prev.includes(lineId)
        ? prev.filter((id) => id !== lineId)
        : [...prev, lineId],
    );
  };

  const renderMobileLineCards = () => (
    <div className="space-y-3 md:hidden">
      {lines.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          暂无商品明细
        </div>
      ) : (
        lines.map((line) => {
          const product = productMap.get(line.productId);
          const unitPrice = resolveLinePrice(line);
          const lineSubtotal = line.quantity * unitPrice;
          const selected = selectedLineIds.includes(line.id);
          return (
            <div
              key={line.id}
              className={`rounded-xl border bg-white p-3 shadow-sm ${
                selected ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <label className="flex min-w-0 items-start gap-2">
                  {isEditable ? (
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleMobileLineSelection(line.id)}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600"
                    />
                  ) : null}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {product
                        ? `${product.sku || line.productCode} · ${product.name || line.description}`
                        : line.description || line.productCode || '未选择产品'}
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-500">
                      {line.productId || '请选择产品'}
                    </span>
                  </span>
                </label>
                <span className="shrink-0 rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                  x {line.quantity}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs">
                <div>
                  <p className="text-slate-500">参考售价</p>
                  <p className="mt-1 font-mono font-medium text-slate-800">
                    {formatMoney(unitPrice)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500">小计</p>
                  <p className="mt-1 font-mono font-semibold text-slate-900">
                    {formatMoney(lineSubtotal)}
                  </p>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  const renderActions = () => (
    <div className="grid w-full gap-2 sm:flex sm:w-auto sm:items-center sm:gap-3">
      {(status === 'DRAFT' || status === 'SUBMITTED') ? (
        <>
          <button 
            type="button" 
            disabled={!canSaveDraft}
            onClick={saveOrder}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {saving ? '保存中...' : '保存草稿'}
          </button>
          <button 
            type="button" 
            disabled={transitioning || !orderId}
            onClick={runWorkflowTransition}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-blue-200 transition hover:bg-blue-700 disabled:opacity-70"
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
          className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-blue-200 transition hover:bg-blue-700 disabled:opacity-70"
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
      <div className="flex h-full flex-col bg-slate-50/50 -mx-5 -my-4 p-3 sm:p-5">
        <div className="mb-4 flex flex-col gap-4 rounded-xl border border-slate-200/60 bg-white p-4 shadow-sm sm:mb-6 sm:flex-row sm:items-start sm:justify-between sm:rounded-2xl sm:p-5">
          <div className="flex min-w-0 flex-col gap-1 sm:max-w-sm">
            <h2 className="truncate text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
              {orderNo}
            </h2>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold tracking-wide ${
                status === 'DRAFT' || status === 'SUBMITTED' ? 'bg-slate-100 text-slate-600' : 'bg-green-100 text-green-700'
              }`}>
                {status}
              </span>
              <span className="min-w-0 truncate text-sm text-slate-500">客户: {partnerName || '未选择'}</span>
            </div>
          </div>
          {renderActions()}
        </div>

        <div className="mb-4 overflow-x-auto border-b border-slate-200 sm:mb-5">
          <div className="flex min-w-max gap-1">
            {[
              { id: 'LINES', label: '商品明细', icon: Layers },
              { id: 'INFO', label: '开票与物流', icon: Info },
              { id: 'CHATTER', label: '操作台账', icon: Activity }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors sm:px-5 ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {activeTab === 'LINES' && (
             <div className="flex flex-col h-full gap-4">
                {isEditable && (
                  <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="flex items-start gap-2 text-xs text-blue-800">
                       <span className="text-lg leading-none">i</span>
                       <span>桌面端可双击单元格编辑；手机端先查看明细，复杂编辑建议切到桌面。</span>
                    </p>
                    <div className="grid gap-2 sm:flex sm:items-center">
                      <button
                        onClick={handleDeleteSelectedLines}
                        className="rounded bg-rose-100/60 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 hover:text-rose-700"
                      >
                        删除选中 ({selectedLineIds.length})
                      </button>
                      <button 
                        onClick={handleAddLine}
                        className="rounded bg-blue-100/50 px-3 py-1.5 text-xs font-semibold text-blue-600 transition hover:bg-blue-100 hover:text-blue-800"
                      >
                        + 新增空行
                      </button>
                    </div>
                  </div>
                )}

                {renderMobileLineCards()}

                <div className="hidden flex-1 rounded-xl border border-slate-200/60 bg-white p-2 shadow-sm md:block">
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

                <div className="mt-2 flex justify-end">
                  <div className="w-full rounded-xl border border-slate-200/60 bg-white p-4 shadow-sm sm:w-80 sm:p-5 space-y-3">
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
            <div className="grid gap-5 rounded-xl border border-slate-200/60 bg-white p-4 sm:rounded-2xl sm:p-6 md:grid-cols-2 md:gap-6">
               <div className="space-y-4 md:border-r md:border-slate-100 md:pr-6">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2">客户与发票</h3>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">选中客户</label>
                    <AsyncSelect
                      id="partnerId"
                      value={partnerId}
                      reference={{ model: 'partner', labelField: 'name', valueField: 'id' }}
                      onChange={(val) => {
                        setPartnerId(val);
                        if (!val) {
                          setPartnerName('');
                        }
                      }}
                      onSelectRecord={(record) => setPartnerName(readString(record, 'name'))}
                      disabled={!isEditable}
                      placeholder="搜索或选择客户..."
                      className="w-full text-sm p-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500"
                    />
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
               <div className="space-y-4 md:pl-2">
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

          {activeTab === 'CHATTER' && (
             <div className="max-w-3xl rounded-xl border border-slate-200/60 bg-white p-4 sm:rounded-2xl sm:p-6">
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
