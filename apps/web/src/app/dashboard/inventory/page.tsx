'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Package,
  RefreshCw,
  Scan,
  Search,
  Warehouse,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';

interface LedgerRow {
  locationId: string;
  locationName: string;
  warehouseId: string | null;
  warehouseName: string | null;
  materialId: string;
  materialSku: string;
  materialName: string;
  materialUnit: string;
  minStock: number;
  netQty: number;
  batchCount: number;
  isLow: boolean;
}

interface WarehouseGroup {
  warehouseId: string | null;
  warehouseName: string;
  locations: LocationGroup[];
  totalRows: number;
  lowCount: number;
}

interface LocationGroup {
  locationId: string;
  locationName: string;
  rows: LedgerRow[];
  lowCount: number;
}

function buildTree(rows: LedgerRow[]): WarehouseGroup[] {
  const warehouseMap = new Map<string, WarehouseGroup>();

  for (const row of rows) {
    const warehouseKey = row.warehouseId ?? '__NO_WAREHOUSE__';
    let warehouse = warehouseMap.get(warehouseKey);

    if (!warehouse) {
      warehouse = {
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName ?? '未分配仓库',
        locations: [],
        totalRows: 0,
        lowCount: 0,
      };
      warehouseMap.set(warehouseKey, warehouse);
    }

    let location = warehouse.locations.find((item) => item.locationId === row.locationId);
    if (!location) {
      location = { locationId: row.locationId, locationName: row.locationName, rows: [], lowCount: 0 };
      warehouse.locations.push(location);
    }

    location.rows.push(row);
    warehouse.totalRows += 1;
    if (row.isLow) {
      location.lowCount += 1;
      warehouse.lowCount += 1;
    }
  }

  return Array.from(warehouseMap.values()).sort((a, b) =>
    a.warehouseName.localeCompare(b.warehouseName, 'zh-CN'),
  );
}

function QtyCell({ row }: { row: LedgerRow }) {
  if (row.isLow) {
    return (
      <span className="erp-badge erp-badge--danger inline-flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        {row.netQty.toLocaleString()} {row.materialUnit}
      </span>
    );
  }

  return (
    <span className="font-mono tabular-nums text-gray-800">
      {row.netQty.toLocaleString()} {row.materialUnit}
    </span>
  );
}

