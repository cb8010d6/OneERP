'use client';

import { useMemo, useState } from 'react';
import { DynamicView } from '@/components/core';
import { DocumentDraftUploader } from '@/components/ai/DocumentDraftUploader';
import { TrialBalanceView } from './TrialBalanceView';
import { FileText, BarChart3 } from 'lucide-react';
import { clsx } from 'clsx';

export default function FinancePageClient() {
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [activeTab, setActiveTab] = useState<'invoices' | 'trial-balance'>('invoices');

  const preview = useMemo(() => {
    if (!draft) return [] as Array<{ key: string; value: string }>;
    return Object.entries(draft)
      .slice(0, 6)
      .map(([key, value]) => ({
        key,
        value: typeof value === 'object' ? JSON.stringify(value) : String(value),
      }));
  }, [draft]);

  return (
    <div className="space-y-6">
      {/* 顶部标签页切换 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          <button
            onClick={() => setActiveTab('invoices')}
            className={clsx(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
              activeTab === 'invoices' 
                ? "bg-white text-slate-900 shadow-sm" 
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            <FileText className="h-4 w-4" />
            应收发票
          </button>
          <button
            onClick={() => setActiveTab('trial-balance')}
            className={clsx(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
              activeTab === 'trial-balance' 
                ? "bg-white text-slate-900 shadow-sm" 
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            <BarChart3 className="h-4 w-4" />
            试算平衡表
          </button>
        </div>
      </div>

      {activeTab === 'invoices' ? (
        <div className="space-y-4 animate-in fade-in slide-in-from-left-2 duration-300">
          <DocumentDraftUploader onDraftReady={(nextDraft) => setDraft(nextDraft)} />

          {draft ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <p className="text-sm font-medium text-amber-900">AI 草稿已就绪，已自动填充下方表单。</p>
              <div className="mt-2 grid gap-2 text-xs text-amber-800 md:grid-cols-2">
                {preview.map((item) => (
                  <div key={item.key} className="rounded bg-white/80 px-2 py-1 shadow-sm border border-amber-100">
                    <span className="font-semibold">{item.key}:</span> {item.value}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <DynamicView modelName="invoice" title="应收发票管理" externalDraft={draft} />
        </div>
      ) : (
        <div className="animate-in fade-in slide-in-from-right-2 duration-300">
          <TrialBalanceView />
        </div>
      )}
    </div>
  );
}
