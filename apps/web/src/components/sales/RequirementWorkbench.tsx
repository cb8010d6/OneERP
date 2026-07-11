'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  FilePlus2,
  Loader2,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
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
  quotes?: Array<{
    id: string;
    quoteNo: string;
    currentVersionNo: number;
    versions: Array<{
      id: string;
      versionNo: number;
      status: string;
      currencyCode: string;
      total: string | number;
      validUntil: string;
    }>;
  }>;
}

interface QuoteItemDraft {
  rowId: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
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

let quoteItemSequence = 0;

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
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteRequirement, setQuoteRequirement] =
    useState<RequirementListItem | null>(null);
  const [quoteValidUntil, setQuoteValidUntil] = useState('');
  const [quotePaymentTerms, setQuotePaymentTerms] = useState('');
  const [quoteDeliveryTerms, setQuoteDeliveryTerms] = useState('');
  const [quoteItems, setQuoteItems] = useState<QuoteItemDraft[]>([
    createQuoteItemDraft(),
  ]);
  const [quoteActionBusy, setQuoteActionBusy] = useState<string | null>(null);

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

  const openQuote = (item: RequirementListItem) => {
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 14);
    setQuoteRequirement(item);
    setQuoteValidUntil(validUntil.toISOString().slice(0, 10));
    setQuotePaymentTerms('');
    setQuoteDeliveryTerms('');
    setQuoteItems([createQuoteItemDraft()]);
    setQuoteOpen(true);
  };

  const updateQuoteItem = (rowId: string, patch: Partial<QuoteItemDraft>) => {
    setQuoteItems((items) =>
      items.map((item) =>
        item.rowId === rowId ? { ...item, ...patch } : item,
      ),
    );
  };

  const quoteTotal = useMemo(
    () =>
      quoteItems.reduce((sum, item) => {
        const quantity = Number(item.quantity);
        const unitPrice = Number(item.unitPrice);
        const taxRate = Number(item.taxRate || 0) / 100;
        if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice))
          return sum;
        return sum + quantity * unitPrice * (1 + taxRate);
      }, 0),
    [quoteItems],
  );

  const submitQuote = async () => {
    if (!quoteRequirement || !quoteValidUntil) {
      toast.error('请选择报价有效期');
      return;
    }
    const invalidItem = quoteItems.some(
      (item) =>
        !item.productId ||
        Number(item.quantity) <= 0 ||
        Number(item.unitPrice) < 0 ||
        Number(item.taxRate || 0) < 0 ||
        Number(item.taxRate || 0) > 100,
    );
    if (invalidItem) {
      toast.error('请完整填写产品、数量、单价和税率');
      return;
    }

    setSaving(true);
    try {
      await api.post(`/presales/requirements/${quoteRequirement.id}/quotes`, {
        currencyCode: 'CNY',
        validUntil: new Date(`${quoteValidUntil}T23:59:59`).toISOString(),
        paymentTerms: quotePaymentTerms.trim() || undefined,
        deliveryTerms: quoteDeliveryTerms.trim() || undefined,
        items: quoteItems.map((item) => ({
          productId: item.productId,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          taxRate: Number(item.taxRate || 0) / 100,
        })),
      });
      toast.success('报价 V1 已创建');
      setQuoteOpen(false);
      setQuoteRequirement(null);
      await fetchRequirements();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '报价创建失败');
    } finally {
      setSaving(false);
    }
  };

  const runQuoteAction = async (
    quoteId: string,
    versionId: string,
    action: 'send' | 'new-version' | 'accept' | 'reject',
  ) => {
    setQuoteActionBusy(`${versionId}:${action}`);
    try {
      if (action === 'send') {
        await api.post(`/presales/quotes/versions/${versionId}/send`);
        toast.success('报价已发出');
      } else if (action === 'new-version') {
        await api.post(`/presales/quotes/${quoteId}/versions`, {});
        toast.success('新报价版本已创建');
      } else {
        await api.post(`/presales/quotes/versions/${versionId}/decision`, {
          status: action === 'accept' ? 'ACCEPTED' : 'REJECTED',
        });
        toast.success(
          action === 'accept' ? '已记录客户接受' : '已记录客户拒绝',
        );
      }
      await fetchRequirements();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '报价操作失败');
    } finally {
      setQuoteActionBusy(null);
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
                    {item.quotes?.[0]?.versions?.[0] ? (
                      <QuoteSummary
                        quote={item.quotes[0]}
                        busyKey={quoteActionBusy}
                        onAction={runQuoteAction}
                      />
                    ) : null}
                  </div>
                  {!['LOST', 'CANCELLED', 'CONVERTED'].includes(
                    item.status,
                  ) && (
                    <div className="flex gap-2">
                      {!item.quotes?.length ? (
                        <button
                          type="button"
                          onClick={() => openQuote(item)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-1.5 text-sm font-medium text-emerald-700"
                        >
                          <FilePlus2 className="h-4 w-4" /> 创建报价
                        </button>
                      ) : null}
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
        open={quoteOpen}
        title="创建报价 V1"
        onClose={() => setQuoteOpen(false)}
      >
        <div className="space-y-5">
          <div className="border-b border-slate-200 pb-4">
            <p className="font-mono text-sm font-bold text-blue-700">
              {quoteRequirement?.requirementNo}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {quoteRequirement?.partner?.name}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              客户与负责人将从需求单固化，报价创建后不能通过界面覆盖。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="币种">
              <input
                value="CNY"
                disabled
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600"
              />
            </FormField>
            <FormField label="有效期" htmlFor="quote-valid-until">
              <input
                id="quote-valid-until"
                type="date"
                value={quoteValidUntil}
                onChange={(event) => setQuoteValidUntil(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </FormField>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">报价明细</h3>
              <button
                type="button"
                onClick={() =>
                  setQuoteItems((items) => [...items, createQuoteItemDraft()])
                }
                className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700"
              >
                <Plus className="h-4 w-4" /> 添加一行
              </button>
            </div>
            {quoteItems.map((item, index) => (
              <div
                key={item.rowId}
                className="space-y-3 border-t border-slate-200 pt-3 first:border-t-0 first:pt-0"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">
                    明细 {index + 1}
                  </span>
                  {quoteItems.length > 1 ? (
                    <button
                      type="button"
                      title="删除明细"
                      onClick={() =>
                        setQuoteItems((items) =>
                          items.filter(
                            (candidate) => candidate.rowId !== item.rowId,
                          ),
                        )
                      }
                      className="text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                <FormField label="产品">
                  <AsyncSelect
                    id={`quote-product-${item.rowId}`}
                    value={item.productId}
                    reference={{
                      model: 'product',
                      labelField: 'name',
                      valueField: 'id',
                    }}
                    onChange={(productId) =>
                      updateQuoteItem(item.rowId, { productId })
                    }
                    onSelectRecord={(record) =>
                      updateQuoteItem(item.rowId, {
                        unitPrice: String(record.listPrice ?? item.unitPrice),
                      })
                    }
                    placeholder="搜索产品或 SKU"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </FormField>
                <div className="grid grid-cols-3 gap-3">
                  <FormField label="数量" htmlFor={`quote-qty-${item.rowId}`}>
                    <input
                      id={`quote-qty-${item.rowId}`}
                      type="number"
                      min="0.0001"
                      step="0.0001"
                      value={item.quantity}
                      onChange={(event) =>
                        updateQuoteItem(item.rowId, {
                          quantity: event.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </FormField>
                  <FormField label="单价" htmlFor={`quote-price-${item.rowId}`}>
                    <input
                      id={`quote-price-${item.rowId}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(event) =>
                        updateQuoteItem(item.rowId, {
                          unitPrice: event.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </FormField>
                  <FormField label="税率 %" htmlFor={`quote-tax-${item.rowId}`}>
                    <input
                      id={`quote-tax-${item.rowId}`}
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={item.taxRate}
                      onChange={(event) =>
                        updateQuoteItem(item.rowId, {
                          taxRate: event.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </FormField>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="付款条款" htmlFor="quote-payment-terms">
              <textarea
                id="quote-payment-terms"
                rows={3}
                value={quotePaymentTerms}
                onChange={(event) => setQuotePaymentTerms(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </FormField>
            <FormField label="交付条款" htmlFor="quote-delivery-terms">
              <textarea
                id="quote-delivery-terms"
                rows={3}
                value={quoteDeliveryTerms}
                onChange={(event) => setQuoteDeliveryTerms(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </FormField>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <div>
              <p className="text-xs text-slate-500">预计含税总额</p>
              <p className="text-xl font-black text-slate-900">
                CNY{' '}
                {quoteTotal.toLocaleString('zh-CN', {
                  minimumFractionDigits: 2,
                })}
              </p>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submitQuote()}
              className="rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50"
            >
              {saving ? '正在创建...' : '创建报价 V1'}
            </button>
          </div>
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

function createQuoteItemDraft(): QuoteItemDraft {
  quoteItemSequence += 1;
  return {
    rowId: `quote-item-${quoteItemSequence}`,
    productId: '',
    quantity: '1',
    unitPrice: '',
    taxRate: '0',
  };
}

function QuoteSummary({
  quote,
  busyKey,
  onAction,
}: {
  quote: NonNullable<RequirementListItem['quotes']>[number];
  busyKey: string | null;
  onAction: (
    quoteId: string,
    versionId: string,
    action: 'send' | 'new-version' | 'accept' | 'reject',
  ) => Promise<void>;
}) {
  const version = quote.versions[0];
  if (!version) return null;
  const isBusy = busyKey?.startsWith(`${version.id}:`) ?? false;
  const canCreateVersion = ['SENT', 'REJECTED', 'EXPIRED'].includes(
    version.status,
  );

  return (
    <div className="mt-3 space-y-2 border-l-2 border-emerald-500 pl-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono font-bold text-emerald-700">
          {quote.quoteNo}
        </span>
        <span className="font-semibold text-slate-700">
          V{version.versionNo} · {version.status}
        </span>
        <span className="text-slate-500">
          {version.currencyCode}{' '}
          {Number(version.total).toLocaleString('zh-CN', {
            minimumFractionDigits: 2,
          })}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {version.status === 'DRAFT' ? (
          <QuoteActionButton
            label="发出报价"
            disabled={isBusy}
            onClick={() => void onAction(quote.id, version.id, 'send')}
          />
        ) : null}
        {canCreateVersion ? (
          <QuoteActionButton
            label="新建版本"
            disabled={isBusy}
            onClick={() => void onAction(quote.id, version.id, 'new-version')}
          />
        ) : null}
        {version.status === 'SENT' ? (
          <>
            <QuoteActionButton
              label="客户接受"
              disabled={isBusy}
              onClick={() => void onAction(quote.id, version.id, 'accept')}
            />
            <QuoteActionButton
              label="客户拒绝"
              disabled={isBusy}
              danger
              onClick={() => void onAction(quote.id, version.id, 'reject')}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function QuoteActionButton({
  label,
  disabled,
  danger = false,
  onClick,
}: {
  label: string;
  disabled: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 font-semibold disabled:opacity-50 ${
        danger
          ? 'border-rose-200 text-rose-700'
          : 'border-emerald-200 text-emerald-700'
      }`}
    >
      {disabled ? '处理中...' : label}
    </button>
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
