'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import {
  AlertTriangle,
  BarChart3,
  Box,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  TrendingDown,
  Warehouse,
} from 'lucide-react';

interface LedgerRow {
  materialId: string;
  materialSku: string;
  materialName: string;
  unit: string;
  category: string;
  locationId: string;
  locationName: string;
  locationCode: string | null;
  locationUsage: string;
  warehouseName: string | null;
  batchCount: number;
  totalQty: number;
  minStock: number;
  unitPrice: number;
  stockValue: number;
  isLow: boolean;
  isOut: boolean;
}

type FilterType = 'ALL' | 'LOW' | 'OUT';

const FILTER_OPTIONS: { key: FilterType; label: string }[] = [
  { key: 'ALL', label: '全部库存' },
  { key: 'LOW', label: '⚠ 低库存预警' },
  { key: 'OUT', label: '✕ 零库存' },
];

function formatMoney(val: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2 }).format(val);
}

function formatQty(val: number, unit: string) {
  return `${val.toLocaleString()} ${unit}`;
}

function QtyCell({ qty, minStock, unit }: { qty: number; minStock: number; unit: string }) {
  if (qty <= 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700 animate-pulse">
        <AlertTriangle className="h-3 w-3" />
        {formatQty(qty, unit)}
      </span>
    );
  }
  if (minStock > 0 && qty < minStock) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-700">
        <TrendingDown className="h-3 w-3" />
        {formatQty(qty, unit)}
      </span>
    );
  }
  return (
    <span className="text-sm font-mono text-slate-900">{formatQty(qty, unit)}</span>
  );
}

export default function InventoryPage() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  const fetchLedger = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<LedgerRow[]>('/inventory/realtime-ledger');
      setRows(res.data ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(rows.map((r) => r.category).filter(Boolean)));
    return cats.sort();
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (filter === 'LOW' && !row.isLow) return false;
      if (filter === 'OUT' && !row.isOut) return false;
      if (categoryFilter !== 'ALL' && row.category !== categoryFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (
          !row.materialSku.toLowerCase().includes(q) &&
          !row.materialName.toLowerCase().includes(q) &&
          !row.locationName.toLowerCase().includes(q) &&
          !(row.warehouseName ?? '').toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [rows, filter, search, categoryFilter]);

  const summary = useMemo(() => {
    const totalItems = rows.length;
    const lowCount = rows.filter((r) => r.isLow).length;
    const outCount = rows.filter((r) => r.isOut).length;
    const totalValue = rows.reduce((sum, r) => sum + r.stockValue, 0);
    return { totalItems, lowCount, outCount, totalValue };
  }, [rows]);

  return (
    <div className="h-full bg-slate-50/50 p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 flex items-center gap-3">
            <Warehouse className="h-8 w-8 text-indigo-600" />
            实时库存台账 (Stock Ledger)
          </h1>
          <p className="text-slate-500 mt-1">
            Kysely 高性能聚合，按物料×库位展示，低库存自动预警。
          </p>
        </div>
        <button
          onClick={fetchLedger}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm font-medium shadow-sm"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200/60 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold uppercase tracking-wide mb-1">
            <Box className="h-3.5 w-3.5" /> 库存条目
          </div>
          <div className="text-2xl font-black text-slate-900">{summary.totalItems}</div>
        </div>
        <div className="rounded-xl border border-amber-200/70 bg-amber-50 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-amber-600 text-xs font-semibold uppercase tracking-wide mb-1">
            <AlertTriangle className="h-3.5 w-3.5" /> 低库存预警
          </div>
          <div className="text-2xl font-black text-amber-700">{summary.lowCount}</div>
        </div>
        <div className="rounded-xl border border-red-200/70 bg-red-50 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-red-600 text-xs font-semibold uppercase tracking-wide mb-1">
            <TrendingDown className="h-3.5 w-3.5" /> 零库存
          </div>
          <div className="text-2xl font-black text-red-700">{summary.outCount}</div>
        </div>
        <div className="rounded-xl border border-emerald-200/70 bg-emerald-50 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-emerald-600 text-xs font-semibold uppercase tracking-wide mb-1">
            <BarChart3 className="h-3.5 w-3.5" /> 库存总价值
          </div>
          <div className="text-2xl font-black text-emerald-700">{formatMoney(summary.totalValue)}</div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="rounded-2xl border border-slate-200/60 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/40 flex flex-wrap items-center gap-3">
          {/* Quick filter tabs */}
          <div className="flex gap-1 border border-slate-200 rounded-lg p-0.5 bg-white">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setFilter(opt.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  filter === opt.key
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Category filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="erp-input w-auto min-w-[120px]"
            >
              <option value="ALL">全部分类</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索物料编码、名称、库位..."
              className="pl-8 pr-4 py-1.5 w-full rounded-lg border border-slate-200 text-xs outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <span className="ml-auto text-xs text-slate-400">共 {filtered.length} 条</span>
        </div>

        {/* Grid */}
        <div className="min-w-full overflow-x-auto data-grid-scroll">
          <table className="erp-table w-full">
            <thead>
              <tr>
                <th className="text-left">物料编码 (SKU)</th>
                <th className="text-left">物料名称</th>
                <th className="text-left">分类</th>
                <th className="text-left">库位</th>
                <th className="text-left">仓库</th>
                <th className="text-right">当前库存</th>
                <th className="text-right">安全库存</th>
                <th className="text-right">批次数</th>
                <th className="text-right">库存价值</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400">
                    <Loader2 className="h-5 w-5 animate-spin inline-block mr-2" />
                    正在加载实时台账...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400 text-sm">
                    暂无库存数据，可先通过「入库」操作创建库存。
                  </td>
                </tr>
              ) : (
                filtered.map((row, index) => (
                  <tr
                    key={`${row.materialId}-${row.locationId}-${index}`}
                    className={row.isOut ? 'bg-red-50/60' : row.isLow ? 'bg-amber-50/40' : ''}
                  >
                    <td>
                      <span className="font-mono text-xs text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                        {row.materialSku}
                      </span>
                    </td>
                    <td className="font-medium text-slate-900">{row.materialName}</td>
                    <td>
                      <span className="text-xs text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                        {row.category}
                      </span>
                    </td>
                    <td>
                      <div className="text-slate-700 text-xs">
                        {row.locationName}
                        {row.locationCode && (
                          <span className="ml-1 font-mono text-slate-400">({row.locationCode})</span>
                        )}
                      </div>
                    </td>
                    <td className="text-slate-500 text-xs">{row.warehouseName ?? '-'}</td>
                    <td className="text-right">
                      <QtyCell qty={row.totalQty} minStock={row.minStock} unit={row.unit} />
                    </td>
                    <td className="text-right text-xs font-mono text-slate-500">
                      {row.minStock > 0 ? `${row.minStock} ${row.unit}` : '-'}
                    </td>
                    <td className="text-right text-xs text-slate-500">{row.batchCount}</td>
                    <td className="text-right font-mono font-semibold text-slate-800 text-sm">
                      {formatMoney(row.stockValue)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && filtered.length > 0 && (
          <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>
              低库存: <strong className="text-amber-600">{summary.lowCount}</strong> 项 &nbsp;|&nbsp;
              零库存: <strong className="text-red-600">{summary.outCount}</strong> 项
            </span>
            <span>
              显示 {filtered.length} / {rows.length} 条 &nbsp;|&nbsp;
              总库存价值: <strong className="text-emerald-700">{formatMoney(summary.totalValue)}</strong>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
