'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Loader2, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { AsyncSelect } from '@/components/core/AsyncSelect';
import { Sheet } from '@/components/ui/Sheet';

interface RequirementListItem {
  id: string;
  requirementNo: string;
  status: string;
  sourceChannel: string;
  summary: string;
  estimatedAmount: string | number | null;
  expectedCloseDate: string | null;
  nextFollowUpAt: string | null;
  closeReason: string | null;
  updatedAt: string;
  partner?: { id: string; name: string; code?: string | null };
  owner?: { id: string; name: string; email: string };
}

interface RequirementListResponse {
  data: RequirementListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'DRAFT', label: '草稿' },
  { value: 'FOLLOWING', label: '跟进中' },
  { value: 'QUALIFIED', label: '已确认' },
  { value: 'QUOTING', label: '报价中' },
  { value: 'LOST', label: '已丢单' },
  { value: 'CANCELLED', label: '已取消' },
] as const;

function statusClass(status: string) {
  if (status === 'FOLLOWING') return 'bg-sky-100 text-sky-700';
  if (status === 'QUALIFIED') return 'bg-emerald-100 text-emerald-700';
  if (status === 'QUOTING') return 'bg-violet-100 text-violet-700';
  if (status === 'LOST' || status === 'CANCELLED')
    return 'bg-rose-100 text-rose-700';
  return 'bg-slate-100 text-slate-600';
}

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

