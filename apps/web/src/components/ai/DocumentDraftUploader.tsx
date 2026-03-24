'use client';

import { useState } from 'react';
import { Loader2, UploadCloud } from 'lucide-react';
import api from '@/lib/api';

interface DocumentDraftUploaderProps {
  onDraftReady: (draft: Record<string, unknown>) => void;
}

export function DocumentDraftUploader({ onDraftReady }: DocumentDraftUploaderProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string>('');

  const handleFile = async (file: File) => {
    setLoading(true);
    setError(null);
    setSummary('');

    try {
      const form = new FormData();
      form.append('file', file);

      const response = await api.post('/v1/ai/documents/parse', form, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const draft = (response.data?.draft ?? {}) as Record<string, unknown>;
      onDraftReady(draft);
      setSummary(response.data?.message || '单据解析完成，请确认草稿。');
    } catch (reason: any) {
      setError(reason?.response?.data?.message || '单据解析失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">OCR 单据解析</h3>
      <p className="mt-1 text-xs text-slate-500">上传发票或收据后，AI 会生成可确认的草稿字段。</p>

      <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600 hover:bg-slate-100">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        {loading ? '解析中...' : '点击上传单据'}
        <input
          type="file"
          className="hidden"
          accept="image/*,.pdf"
          disabled={loading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleFile(file);
            }
            event.currentTarget.value = '';
          }}
        />
      </label>

      {summary ? <p className="mt-2 text-xs text-emerald-700">{summary}</p> : null}
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}
