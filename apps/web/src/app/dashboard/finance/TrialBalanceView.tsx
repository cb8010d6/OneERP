'use client';

import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Loader2, AlertCircle, CheckCircle2, Calculator, ArrowRightLeft } from 'lucide-react';
import { clsx } from 'clsx';

interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
}

interface TrialBalanceData {
  startDate: string | null;
  endDate: string | null;
  totalDebit: number;
  totalCredit: number;
  difference: number;
  balanced: boolean;
  rows: TrialBalanceRow[];
}

export function TrialBalanceView() {
  const [data, setData] = useState<TrialBalanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrialBalance = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get<TrialBalanceData>('/finance/trial-balance');
      setData(response.data);
    } catch (err: any) {
      setError(err.response?.data?.message || '获取试算平衡表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrialBalance();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-slate-500">正在计算实时财务数据...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-red-100 bg-red-50 p-6 text-center">
        <AlertCircle className="h-8 w-8 text-red-500" />
        <p className="font-medium text-red-900">出错了</p>
        <p className="text-sm text-red-700">{error}</p>
        <button
          onClick={fetchTrialBalance}
          className="mt-4 rounded-lg bg-red-100 px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-200 transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  if (!data || data.rows.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
        <ArrowRightLeft className="h-8 w-8 text-slate-300" />
        <p className="text-sm text-slate-500">暂无已过账凭证，无法生成试算平衡表。</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* 状态看板 */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className={clsx(
          "rounded-xl border p-4 shadow-sm transition-all",
          data.balanced ? "border-emerald-100 bg-emerald-50/50" : "border-amber-100 bg-amber-50/50"
        )}>
          <div className="flex items-center gap-2">
            {data.balanced ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <AlertCircle className="h-5 w-5 text-amber-600" />
            )}
            <span className={clsx(
              "text-sm font-semibold",
              data.balanced ? "text-emerald-900" : "text-amber-900"
            )}>
              {data.balanced ? "借贷已平衡" : "借贷不平衡"}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">所有已过账凭证的状态汇总</p>
        </div>

        <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-600">
            <Calculator className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">借方合计 (Debit)</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">¥{data.totalDebit.toLocaleString()}</p>
        </div>

        <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-600">
            <Calculator className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">贷方合计 (Credit)</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">¥{data.totalCredit.toLocaleString()}</p>
        </div>

        <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-600">
            <ArrowRightLeft className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">差异 (Diff)</span>
          </div>
          <p className={clsx(
            "mt-1 text-2xl font-bold",
            data.difference === 0 ? "text-slate-400" : "text-red-600"
          )}>
            ¥{Math.abs(data.difference).toLocaleString()}
          </p>
        </div>
      </div>

      {/* 报表主体 */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">科目代码</th>
              <th className="px-6 py-3">科目名称</th>
              <th className="px-6 py-3">科目类型</th>
              <th className="px-6 py-3 text-right">借方余额 (Debit)</th>
              <th className="px-6 py-3 text-right">贷方余额 (Credit)</th>
              <th className="px-6 py-3 text-right">净余额 (Balance)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.map((row) => (
              <tr key={row.accountId} className="hover:bg-slate-50 transition-colors group">
                <td className="px-6 py-4 font-mono text-slate-600">{row.code}</td>
                <td className="px-6 py-4 font-medium text-slate-900">{row.name}</td>
                <td className="px-6 py-4">
                  <span className={clsx(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                    row.type === 'ASSET' ? "bg-blue-50 text-blue-700" :
                    row.type === 'LIABILITY' ? "bg-purple-50 text-purple-700" :
                    row.type === 'EQUITY' ? "bg-amber-50 text-amber-700" :
                    row.type === 'REVENUE' ? "bg-emerald-50 text-emerald-700" :
                    "bg-rose-50 text-rose-700"
                  )}>
                    {row.type === 'ASSET' ? '资产' :
                     row.type === 'LIABILITY' ? '负债' :
                     row.type === 'EQUITY' ? '权益' :
                     row.type === 'REVENUE' ? '收入' : '支出'}
                  </span>
                </td>
                <td className="px-6 py-4 text-right font-mono text-slate-600">
                  {row.debit > 0 ? `¥${row.debit.toLocaleString()}` : '-'}
                </td>
                <td className="px-6 py-4 text-right font-mono text-slate-600">
                  {row.credit > 0 ? `¥${row.credit.toLocaleString()}` : '-'}
                </td>
                <td className={clsx(
                  "px-6 py-4 text-right font-mono font-bold",
                  row.balance >= 0 ? "text-slate-900" : "text-red-600"
                )}>
                  ¥{row.balance.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
            <tr>
              <td colSpan={3} className="px-6 py-4 text-slate-900">合计 (Total)</td>
              <td className="px-6 py-4 text-right font-mono text-slate-900">¥{data.totalDebit.toLocaleString()}</td>
              <td className="px-6 py-4 text-right font-mono text-slate-900">¥{data.totalCredit.toLocaleString()}</td>
              <td className={clsx(
                "px-6 py-4 text-right font-mono",
                data.balanced ? "text-slate-900" : "text-red-600"
              )}>
                ¥{Math.abs(data.difference).toLocaleString()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
