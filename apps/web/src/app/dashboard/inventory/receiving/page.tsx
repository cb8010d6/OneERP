'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '@/lib/api';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Hash,
  Loader2,
  MapPin,
  Package,
  Scan,
  Search,
  Truck,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Material {
  id: string;
  sku: string;
  name: string;
  unit: string;
}

interface PurchaseOrderItem {
  id: string;
  materialId: string;
  quantity: number;
  receivedQty: number;
  remainingQty: number;
  unitPrice: number;
  material: Material;
}

interface Supplier {
  id: string;
  name: string;
}

interface PurchaseOrder {
  id: string;
  orderNo: string;
  status: string;
  supplier: Supplier;
  items: PurchaseOrderItem[];
  createdAt: string;
}

interface Warehouse {
  id: string;
  name: string;
}

interface StockLocation {
  id: string;
  name: string;
  warehouseId: string | null;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    CONFIRMED: { label: '已确认', cls: 'erp-badge--info' },
    PARTIALLY_RECEIVED: { label: '部分收货', cls: 'erp-badge--pending' },
    RECEIVED: { label: '已收货', cls: 'erp-badge--success' },
  };
  const s = map[status] ?? { label: status, cls: '' };
  return <span className={`erp-badge ${s.cls}`}>{s.label}</span>;
}

