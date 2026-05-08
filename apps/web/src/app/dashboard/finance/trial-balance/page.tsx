'use client';

import React, { useState, useEffect } from 'react';
import api from '@/lib/api';
import { usePermissions, RequirePermission } from '@/lib/permissions-context';

interface TrialBalanceRow {
  accountId: string;
  accountNo: string;
  accountName: string;
  accountType: string;
  debit: number;
  credit: number;
}

export default function TrialBalancePage() {
  const [data, setData] = useState<TrialBalanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/v1/finance/trial-balance', {
        params: {
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        },
      });
      setData(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalDebit = data.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = data.reduce((sum, row) => sum + row.credit, 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50/50">
        <h1 className="text-xl font-semibold text-gray-800">试算平衡表 (Trial Balance)</h1>
        
        <div className="flex items-center space-x-3">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <span className="text-gray-500">-</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '查询中...' : '查询'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {error ? (
          <div className="p-4 bg-red-50 text-red-600 rounded-lg">{error}</div>
        ) : (
          <table className="w-full text-sm text-left border border-gray-200">
            <thead className="bg-gray-100 text-gray-600 font-medium">
              <tr>
                <th className="px-4 py-3 border-b">科目代码</th>
                <th className="px-4 py-3 border-b">科目名称</th>
                <th className="px-4 py-3 border-b">科目类型</th>
                <th className="px-4 py-3 border-b text-right">借方合计 (Debit)</th>
                <th className="px-4 py-3 border-b text-right">贷方合计 (Credit)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.map((row) => (
                <tr key={row.accountId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">{row.accountNo}</td>
                  <td className="px-4 py-3 text-gray-800">{row.accountName}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{row.accountType}</td>
                  <td className="px-4 py-3 text-right text-emerald-600 font-medium">
                    {row.debit.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-right text-rose-600 font-medium">
                    {row.credit.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
              {data.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    没有找到符合条件的分录
                  </td>
                </tr>
              )}
            </tbody>
            {data.length > 0 && (
              <tfoot className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right">
                    总计：
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-600">
                    {totalDebit.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-right text-rose-600">
                    {totalCredit.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        )}

        {data.length > 0 && (
          <div className={`mt-4 p-4 rounded-lg font-medium flex items-center justify-between ${isBalanced ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            <span>试算状态：{isBalanced ? '平衡' : '不平衡'}</span>
            {!isBalanced && (
              <span>差额：{Math.abs(totalDebit - totalCredit).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
