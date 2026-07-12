'use client';

import { useState } from 'react';
import { Loader2, MessageSquareText, Sparkles } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api, { readApiError } from '@/lib/api';

type ChartPoint = {
  status: string;
  count: number;
};

type Chat2DashResponse = {
  title: string;
  insight: string;
  chart: {
    data: ChartPoint[];
    xKey: string;
    yKey: string;
  };
};

type Chat2SqlResponse = {
  sql: string;
  rows: Array<Record<string, unknown>>;
  explanation?: {
    summary?: string;
    filters?: string[];
    safety?: string[];
  };
  export?: {
    fileName?: string;
    content?: string;
  };
};

export function Chat2DashPanel() {
  const [input, setInput] = useState('过去一周发货异常的订单明细');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Chat2DashResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sqlResult, setSqlResult] = useState<Chat2SqlResponse | null>(null);

  const downloadCsv = () => {
    if (!sqlResult?.export?.content) return;
    const blob = new Blob([sqlResult.export.content], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sqlResult.export.fileName || 'chat2sql.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const runQuery = async () => {
    const prompt = input.trim();
    if (!prompt || loading) return;

    setLoading(true);
    setError(null);
    try {
      const response = await api.post('/v1/ai/chat2dash', { input: prompt });
      setResult(response.data as Chat2DashResponse);
      setSqlResult(null);
    } catch (reason: unknown) {
      setError(readApiError(reason, '分析失败，请稍后重试。'));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const runChat2Sql = async () => {
    const prompt = input.trim();
    if (!prompt || loading) return;

    setLoading(true);
    setError(null);
    try {
      const response = await api.post('/v1/ai/chat2sql', { input: prompt });
      setSqlResult(response.data as Chat2SqlResponse);
      setResult(null);
    } catch (reason: unknown) {
      setError(readApiError(reason, 'Chat2SQL 查询失败。'));
      setSqlResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">Chat2Dash</label>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void runQuery();
              }
            }}
            placeholder="输入分析问题，例如：最近30天订单状态分布"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
          />
          <button
            onClick={() => void runQuery()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-700 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Chat2Dash
          </button>
          <button
            onClick={() => void runChat2Sql()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            Chat2SQL
          </button>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-cyan-600" /> Thinking...
          </div>
        </div>
      )}

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

      {result && (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <h4 className="text-base font-semibold text-slate-900">{result.title}</h4>
            <p className="mt-1 text-sm text-slate-600">{result.insight}</p>
          </div>

          <div className="h-[320px] w-full rounded-xl border border-slate-100 bg-slate-50 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={result.chart?.data || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                <XAxis dataKey={result.chart?.xKey || 'status'} stroke="#64748b" />
                <YAxis stroke="#64748b" allowDecimals={false} />
                <Tooltip />
                <Bar dataKey={result.chart?.yKey || 'count'} fill="#0891b2" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {sqlResult ? (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <h4 className="text-base font-semibold text-slate-900">Chat2SQL 结果</h4>
            <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-600">{sqlResult.sql}</pre>
          </div>
          {sqlResult.explanation ? (
            <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-3 text-sm text-cyan-900">
              <p className="font-medium">数据提取逻辑说明</p>
              <p className="mt-1">{sqlResult.explanation.summary}</p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase text-cyan-700">过滤与口径</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {(sqlResult.explanation.filters || []).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-cyan-700">安全约束</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {(sqlResult.explanation.safety || []).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={downloadCsv}
              disabled={!sqlResult.export?.content}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              导出明细 CSV
            </button>
          </div>
          {sqlResult.rows.length ? (
            <div className="overflow-auto rounded border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {Object.keys(sqlResult.rows[0]).map((key) => (
                      <th key={key} className="px-2 py-1 font-medium">{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sqlResult.rows.map((row, index) => (
                    <tr key={index} className="border-t border-slate-100">
                      {Object.keys(sqlResult.rows[0]).map((key) => (
                        <td key={`${index}-${key}`} className="px-2 py-1 text-slate-700">
                          {String(row[key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">查询无数据。</div>
          )}
        </div>
      ) : null}

      {!result && !loading && !error && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4" />
            尚未生成图表，输入问题后点击分析。
          </div>
        </div>
      )}
    </div>
  );
}