export default function ReceivingPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');

  const [quantity, setQuantity] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [scanMode, setScanMode] = useState(false);
  const [scanBuffer, setScanBuffer] = useState('');
  const scanInputRef = useRef<HTMLInputElement>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PurchaseOrder[]>('/purchase/orders/pending');
      setOrders(res.data ?? []);
    } catch {
      toast.error('加载采购单失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLocations = useCallback(async () => {
    try {
      const [whRes, locRes] = await Promise.all([
        api.get<Warehouse[]>('/inventory/warehouses'),
        api.get<StockLocation[]>('/inventory/locations'),
      ]);
      setWarehouses(whRes.data ?? []);
      setLocations(locRes.data ?? []);
    } catch {
      toast.error('加载库位信息失败');
    }
  }, []);

  useEffect(() => {
    void fetchOrders();
    void fetchLocations();
  }, [fetchOrders, fetchLocations]);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedOrderId),
    [orders, selectedOrderId],
  );

  const selectedItem = useMemo(
    () => selectedOrder?.items.find((i) => i.id === selectedItemId),
    [selectedOrder, selectedItemId],
  );

  const filteredLocations = useMemo(() => {
    if (!selectedWarehouseId) return locations;
    return locations.filter((l) => l.warehouseId === selectedWarehouseId);
  }, [locations, selectedWarehouseId]);

  const qtyError = useMemo(() => {
    if (!quantity || !selectedItem) return null;
    const num = Number(quantity);
    if (Number.isNaN(num) || num <= 0) return '收货数量必须大于 0';
    if (num > selectedItem.remainingQty) return `不能超过待收数量 (${selectedItem.remainingQty})`;
    return null;
  }, [quantity, selectedItem]);

  const isValid = !!selectedOrderId && !!selectedItemId && !!selectedLocationId && !!quantity && !qtyError;

  const handleSubmit = async () => {
    if (!isValid || !selectedOrder || !selectedItem) return;
    setSubmitting(true);
    try {
      const payload = {
        purchaseOrderId: selectedOrder.id,
        itemId: selectedItem.id,
        quantity: Number(quantity),
        destLocationId: selectedLocationId,
        batchNo: batchNo.trim() || undefined,
        note: note.trim() || undefined,
      };
      const res = await api.post('/purchase/orders/receive', payload);
      toast.success(res.data?.message ?? '收货成功');
      setQuantity('');
      setBatchNo('');
      setNote('');
      setSelectedItemId('');
      await fetchOrders();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? String((err as { response: { data?: { message?: string } } }).response?.data?.message ?? '收货失败')
          : '收货失败';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleScan = async (sku: string) => {
    if (!sku.trim() || !selectedLocationId) {
      toast.error('请先选择目标库位');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        materialSku: sku.trim(),
        quantity: 1,
        destLocationId: selectedLocationId,
        batchNo: batchNo.trim() || undefined,
      };
      const res = await api.post('/purchase/orders/scan-receive', payload);
      toast.success(res.data?.message ?? '扫码收货成功');
      await fetchOrders();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? String((err as { response: { data?: { message?: string } } }).response?.data?.message ?? '扫码收货失败')
          : '扫码收货失败';
      toast.error(msg);
    } finally {
      setSubmitting(false);
      setScanBuffer('');
      scanInputRef.current?.focus();
    }
  };

  return (
    <div className="h-full space-y-5 bg-slate-50/40 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
            <Truck className="h-7 w-7 text-blue-600" />
            收货执行
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            选择采购单、库位、批次和数量完成收货入库，支持扫码枪快速收货。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setScanMode((v) => !v);
              if (!scanMode) setTimeout(() => scanInputRef.current?.focus(), 100);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              scanMode
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Scan className="h-4 w-4" />
            扫码模式
          </button>
          <button
            type="button"
            onClick={fetchOrders}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <Loader2 className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {scanMode && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-700">
            <Scan className="h-4 w-4" />
            扫码枪收货模式：扫描物料编码后自动匹配待收采购单并收货 1 件
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={scanInputRef}
              type="text"
              value={scanBuffer}
              onChange={(e) => setScanBuffer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleScan(scanBuffer);
              }}
              placeholder="光标停在此处后扫码..."
              className="h-9 flex-1 rounded-lg border border-blue-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
            <button
              type="button"
              disabled={submitting || !scanBuffer.trim() || !selectedLocationId}
              onClick={() => void handleScan(scanBuffer)}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              确认
            </button>
          </div>
          {!selectedLocationId && (
            <p className="mt-2 text-xs text-amber-600">
              <AlertTriangle className="mr-1 inline h-3 w-3" />
              请先在下方选择目标库位再扫码
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="erp-card space-y-5 p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <Package className="h-5 w-5 text-blue-600" />
            收货信息
          </h2>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">采购单</label>
            <div className="relative">
              <select
                value={selectedOrderId}
                onChange={(e) => {
                  setSelectedOrderId(e.target.value);
                  setSelectedItemId('');
                }}
                className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-sm outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">-- 选择采购单 --</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNo} | {o.supplier.name} | {o.items.length} 个物料
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          {selectedOrder && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">订单明细</label>
              <div className="relative">
                <select
                  value={selectedItemId}
                  onChange={(e) => {
                    setSelectedItemId(e.target.value);
                    setQuantity('');
                  }}
                  className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">-- 选择物料 --</option>
                  {selectedOrder.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.material.name} ({item.material.sku}) | 待收: {item.remainingQty} {item.material.unit}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
          )}

          {selectedItem && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">采购数量</span>
                <span className="font-mono font-semibold">{selectedItem.quantity} {selectedItem.material.unit}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-slate-500">已收货</span>
                <span className="font-mono">{selectedItem.receivedQty} {selectedItem.material.unit}</span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1">
                <span className="font-medium text-slate-500">待收货</span>
                <span className="font-mono font-bold text-blue-600">{selectedItem.remainingQty} {selectedItem.material.unit}</span>
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              <MapPin className="mr-1 inline h-3.5 w-3.5" />
              目标仓库
            </label>
            <div className="relative">
              <select
                value={selectedWarehouseId}
                onChange={(e) => {
                  setSelectedWarehouseId(e.target.value);
                  setSelectedLocationId('');
                }}
                className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-sm outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">-- 全部仓库 --</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              <MapPin className="mr-1 inline h-3.5 w-3.5" />
              目标库位 <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <select
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
                className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-sm outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">-- 选择库位 --</option>
                {filteredLocations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              <Hash className="mr-1 inline h-3.5 w-3.5" />
              批次号（可选，支持扫码）
            </label>
            <input
              type="text"
              value={batchNo}
              onChange={(e) => setBatchNo(e.target.value)}
              placeholder="输入或扫描批次号，留空则自动生成"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              收货数量 <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={selectedItem ? `最多 ${selectedItem.remainingQty}` : '请输入数量'}
              min="0.01"
              max={selectedItem?.remainingQty}
              step="0.01"
              className={`h-10 w-full rounded-lg border bg-white px-3 text-sm outline-none focus:ring-2 ${
                qtyError ? 'border-red-300 focus:ring-red-100' : 'border-slate-200 focus:ring-blue-100'
              }`}
            />
            {qtyError && (
              <p className="mt-1 text-xs text-red-500">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                {qtyError}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">备注（可选）</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="收货备注..."
              rows={2}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <button
            type="button"
            disabled={!isValid || submitting}
            onClick={handleSubmit}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            确认收货入库
          </button>
        </div>

        <div className="erp-card p-5">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-800">
            <Search className="h-5 w-5 text-blue-600" />
            待收货明细
          </h2>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              加载中...
            </div>
          ) : orders.length === 0 ? (
            <div className="py-14 text-center text-sm text-slate-500">暂无待收货采购单</div>
          ) : (
            <div className="max-h-[600px] space-y-3 overflow-y-auto pr-1">
              {orders.map((order) => (
                <div
                  key={order.id}
                  className={`cursor-pointer rounded-lg border p-3 transition ${
                    selectedOrderId === order.id
                      ? 'border-blue-300 bg-blue-50/60'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                  onClick={() => {
                    setSelectedOrderId(order.id);
                    setSelectedItemId('');
                  }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold text-slate-800">{order.orderNo}</span>
                    <StatusBadge status={order.status} />
                  </div>
                  <div className="mb-2 text-xs text-slate-500">供应商: {order.supplier.name}</div>
                  <div className="space-y-1">
                    {order.items.map((item) => {
                      const pct = item.quantity > 0 ? (item.receivedQty / item.quantity) * 100 : 0;
                      return (
                        <div key={item.id} className="flex items-center gap-2 text-xs">
                          <span className="flex-1 truncate text-slate-700">{item.material.name}</span>
                          <span className="font-mono text-slate-500">{item.material.sku}</span>
                          <div className="w-20">
                            <div className="h-1.5 w-full rounded-full bg-slate-100">
                              <div
                                className={`h-1.5 rounded-full ${pct >= 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                          </div>
                          <span className="w-16 text-right font-mono text-slate-500">
                            {item.remainingQty} / {item.quantity}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
