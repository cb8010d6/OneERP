'use client';

import { useMemo, useState } from 'react';
import { DynamicView } from '@/components/core';
import { DocumentDraftUploader } from '@/components/ai/DocumentDraftUploader';

export default function FinancePageClient() {
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);

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
    <div className="space-y-4">
      <DocumentDraftUploader onDraftReady={(nextDraft) => setDraft(nextDraft)} />

      {draft ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">Draft 已生成，已自动带入下方表单。</p>
          <div className="mt-2 grid gap-2 text-xs text-amber-800 md:grid-cols-2">
            {preview.map((item) => (
              <div key={item.key} className="rounded bg-white px-2 py-1">
                <span className="font-medium">{item.key}:</span> {item.value}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <DynamicView modelName="invoice" title="财务管理" externalDraft={draft} />
    </div>
  );
}
