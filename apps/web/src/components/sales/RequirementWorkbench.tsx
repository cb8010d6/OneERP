'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardList,
  FilePlus2,
  FileSignature,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
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
      contract?: {
        id: string;
        contractNo: string;
        status: string;
        currentVersionNo: number;
        signedFileId?: string | null;
        signedAt?: string | null;
        activatedAt?: string | null;
      } | null;
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

interface ContractOrderPreview {
  contractId: string;
  contractNo: string;
  status: string;
  items: Array<{
    quoteVersionItemId: string;
    productId: string;
    sku: string;
    name: string;
    uom: string;
    unitPrice: string | number;
    contractedQuantity: string | number;
    allocatedQuantity: string | number;
    remainingQuantity: string | number;
  }>;
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

export function requirementStatusLabel(status: string) {
  const labels: Record<string, string> = {
    DRAFT: '草稿',
    FOLLOWING: '跟进中',
    QUALIFIED: '已确认',
    QUOTING: '报价中',
    LOST: '已丢单',
    CANCELLED: '已取消',
    CONVERTED: '已转化',
  };
  return labels[status] ?? status;
}

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

export function RequirementWorkbench() {
  const [requirements, setRequirements] = useState<RequirementListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState('');
  const requestSequence = useRef(0);
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
  const currentCompanyId = useAuthStore((state) => state.currentCompanyId);
  const companies = useAuthStore((state) => state.companies);
  const permissions = useMemo(
    () => companies.find((company) => company.id === currentCompanyId)?.permissions ?? [],
    [companies, currentCompanyId],
  );
  const [contractOpen, setContractOpen] = useState(false);
  const [contractVersion, setContractVersion] = useState<{
    quoteNo: string;
    versionId: string;
    versionNo: number;
    total: string | number;
  } | null>(null);
  const [contractTitle, setContractTitle] = useState('');
  const [contractEffectiveAt, setContractEffectiveAt] = useState('');
  const [contractExpiresAt, setContractExpiresAt] = useState('');
  const [signOpen, setSignOpen] = useState(false);
  const [signContract, setSignContract] = useState<{
    id: string;
    contractNo: string;
  } | null>(null);
  const [signedFile, setSignedFile] = useState<File | null>(null);
  const [orderBatchOpen, setOrderBatchOpen] = useState(false);
  const [orderPreview, setOrderPreview] =
    useState<ContractOrderPreview | null>(null);
  const [orderBatchKey, setOrderBatchKey] = useState('');
  const [orderBatchQuantities, setOrderBatchQuantities] = useState<
    Record<string, string>
  >({});

  const fetchRequirements = useCallback(async () => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ page: '1', limit: '100' });
      if (searchQuery) params.set('search', searchQuery);
      if (status) params.set('status', status);
      const response = await api.get<RequirementListResponse>(
        `/presales/requirements?${params.toString()}`,
      );
      if (requestId !== requestSequence.current) return;
      setRequirements(response.data.data ?? []);
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setLoadError(
        error instanceof Error ? error.message : '客户需求单加载失败',
      );
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [searchQuery, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    void fetchRequirements();
  }, [fetchRequirements]);

  const refreshRequirements = () => {
    const nextSearch = searchInput.trim();
    if (nextSearch === searchQuery) {
      void fetchRequirements();
      return;
    }
    setSearchQuery(nextSearch);
  };

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

  const openContract = (quote: NonNullable<RequirementListItem['quotes']>[number]) => {
    const version = quote.versions[0];
    if (!version || version.status !== 'ACCEPTED' || version.contract) return;
    setContractVersion({
      quoteNo: quote.quoteNo,
      versionId: version.id,
      versionNo: version.versionNo,
      total: version.total,
    });
    setContractTitle(`${quote.quoteNo} 销售合同`);
    setContractEffectiveAt(new Date().toISOString().slice(0, 10));
    setContractExpiresAt('');
    setContractOpen(true);
  };

  const submitContract = async () => {
    if (!contractVersion || !contractTitle.trim()) {
      toast.error('请填写合同标题');
      return;
    }
    setQuoteActionBusy(`${contractVersion.versionId}:contract`);
    try {
      await api.post(
        `/presales/contracts/from-quote-version/${contractVersion.versionId}`,
        {
          title: contractTitle.trim(),
          effectiveAt: contractEffectiveAt || undefined,
          expiresAt: contractExpiresAt || undefined,
        },
      );
      toast.success('合同 V1 已登记');
      setContractOpen(false);
      setContractVersion(null);
      await fetchRequirements();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '合同登记失败');
    } finally {
      setQuoteActionBusy(null);
    }
  };

  const decideContract = async (
    contractId: string,
    stage: 'sales-manager' | 'finance' | 'business',
    decision: 'APPROVE' | 'REJECT',
  ) => {
    setQuoteActionBusy(`${contractId}:${stage}:${decision}`);
    try {
      await api.post(`/presales/contracts/${contractId}/${stage}/decision`, {
        decision,
        comment: decision === 'REJECT' ? '工作台审批退回' : undefined,
      });
      toast.success(decision === 'APPROVE' ? '合同审批已通过' : '合同已退回');
      await fetchRequirements();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '合同审批失败');
    } finally {
      setQuoteActionBusy(null);
    }
  };

  const submitContractApproval = async (contractId: string) => {
    setQuoteActionBusy(`${contractId}:submit`);
    try {
      await api.post(`/presales/contracts/${contractId}/submit`);
      toast.success('合同已提交销售主管审批');
      await fetchRequirements();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '合同提交失败');
    } finally {
      setQuoteActionBusy(null);
    }
  };

  const openContractSigning = (contract: {
    id: string;
    contractNo: string;
  }) => {
    setSignContract(contract);
    setSignedFile(null);
    setSignOpen(true);
  };

  const submitContractSigning = async () => {
    if (!signContract || !signedFile) {
      toast.error('请选择签署件');
      return;
    }
    setQuoteActionBusy(`${signContract.id}:sign`);
    try {
      const formData = new FormData();
      formData.append('file', signedFile);
      const upload = await api.post<{ id: string }>(
        '/files/upload?folder=contracts',
        formData,
      );
      await api.post(`/presales/contracts/${signContract.id}/sign`, {
        fileRecordId: upload.data.id,
      });
      toast.success('签署件已归档，合同已签署');
      setSignOpen(false);
      setSignContract(null);
      setSignedFile(null);
      await fetchRequirements();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '合同签署失败');
    } finally {
      setQuoteActionBusy(null);
    }
  };

  const activateContract = async (contractId: string) => {
    setQuoteActionBusy(`${contractId}:activate`);
    try {
      await api.post(`/presales/contracts/${contractId}/activate`);
      toast.success('合同已生效');
      await fetchRequirements();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '合同生效失败');
    } finally {
      setQuoteActionBusy(null);
    }
  };

  const openOrderBatch = async (contract: {
    id: string;
    contractNo: string;
  }) => {
    setQuoteActionBusy(`${contract.id}:preview`);
    try {
      const response = await api.get<ContractOrderPreview>(
        `/presales/contracts/${contract.id}/order-conversion-preview`,
      );
      const preview = response.data;
      setOrderPreview(preview);
      setOrderBatchKey(`${contract.contractNo}-BATCH-01`);
      setOrderBatchQuantities(
        Object.fromEntries(
          preview.items.map((item) => [
            item.quoteVersionItemId,
            String(item.remainingQuantity),
          ]),
        ),
      );
      setOrderBatchOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '转单信息加载失败');
    } finally {
      setQuoteActionBusy(null);
    }
  };

  const submitOrderBatch = async () => {
    if (!orderPreview || !orderBatchKey.trim()) {
      toast.error('请填写稳定批次键');
      return;
    }
    const items = orderPreview.items
      .map((item) => ({
        quoteVersionItemId: item.quoteVersionItemId,
        quantity: Number(orderBatchQuantities[item.quoteVersionItemId] ?? 0),
      }))
      .filter((item) => item.quantity > 0);
    if (!items.length || items.some((item) => !Number.isInteger(item.quantity))) {
      toast.error('请填写至少一条正整数转单数量');
      return;
    }
    setQuoteActionBusy(`${orderPreview.contractId}:order-batch`);
    try {
      const response = await api.post<{
        order: { orderNo: string };
        idempotentReplay: boolean;
      }>(`/presales/contracts/${orderPreview.contractId}/order-batches`, {
        sourceBatchKey: orderBatchKey.trim(),
        items,
      });
      toast.success(
        response.data.idempotentReplay
          ? `重复请求已返回原订单 ${response.data.order.orderNo}`
          : `销售订单 ${response.data.order.orderNo} 已创建`,
      );
      setOrderBatchOpen(false);
      setOrderPreview(null);
      await fetchRequirements();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '合同转单失败');
    } finally {
      setQuoteActionBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900 sm:text-2xl">
            <ClipboardList className="h-6 w-6 text-blue-600" />
            客户需求
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            记录咨询、责任人、下一次跟进和成单结果；当前活跃 {activeCount} 项。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white sm:w-auto"
        >
          <Plus className="h-4 w-4" /> 新建客户需求
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">搜索客户需求</span>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
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
          onClick={refreshRequirements}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium sm:w-auto"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {loadError ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>客户需求加载失败：{loadError}</span>
          <button
            type="button"
            onClick={() => void fetchRequirements()}
            className="self-start rounded-md border border-rose-200 bg-white px-3 py-1.5 font-semibold sm:self-auto"
          >
            重试
          </button>
        </div>
      ) : null}

      <div
        className="overflow-hidden rounded-xl border border-slate-200 bg-white"
        aria-busy={loading}
      >
        {loading ? (
          <div className="flex items-center gap-2 p-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在加载客户需求...
          </div>
        ) : loadError && requirements.length === 0 ? (
          <div className="p-8 text-sm text-slate-500">
            暂时无法显示客户需求，请重试。
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
                        {requirementStatusLabel(item.status)}
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
                        onCreateContract={openContract}
                        onDecideContract={decideContract}
                        onSubmitContract={submitContractApproval}
                        onSignContract={openContractSigning}
                        onActivateContract={activateContract}
                        onCreateOrderBatch={openOrderBatch}
                        permissions={permissions}
                      />
                    ) : null}
                  </div>
                  {!['LOST', 'CANCELLED', 'CONVERTED'].includes(
                    item.status,
                  ) && (
                    <div className="flex flex-wrap gap-2">
                      {!item.quotes?.length ? (
                        <button
                          type="button"
                          onClick={() => openQuote(item)}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-200 px-3 py-1.5 text-sm font-medium text-emerald-700 sm:flex-none"
                        >
                          <FilePlus2 className="h-4 w-4" /> 创建报价
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => openAction(item, 'follow-up')}
                        className="flex-1 whitespace-nowrap rounded-lg border border-blue-200 px-3 py-1.5 text-sm font-medium text-blue-700 sm:flex-none"
                      >
                        添加跟进
                      </button>
                      <button
                        type="button"
                        onClick={() => openAction(item, 'close')}
                        className="flex-1 whitespace-nowrap rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-700 sm:flex-none"
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
        closeLabel="关闭面板"
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
        closeLabel="关闭面板"
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

          <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
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
              className="w-full rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50 sm:w-auto"
            >
              {saving ? '正在创建...' : '创建报价 V1'}
            </button>
          </div>
        </div>
      </Sheet>

      <Sheet
        open={contractOpen}
        title="登记合同 V1"
        closeLabel="关闭面板"
        onClose={() => setContractOpen(false)}
      >
        <div className="space-y-5">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <p className="font-mono font-bold text-emerald-800">
              {contractVersion?.quoteNo} · V{contractVersion?.versionNo}
            </p>
            <p className="mt-1 text-emerald-900">
              CNY {Number(contractVersion?.total ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
            </p>
            <p className="mt-1 text-xs text-emerald-700">
              合同金额、币种和条款将从已接受报价版本固化。
            </p>
          </div>
          <FormField label="合同标题" htmlFor="contract-title">
            <input
              id="contract-title"
              value={contractTitle}
              onChange={(event) => setContractTitle(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="生效日期" htmlFor="contract-effective-at">
              <input
                id="contract-effective-at"
                type="date"
                value={contractEffectiveAt}
                onChange={(event) => setContractEffectiveAt(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </FormField>
            <FormField label="到期日期" htmlFor="contract-expires-at">
              <input
                id="contract-expires-at"
                type="date"
                value={contractExpiresAt}
                onChange={(event) => setContractExpiresAt(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </FormField>
          </div>
          <button
            type="button"
            disabled={Boolean(quoteActionBusy)}
            onClick={() => void submitContract()}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
          >
            {quoteActionBusy ? '正在登记...' : '登记合同 V1'}
          </button>
        </div>
      </Sheet>

      <Sheet
        open={signOpen}
        title="归档合同签署件"
        closeLabel="关闭面板"
        onClose={() => setSignOpen(false)}
      >
        <div className="space-y-5">
          <div className="border-b border-slate-200 pb-4">
            <p className="font-mono text-sm font-bold text-blue-700">
              {signContract?.contractNo}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              签署件将保存到公司文件库，并与此合同建立唯一关联。
            </p>
          </div>
          <FormField label="签署件" htmlFor="contract-signed-file">
            <input
              id="contract-signed-file"
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              onChange={(event) =>
                setSignedFile(event.target.files?.[0] ?? null)
              }
              className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </FormField>
          <button
            type="button"
            disabled={!signedFile || Boolean(quoteActionBusy)}
            onClick={() => void submitContractSigning()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
          >
            <FileSignature className="h-4 w-4" />
            {quoteActionBusy ? '正在归档...' : '确认签署并归档'}
          </button>
        </div>
      </Sheet>

      <Sheet
        open={orderBatchOpen}
        title="创建销售订单批次"
        closeLabel="关闭面板"
        onClose={() => setOrderBatchOpen(false)}
      >
        <div className="space-y-5">
          <div className="border-b border-slate-200 pb-4">
            <p className="font-mono text-sm font-bold text-blue-700">
              {orderPreview?.contractNo}
            </p>
          </div>
          <FormField label="稳定批次键" htmlFor="contract-order-batch-key">
            <input
              id="contract-order-batch-key"
              value={orderBatchKey}
              onChange={(event) => setOrderBatchKey(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
            />
          </FormField>
          <div className="space-y-3">
            {orderPreview?.items.map((item) => (
              <div
                key={item.quoteVersionItemId}
                className="grid gap-3 border-t border-slate-200 pt-3 sm:grid-cols-[1fr_150px]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {item.sku} · {item.name}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    合同 {item.contractedQuantity} · 已转 {item.allocatedQuantity}{' '}
                    · 剩余 {item.remainingQuantity} {item.uom}
                  </p>
                </div>
                <FormField
                  label="本批数量"
                  htmlFor={`order-batch-qty-${item.quoteVersionItemId}`}
                >
                  <input
                    id={`order-batch-qty-${item.quoteVersionItemId}`}
                    type="number"
                    min="0"
                    max={Number(item.remainingQuantity)}
                    step="1"
                    value={
                      orderBatchQuantities[item.quoteVersionItemId] ?? '0'
                    }
                    onChange={(event) =>
                      setOrderBatchQuantities((current) => ({
                        ...current,
                        [item.quoteVersionItemId]: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </FormField>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={Boolean(quoteActionBusy)}
            onClick={() => void submitOrderBatch()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
          >
            <ShoppingCart className="h-4 w-4" />
            {quoteActionBusy ? '正在创建...' : '创建销售订单'}
          </button>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(actionMode && selected)}
        title={actionMode === 'close' ? '标记丢单' : '添加跟进'}
        closeLabel="关闭面板"
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
  onCreateContract,
  onDecideContract,
  onSubmitContract,
  onSignContract,
  onActivateContract,
  onCreateOrderBatch,
  permissions,
}: {
  quote: NonNullable<RequirementListItem['quotes']>[number];
  busyKey: string | null;
  onAction: (
    quoteId: string,
    versionId: string,
    action: 'send' | 'new-version' | 'accept' | 'reject',
  ) => Promise<void>;
  onCreateContract: (quote: NonNullable<RequirementListItem['quotes']>[number]) => void;
  onDecideContract: (
    contractId: string,
    stage: 'sales-manager' | 'finance' | 'business',
    decision: 'APPROVE' | 'REJECT',
  ) => Promise<void>;
  onSubmitContract: (contractId: string) => Promise<void>;
  onSignContract: (contract: { id: string; contractNo: string }) => void;
  onActivateContract: (contractId: string) => Promise<void>;
  onCreateOrderBatch: (contract: { id: string; contractNo: string }) => void;
  permissions: string[];
}) {
  const version = quote.versions[0];
  if (!version) return null;
  const isBusy =
    busyKey?.startsWith(`${version.id}:`) ||
    (version.contract
      ? busyKey?.startsWith(`${version.contract.id}:`)
      : false) ||
    false;
  const canCreateVersion = ['SENT', 'REJECTED', 'EXPIRED'].includes(
    version.status,
  );
  const contract = version.contract;
  const can = (permission: string) =>
    permissions.includes('ALL') ||
    permissions.includes(permission) ||
    permissions.includes(permission.split(':')[0] + ':*');

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
        {version.status === 'ACCEPTED' && contract ? (
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-600">
            {contract.contractNo} · V{contract.currentVersionNo} · {contract.status}
          </span>
        ) : null}
        {version.status === 'ACCEPTED' && !contract ? (
          <QuoteActionButton
            label="登记合同 V1"
            disabled={isBusy}
            onClick={() => onCreateContract(quote)}
          />
        ) : null}
        {contract?.status === 'DRAFT' && can('contract:submit') ? (
          <QuoteActionButton
            label="提交审批"
            disabled={isBusy}
            onClick={() => void onSubmitContract(contract.id)}
          />
        ) : null}
        {contract?.status === 'PENDING_SALES_MANAGER' && can('contract:approve-sales') ? (
          <>
            <QuoteActionButton label="主管批准" disabled={isBusy} onClick={() => void onDecideContract(contract.id, 'sales-manager', 'APPROVE')} />
            <QuoteActionButton label="主管退回" danger disabled={isBusy} onClick={() => void onDecideContract(contract.id, 'sales-manager', 'REJECT')} />
          </>
        ) : null}
        {contract?.status === 'PENDING_FINANCE_REVIEW' && can('contract:review-finance') ? (
          <>
            <QuoteActionButton label="财务通过" disabled={isBusy} onClick={() => void onDecideContract(contract.id, 'finance', 'APPROVE')} />
            <QuoteActionButton label="财务退回" danger disabled={isBusy} onClick={() => void onDecideContract(contract.id, 'finance', 'REJECT')} />
          </>
        ) : null}
        {contract?.status === 'PENDING_BUSINESS_REVIEW' && can('contract:review-business') ? (
          <>
            <QuoteActionButton label="商务通过" disabled={isBusy} onClick={() => void onDecideContract(contract.id, 'business', 'APPROVE')} />
            <QuoteActionButton label="商务退回" danger disabled={isBusy} onClick={() => void onDecideContract(contract.id, 'business', 'REJECT')} />
          </>
        ) : null}
        {contract?.status === 'APPROVED' && can('contract:sign') ? (
          <QuoteActionButton
            label="上传签署件"
            disabled={isBusy}
            onClick={() =>
              onSignContract({ id: contract.id, contractNo: contract.contractNo })
            }
          />
        ) : null}
        {contract?.status === 'SIGNED' && can('contract:activate') ? (
          <QuoteActionButton
            label="生效合同"
            disabled={isBusy}
            onClick={() => void onActivateContract(contract.id)}
          />
        ) : null}
        {contract?.status === 'ACTIVE' && can('contract:convert-order') ? (
          <QuoteActionButton
            label="创建订单批次"
            disabled={isBusy}
            onClick={() =>
              onCreateOrderBatch({
                id: contract.id,
                contractNo: contract.contractNo,
              })
            }
          />
        ) : null}
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