export function RequirementWorkbench() {
  const [requirements, setRequirements] = useState<RequirementListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [actionMode, setActionMode] = useState<'follow-up' | 'close' | null>(
    null,
  );
  const [selected, setSelected] = useState<RequirementListItem | null>(null);
  const [saving, setSaving] = useState(false);

  const [partnerId, setPartnerId] = useState('');
  const [sourceChannel, setSourceChannel] = useState('');
  const [summary, setSummary] = useState('');
  const [estimatedAmount, setEstimatedAmount] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [nextFollowUpAt, setNextFollowUpAt] = useState('');
  const [actionContent, setActionContent] = useState('');
  const [actionNextFollowUpAt, setActionNextFollowUpAt] = useState('');

  const fetchRequirements = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: '100' });
      if (search.trim()) params.set('search', search.trim());
      if (status) params.set('status', status);
      const response = await api.get<RequirementListResponse>(
        `/presales/requirements?${params.toString()}`,
      );
      setRequirements(response.data.data ?? []);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : '客户需求单加载失败',
      );
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    void fetchRequirements();
  }, [fetchRequirements]);

  const activeCount = useMemo(
    () =>
      requirements.filter(
        (item) => !['LOST', 'CANCELLED', 'CONVERTED'].includes(item.status),
      ).length,
    [requirements],
  );

  const resetCreateForm = () => {
    setPartnerId('');
    setSourceChannel('');
    setSummary('');
    setEstimatedAmount('');
    setExpectedCloseDate('');
    setNextFollowUpAt('');
  };

  const submitCreate = async () => {
    if (!partnerId || !sourceChannel.trim() || !summary.trim()) {
      toast.error('请选择客户并填写来源渠道和需求摘要');
      return;
    }
    setSaving(true);
    try {
      await api.post('/presales/requirements', {
        partnerId,
        sourceChannel: sourceChannel.trim(),
        summary: summary.trim(),
        estimatedAmount: estimatedAmount ? Number(estimatedAmount) : undefined,
        expectedCloseDate: expectedCloseDate || undefined,
        nextFollowUpAt: nextFollowUpAt
          ? new Date(nextFollowUpAt).toISOString()
          : undefined,
      });
      toast.success('客户需求单已创建');
      setCreateOpen(false);
      resetCreateForm();
      await fetchRequirements();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const openAction = (
    item: RequirementListItem,
    mode: 'follow-up' | 'close',
  ) => {
    setSelected(item);
    setActionMode(mode);
    setActionContent('');
    setActionNextFollowUpAt('');
  };

  const submitAction = async () => {
    if (!selected || !actionMode || !actionContent.trim()) {
      toast.error(actionMode === 'close' ? '请填写丢单原因' : '请填写跟进内容');
      return;
    }
    setSaving(true);
    try {
      if (actionMode === 'follow-up') {
        await api.post(`/presales/requirements/${selected.id}/follow-ups`, {
          content: actionContent.trim(),
          nextFollowUpAt: actionNextFollowUpAt
            ? new Date(actionNextFollowUpAt).toISOString()
            : undefined,
        });
        toast.success('跟进记录已保存');
      } else {
        await api.post(`/presales/requirements/${selected.id}/close`, {
          status: 'LOST',
          reason: actionContent.trim(),
        });
        toast.success('需求单已标记为丢单');
      }
      setActionMode(null);
      setSelected(null);
      await fetchRequirements();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-black text-slate-900 sm:text-3xl">
            <ClipboardList className="h-7 w-7 text-blue-600" />
            客户需求
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            记录咨询、责任人、下一次跟进和成单结果；当前活跃 {activeCount} 项。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> 新建客户需求
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">搜索客户需求</span>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索单号、客户或摘要"
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
          />
        </label>
        <select
          aria-label="需求状态"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          {STATUS_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void fetchRequirements()}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium"
        >
          刷新
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="flex items-center gap-2 p-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在加载客户需求...
          </div>
        ) : requirements.length === 0 ? (
          <div className="p-10 text-sm text-slate-500">
            暂无客户需求，可从右上角创建第一条记录。
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {requirements.map((item) => (
              <article key={item.id} className="p-4 sm:p-5">
                <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-blue-700">
                        {item.requirementNo}
                      </span>
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-bold ${statusClass(item.status)}`}
                      >
                        {item.status}
                      </span>
                      <span className="text-xs text-slate-500">
                        {item.sourceChannel}
                      </span>
                    </div>
                    <h2 className="mt-2 font-semibold text-slate-900">
                      {item.partner?.name ?? '未命名客户'}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {item.summary}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      负责人：{item.owner?.name ?? '-'} · 下次跟进：
                      {dateLabel(item.nextFollowUpAt)}
                    </p>
                  </div>
                  {!['LOST', 'CANCELLED', 'CONVERTED'].includes(
                    item.status,
                  ) && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openAction(item, 'follow-up')}
                        className="rounded-lg border border-blue-200 px-3 py-1.5 text-sm font-medium text-blue-700"
                      >
                        添加跟进
                      </button>
                      <button
                        type="button"
                        onClick={() => openAction(item, 'close')}
                        className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-700"
                      >
                        标记丢单
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <Sheet
        open={createOpen}
        title="新建客户需求"
        onClose={() => setCreateOpen(false)}
      >
        <div className="space-y-4">
          <FormField label="客户">
            <AsyncSelect
              id="requirement-partner"
              value={partnerId}
              reference={{
                model: 'partner',
                labelField: 'name',
                valueField: 'id',
              }}
              onChange={setPartnerId}
              placeholder="搜索并选择客户"
            />
          </FormField>
          <FormField label="来源渠道" htmlFor="requirement-source">
            <input
              id="requirement-source"
              value={sourceChannel}
              onChange={(event) => setSourceChannel(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </FormField>
          <FormField label="需求摘要" htmlFor="requirement-summary">
            <textarea
              id="requirement-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={5}
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </FormField>
          <FormField label="预计金额" htmlFor="requirement-amount">
            <input
              id="requirement-amount"
              type="number"
              min="0"
              value={estimatedAmount}
              onChange={(event) => setEstimatedAmount(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="预计成交日期" htmlFor="requirement-close-date">
              <input
                id="requirement-close-date"
                type="date"
                value={expectedCloseDate}
                onChange={(event) => setExpectedCloseDate(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </FormField>
            <FormField label="下一次跟进" htmlFor="requirement-follow-up-at">
              <input
                id="requirement-follow-up-at"
                type="datetime-local"
                value={nextFollowUpAt}
                onChange={(event) => setNextFollowUpAt(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </FormField>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submitCreate()}
            className="w-full rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
          >
            {saving ? '正在创建...' : '创建需求单'}
          </button>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(actionMode && selected)}
        title={actionMode === 'close' ? '标记丢单' : '添加跟进'}
        onClose={() => setActionMode(null)}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            {selected?.requirementNo} · {selected?.partner?.name}
          </p>
          <FormField
            label={actionMode === 'close' ? '丢单原因' : '跟进内容'}
            htmlFor="requirement-action-content"
          >
            <textarea
              id="requirement-action-content"
              value={actionContent}
              onChange={(event) => setActionContent(event.target.value)}
              rows={6}
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </FormField>
          {actionMode === 'follow-up' && (
            <FormField label="下一次跟进" htmlFor="action-next-follow-up">
              <input
                id="action-next-follow-up"
                type="datetime-local"
                value={actionNextFollowUpAt}
                onChange={(event) =>
                  setActionNextFollowUpAt(event.target.value)
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </FormField>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => void submitAction()}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
          >
            {saving ? '正在保存...' : '确认保存'}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5" htmlFor={htmlFor}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