export default function InventoryPage() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedWarehouses, setExpandedWarehouses] = useState<Set<string>>(new Set());
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());
  const [scanMode, setScanMode] = useState(false);
  const [scanBuffer, setScanBuffer] = useState('');
  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const fetchLedger = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<LedgerRow[]>('/inventory/realtime-ledger');
      setRows(response.data ?? []);
    } catch (error) {
      console.error('Failed to fetch realtime ledger', error);
      toast.error('加载库存台账失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLedger();
  }, [fetchLedger]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return rows;

    return rows.filter(
      (row) =>
        row.materialName.toLowerCase().includes(keyword) ||
        row.materialSku.toLowerCase().includes(keyword) ||
        row.locationName.toLowerCase().includes(keyword) ||
        (row.warehouseName ?? '').toLowerCase().includes(keyword),
    );
  }, [rows, search]);

  const tree = useMemo(() => buildTree(filteredRows), [filteredRows]);

  useEffect(() => {
    if (rows.length === 0 || tree.length === 0) return;

    const warehouseKeys = new Set<string>();
    const locationKeys = new Set<string>();
    for (const warehouse of tree) {
      warehouseKeys.add(warehouse.warehouseId ?? '__NO_WAREHOUSE__');
      for (const location of warehouse.locations) locationKeys.add(location.locationId);
    }

    setExpandedWarehouses(warehouseKeys);
    setExpandedLocations(locationKeys);
    // Expand only when initial data arrives; user toggles should not be reset on every search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  const totalMaterials = useMemo(() => new Set(rows.map((row) => row.materialId)).size, [rows]);
  const totalLocations = useMemo(() => new Set(rows.map((row) => row.locationId)).size, [rows]);
  const totalLow = useMemo(() => rows.filter((row) => row.isLow).length, [rows]);

  const toggleWarehouse = (key: string) => {
    setExpandedWarehouses((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleLocation = (key: string) => {
    setExpandedLocations((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleScanSubmit = useCallback(
    async (sku: string) => {
      const materialSku = sku.trim();
      if (!materialSku) return;

      setScanning(true);
      try {
        await api.post('/inventory/scan', { materialSku, quantity: 1 });
        toast.success(`扫码出库成功：${materialSku}`);
        await fetchLedger();
      } catch (error: unknown) {
        const message =
          error && typeof error === 'object' && 'response' in error
            ? String(
                (error as { response?: { data?: { message?: string } } }).response?.data?.message ??
                  '出库失败',
              )
            : '出库失败';
        toast.error(message);
      } finally {
        setScanning(false);
        setScanBuffer('');
        scanInputRef.current?.focus();
      }
    },
    [fetchLedger],
  );

  return (
    <div className="h-full space-y-5 bg-slate-50/40 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
            <Package className="h-7 w-7 text-blue-600" />
            实时库存台账
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            基于聚合查询的库存视图，支持层级钻取与低库存预警。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setScanMode((value) => !value);
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
            onClick={() => void fetchLedger()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {scanMode && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-700">
            <Scan className="h-4 w-4" />
            扫码枪出库模式：扫入物料条码后自动扣减 1 件库存。
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={scanInputRef}
              type="text"
              value={scanBuffer}
              onChange={(event) => setScanBuffer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleScanSubmit(scanBuffer);
              }}
              placeholder="将光标聚焦此处，然后扫码..."
              className="h-9 flex-1 rounded-lg border border-blue-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
            <button
              type="button"
              disabled={scanning || !scanBuffer.trim()}
              onClick={() => void handleScanSubmit(scanBuffer)}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {scanning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              确认
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="erp-card flex items-center gap-3 p-4">
          <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">物料品种</div>
            <div className="erp-stat-value text-xl font-bold text-slate-900">{totalMaterials}</div>
          </div>
        </div>

        <div className="erp-card flex items-center gap-3 p-4">
          <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
            <Warehouse className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">在库库位</div>
            <div className="erp-stat-value text-xl font-bold text-slate-900">{totalLocations}</div>
          </div>
        </div>

        <div className={`erp-card flex items-center gap-3 p-4 ${totalLow > 0 ? 'border-amber-200 bg-amber-50/60' : ''}`}>
          <div className={`rounded-lg p-2 ${totalLow > 0 ? 'bg-amber-100 text-amber-600' : 'bg-green-50 text-green-600'}`}>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">低库存预警</div>
            <div className={`erp-stat-value text-xl font-bold ${totalLow > 0 ? 'text-amber-700' : 'text-green-700'}`}>
              {totalLow}
            </div>
          </div>
        </div>
      </div>

      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="按物料名、SKU、库位搜索..."
          className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-100"
        />
      </div>

      <div className="erp-card overflow-hidden">
        <div
          className="grid border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-500"
          style={{ gridTemplateColumns: '2fr 2fr 1fr 1fr 1fr 1fr' }}
        >
          <div className="pl-8">物料</div>
          <div>SKU</div>
          <div className="text-right">净库存</div>
          <div className="text-right">最低库存</div>
          <div className="text-right">批次数</div>
          <div className="text-right">状态</div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            正在加载台账数据...
          </div>
        ) : tree.length === 0 ? (
          <div className="py-14 text-center text-sm text-slate-500">暂无库存数据</div>
        ) : (
          tree.map((warehouse) => {
            const warehouseKey = warehouse.warehouseId ?? '__NO_WAREHOUSE__';
            const warehouseOpen = expandedWarehouses.has(warehouseKey);

            return (
              <div key={warehouseKey}>
                <button
                  type="button"
                  onClick={() => toggleWarehouse(warehouseKey)}
                  className="flex w-full items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2 text-left hover:bg-slate-100/60"
                >
                  {warehouseOpen ? (
                    <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  )}
                  <Warehouse className="h-4 w-4 flex-shrink-0 text-slate-500" />
                  <span className="text-sm font-semibold text-slate-800">{warehouse.warehouseName}</span>
                  <span className="ml-1 text-xs text-slate-400">
                    ({warehouse.totalRows} 条明细{warehouse.lowCount > 0 ? `, ${warehouse.lowCount} 低库存` : ''})
                  </span>
                </button>

                {warehouseOpen &&
                  warehouse.locations.map((location) => {
                    const locationOpen = expandedLocations.has(location.locationId);

                    return (
                      <div key={location.locationId}>
                        <button
                          type="button"
                          onClick={() => toggleLocation(location.locationId)}
                          className="flex w-full items-center gap-2 border-b border-slate-100 bg-white px-3 py-1.5 pl-8 text-left hover:bg-slate-50/60"
                        >
                          {locationOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                          )}
                          <Package className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                          <span className="text-xs font-semibold text-slate-600">{location.locationName}</span>
                          <span className="text-xs text-slate-400">
                            ({location.rows.length} 种物料{location.lowCount > 0 ? `, ${location.lowCount} 低库存` : ''})
                          </span>
                        </button>

                        {locationOpen &&
                          location.rows.map((row) => (
                            <div
                              key={`${row.locationId}-${row.materialId}`}
                              className={`grid items-center border-b border-slate-100 px-3 py-1.5 pl-14 text-xs ${
                                row.isLow ? 'bg-amber-50/40 hover:bg-amber-50' : 'hover:bg-slate-50/60'
                              }`}
                              style={{ gridTemplateColumns: '2fr 2fr 1fr 1fr 1fr 1fr' }}
                            >
                              <div className="truncate font-medium text-slate-800">{row.materialName}</div>
                              <div className="font-mono text-slate-500">{row.materialSku}</div>
                              <div className="text-right">
                                <QtyCell row={row} />
                              </div>
                              <div className="text-right font-mono text-slate-500">
                                {row.minStock.toLocaleString()} {row.materialUnit}
                              </div>
                              <div className="text-right text-slate-500">{row.batchCount}</div>
                              <div className="text-right">
                                {row.isLow ? (
                                  <span className="erp-badge erp-badge--pending">低库存</span>
                                ) : (
                                  <span className="erp-badge erp-badge--success">正常</span>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>

      <div className="text-right text-xs text-slate-400">
        共 {filteredRows.length} 条库存明细 · 单击仓库/库位行展开或折叠
      </div>
    </div>
  );
}
