'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Factory,
  Loader2,
  PackageCheck,
  PlusCircle,
  ShoppingCart,
} from 'lucide-react';
import api from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type WorkOrder = {
  id: string;
  workOrderNo: string;
  plannedQty: number;
  actualQty: number;
  status: string;
  order?: {
    orderNo?: string;
    partner?: { name?: string };
  };
  engineeringRevisionPins?: Array<{
    engineeringRevision: {
      id: string;
      revisionNo: number;
      status: string;
      engineeringDocument: {
        documentNo: string;
        title: string;
      };
    };
  }>;
};

type ReleasedEngineeringDocument = {
  id: string;
  documentNo: string;
  title: string;
  product?: { id: string; sku: string; name: string } | null;
  currentReleasedRevision: {
    id: string;
    revisionNo: number;
    status: string;
    fileRecord: { fileName: string };
  };
};

type SalesOrder = {
  id: string;
  orderNo: string;
  status: string;
  partner?: { name?: string };
};

type Location = {
  id: string;
  name: string;
  code?: string | null;
};

type SupplierOption = {
  id: string;
  code?: string | null;
  name: string;
};

type ReportDraft = {
  goodQty: number;
  defectQty: number;
  sourceLocationId: string;
  destLocationId: string;
  batchNo: string;
};

type MaterialAvailabilitySource = {
  workOrderId: string;
  workOrderNo: string;
  productSku?: string | null;
  productName: string;
  orderNo?: string | null;
  customerName?: string | null;
  openQty: number;
  requiredQty: number;
};

type MaterialAvailabilityIncomingSource = {
  purchaseOrderId: string;
  purchaseNo: string;
  supplierName?: string | null;
  status: string;
  expectedDate?: string | null;
  orderedQty: number;
  receivedQty: number;
  incomingQty: number;
};

type MaterialAvailabilityRow = {
  materialId: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  requiredQty: number;
  onHandQty: number;
  incomingQty: number;
  projectedQty: number;
  shortageQty: number;
  suggestedPurchaseQty: number;
  unitPrice: number;
  estimatedAmount: number;
  coveragePct: number;
  status: 'AVAILABLE' | 'SHORTAGE';
  affectedWorkOrders: MaterialAvailabilitySource[];
  incomingSources: MaterialAvailabilityIncomingSource[];
};

type MaterialAvailabilityMissingBom = {
  workOrderId: string;
  workOrderNo: string;
  productSku?: string | null;
  productName: string;
  openQty: number;
  reason: string;
};

type MaterialAvailabilityData = {
  rows: MaterialAvailabilityRow[];
  shortageCount: number;
  totalOpenWorkOrders: number;
  missingBomWorkOrders: MaterialAvailabilityMissingBom[];
};

const statuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED'];
const emptyMaterialAvailability: MaterialAvailabilityData = {
  rows: [],
  shortageCount: 0,
  totalOpenWorkOrders: 0,
  missingBomWorkOrders: [],
};

function statusLabel(status: string, t: ReturnType<typeof useI18n>['t']) {
  if (status === 'PENDING') return t('productionStatusPending');
  if (status === 'IN_PROGRESS') return t('productionStatusInProgress');
  if (status === 'COMPLETED') return t('productionStatusCompleted');
  return status;
}

export function ProductionWorkbench() {
  const { t } = useI18n();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [selectedSalesOrderId, setSelectedSalesOrderId] = useState('');
  const [releasedDocuments, setReleasedDocuments] = useState<
    ReleasedEngineeringDocument[]
  >([]);
  const [selectedRevisionIds, setSelectedRevisionIds] = useState<string[]>([]);
  const [loadingEngineeringDocs, setLoadingEngineeringDocs] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [materialAvailability, setMaterialAvailability] =
    useState<MaterialAvailabilityData>(emptyMaterialAvailability);
  const [drafts, setDrafts] = useState<Record<string, ReportDraft>>({});
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [creatingPurchaseOrder, setCreatingPurchaseOrder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [ordersResp, locationsResp, availabilityResp] =
        await Promise.all([
          api.get('/production/orders', { params: { page: 1, limit: 100 } }),
          api.get('/inventory/locations'),
          api.get('/production/material-availability'),
        ]);
      setOrders((ordersResp.data?.data as WorkOrder[]) ?? []);
      setLocations((locationsResp.data as Location[]) ?? []);
      setMaterialAvailability(
        (availabilityResp.data as MaterialAvailabilityData) ??
          emptyMaterialAvailability,
      );
      const salesResp = await api.get('/orders', {
        params: { page: 1, limit: 100 },
      });
      const nextSalesOrders = (
        (salesResp.data?.data as SalesOrder[]) ?? []
      ).filter((order) => !['CANCELLED', 'COMPLETED'].includes(order.status));
      setSalesOrders(nextSalesOrders);
      setSelectedSalesOrderId((prev) => prev || nextSalesOrders[0]?.id || '');
      try {
        const suppliersResp = await api.get('/purchase/supplier-options');
        const nextSuppliers = (suppliersResp.data as SupplierOption[]) ?? [];
        setSuppliers(nextSuppliers);
        setSelectedSupplierId((prev) =>
          nextSuppliers.some((supplier) => supplier.id === prev)
            ? prev
            : nextSuppliers[0]?.id || '',
        );
      } catch {
        setSuppliers([]);
        setSelectedSupplierId('');
      }
    } catch (reason) {
      const message =
        reason && typeof reason === 'object' && 'response' in reason
          ? (reason as { response?: { data?: { message?: string } } }).response
              ?.data?.message
          : undefined;
      setError(message || t('productionLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedSalesOrderId) {
      setReleasedDocuments([]);
      setSelectedRevisionIds([]);
      return;
    }
    let cancelled = false;
    const loadReleasedDocuments = async () => {
      setLoadingEngineeringDocs(true);
      try {
        const response = await api.get<ReleasedEngineeringDocument[]>(
          `/engineering-documents/released-for-order/${selectedSalesOrderId}`,
        );
        if (cancelled) return;
        setReleasedDocuments(response.data);
        setSelectedRevisionIds(
          response.data.map((document) => document.currentReleasedRevision.id),
        );
      } catch (reason) {
        if (cancelled) return;
        setReleasedDocuments([]);
        setSelectedRevisionIds([]);
        const message =
          reason && typeof reason === 'object' && 'response' in reason
            ? (reason as { response?: { data?: { message?: string } } })
                .response?.data?.message
            : undefined;
        setError(message || '已发布工程版本加载失败');
      } finally {
        if (!cancelled) setLoadingEngineeringDocs(false);
      }
    };
    void loadReleasedDocuments();
    return () => {
      cancelled = true;
    };
  }, [selectedSalesOrderId]);

  const grouped = useMemo(() => {
    return statuses.map((status) => ({
      status,
      items: orders.filter((order) => order.status === status),
    }));
  }, [orders]);

  const shortageRows = useMemo(
    () =>
      materialAvailability.rows.filter(
        (row) => row.status === 'SHORTAGE' && row.shortageQty > 0,
      ),
    [materialAvailability.rows],
  );

  const readDraft = (id: string): ReportDraft =>
    drafts[id] ?? {
      goodQty: 1,
      defectQty: 0,
      sourceLocationId: '',
      destLocationId: '',
      batchNo: '',
    };

  const updateDraft = (id: string, patch: Partial<ReportDraft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...readDraft(id), ...patch } }));
  };

  const generateWorkOrders = async () => {
    if (!selectedSalesOrderId) return;
    try {
      setGenerating(true);
      setError(null);
      setMessage(null);
      const response = await api.post(
        `/production/orders/from-sales-order/${selectedSalesOrderId}`,
        {
          skipExisting: true,
          engineeringRevisionIds: selectedRevisionIds,
        },
      );
      const createdCount = Number(response.data?.created?.length ?? 0);
      const skippedCount = Number(response.data?.skipped?.length ?? 0);
      setMessage(
        `${t('productionGeneratedCount')}: ${createdCount}; ${t(
          'productionSkippedCount',
        )}: ${skippedCount}`,
      );
      await load();
    } catch (reason) {
      const message =
        reason && typeof reason === 'object' && 'response' in reason
          ? (reason as { response?: { data?: { message?: string } } }).response
              ?.data?.message
          : undefined;
      setError(message || t('productionGenerateFailed'));
    } finally {
      setGenerating(false);
    }
  };

  const submitReport = async (order: WorkOrder) => {
    const draft = readDraft(order.id);
    try {
      setSubmittingId(order.id);
      setError(null);
      await api.post(`/production/orders/${order.id}/report`, {
        goodQty: Number(draft.goodQty || 0),
        defectQty: Number(draft.defectQty || 0),
        sourceLocationId: draft.sourceLocationId,
        destLocationId: draft.destLocationId,
        batchNo: draft.batchNo || undefined,
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[order.id];
        return next;
      });
      await load();
    } catch (reason) {
      const message =
        reason && typeof reason === 'object' && 'response' in reason
          ? (reason as { response?: { data?: { message?: string } } }).response
              ?.data?.message
          : undefined;
      setError(message || t('productionReportFailed'));
    } finally {
      setSubmittingId(null);
    }
  };

  const createPurchaseOrderFromShortages = async () => {
    if (!selectedSupplierId || shortageRows.length === 0) return;
    try {
      setCreatingPurchaseOrder(true);
      setError(null);
      setMessage(null);
      const response = await api.post(
        '/production/material-availability/purchase-order',
        {
          supplierId: selectedSupplierId,
          materialIds: shortageRows.map((row) => row.materialId),
        },
      );
      const purchaseNo = String(response.data?.purchaseNo ?? '');
      setMessage(
        purchaseNo
          ? `${t('productionPurchaseOrderCreated')}: ${purchaseNo}`
          : t('productionPurchaseOrderCreated'),
      );
      await load();
    } catch (reason) {
      const message =
        reason && typeof reason === 'object' && 'response' in reason
          ? (reason as { response?: { data?: { message?: string } } }).response
              ?.data?.message
          : undefined;
      setError(message || t('productionPurchaseOrderCreateFailed'));
    } finally {
      setCreatingPurchaseOrder(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-slate-500">{t('productionLoading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {t('productionWorkbench')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('productionWorkbenchHint')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {t('commonRefresh')}
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {t('productionGenerateFromOrder')}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {t('productionGenerateHint')}
            </p>
            <select
              value={selectedSalesOrderId}
              onChange={(event) => setSelectedSalesOrderId(event.target.value)}
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {salesOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNo} · {order.partner?.name || '-'} ·{' '}
                  {order.status}
                </option>
              ))}
            </select>
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-slate-700">
                  工单固定工程版本
                </p>
                <span className="text-xs text-slate-500">
                  已选 {selectedRevisionIds.length}/{releasedDocuments.length}
                </span>
              </div>
              {loadingEngineeringDocs ? (
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  加载已发布版本...
                </div>
              ) : releasedDocuments.length === 0 ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  当前订单没有适用的已发布工程图纸，需先在工程文档工作台完成校审和发布。
                </div>
              ) : (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {releasedDocuments.map((document) => {
                    const revisionId = document.currentReleasedRevision.id;
                    const checked = selectedRevisionIds.includes(revisionId);
                    return (
                      <label
                        key={document.id}
                        className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white p-2"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setSelectedRevisionIds((current) =>
                              event.target.checked
                                ? [...new Set([...current, revisionId])]
                                : current.filter((id) => id !== revisionId),
                            )
                          }
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-xs font-semibold text-blue-700">
                            {document.documentNo} · R
                            {String(
                              document.currentReleasedRevision.revisionNo,
                            ).padStart(2, '0')}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-slate-600">
                            {document.title}
                            {document.product
                              ? ` · ${document.product.sku}`
                              : ' · 订单级文档'}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void generateWorkOrders()}
            disabled={
              !selectedSalesOrderId ||
              selectedRevisionIds.length === 0 ||
              loadingEngineeringDocs ||
              generating
            }
            className="inline-flex items-center justify-center gap-2 self-end rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlusCircle className="h-4 w-4" />
            )}
            {t('productionGenerate')}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-900">
                {t('productionMaterialAvailability')}
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {t('productionMaterialAvailabilityHint')}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="font-semibold text-slate-900">
                {materialAvailability.totalOpenWorkOrders}
              </p>
              <p className="text-slate-500">{t('productionOpenOrders')}</p>
            </div>
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
              <p className="font-semibold text-red-700">
                {materialAvailability.shortageCount}
              </p>
              <p className="text-red-600">{t('productionMaterialShortage')}</p>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
              <p className="font-semibold text-amber-700">
                {materialAvailability.missingBomWorkOrders.length}
              </p>
              <p className="text-amber-700">
                {t('productionMaterialMissingBom')}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[1fr_auto]">
          <div>
            <label className="text-xs font-medium text-slate-600">
              {t('productionProcurementSupplier')}
            </label>
            <select
              value={selectedSupplierId}
              onChange={(event) => setSelectedSupplierId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              {suppliers.length === 0 ? (
                <option value="">{t('productionNoSupplierOptions')}</option>
              ) : null}
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.code ? `${supplier.code} · ` : ''}
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void createPurchaseOrderFromShortages()}
            disabled={
              !selectedSupplierId ||
              shortageRows.length === 0 ||
              creatingPurchaseOrder
            }
            className="inline-flex items-center justify-center gap-2 self-end rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {creatingPurchaseOrder ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShoppingCart className="h-4 w-4" />
            )}
            {t('productionCreatePurchaseOrder')}
          </button>
        </div>

        {materialAvailability.missingBomWorkOrders.length > 0 ? (
          <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800">
              <AlertTriangle className="h-4 w-4" />
              {t('productionMaterialMissingBom')}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {materialAvailability.missingBomWorkOrders.map((item) => (
                <div
                  key={item.workOrderId}
                  className="rounded-md bg-white px-3 py-2 text-xs text-amber-900"
                >
                  <p className="font-mono font-semibold">{item.workOrderNo}</p>
                  <p className="mt-1 truncate">
                    {item.productSku ? `${item.productSku} · ` : ''}
                    {item.productName} · {t('productionOpenQty')}:{' '}
                    {item.openQty}
                  </p>
                  <p className="mt-1 text-amber-700">{item.reason}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {materialAvailability.rows.length > 0 ? (
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {materialAvailability.rows.map((row) => (
              <article
                key={row.materialId}
                className="rounded-lg border border-slate-200 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {row.sku} · {row.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {row.category} · {row.unit}
                    </p>
                  </div>
                  <span
                    className={
                      row.status === 'SHORTAGE'
                        ? 'rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700'
                        : 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700'
                    }
                  >
                    {row.status === 'SHORTAGE'
                      ? t('productionMaterialShortage')
                      : t('productionMaterialAllClear')}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div>
                    <p className="text-slate-500">
                      {t('productionRequiredQty')}
                    </p>
                    <p className="font-semibold text-slate-900">
                      {row.requiredQty}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">
                      {t('productionOnHandQty')}
                    </p>
                    <p className="font-semibold text-slate-900">
                      {row.onHandQty}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">
                      {t('productionIncomingQty')}
                    </p>
                    <p className="font-semibold text-slate-900">
                      {row.incomingQty}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">
                      {t('productionShortageQty')}
                    </p>
                    <p
                      className={
                        row.shortageQty > 0
                          ? 'font-semibold text-red-700'
                          : 'font-semibold text-emerald-700'
                      }
                    >
                      {row.shortageQty}
                    </p>
                  </div>
                </div>

                {row.status === 'SHORTAGE' ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-md bg-red-50 px-3 py-2 text-xs">
                    <div>
                      <p className="text-red-600">
                        {t('productionSuggestedPurchaseQty')}
                      </p>
                      <p className="font-semibold text-red-800">
                        {row.suggestedPurchaseQty}
                      </p>
                    </div>
                    <div>
                      <p className="text-red-600">
                        {t('productionEstimatedAmount')}
                      </p>
                      <p className="font-semibold text-red-800">
                        {row.estimatedAmount}
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="mt-3">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>{t('productionMaterialCoverage')}</span>
                    <span>
                      {row.coveragePct}% · {t('productionProjectedQty')}{' '}
                      {row.projectedQty}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100">
                    <div
                      className={
                        row.status === 'SHORTAGE'
                          ? 'h-2 rounded-full bg-red-500'
                          : 'h-2 rounded-full bg-emerald-500'
                      }
                      style={{ width: `${row.coveragePct}%` }}
                    />
                  </div>
                </div>

                {row.incomingSources.length > 0 ? (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs font-medium text-slate-700">
                      {t('productionIncomingSources')}
                    </p>
                    {row.incomingSources.slice(0, 3).map((source) => (
                      <div
                        key={`${row.materialId}-${source.purchaseOrderId}`}
                        className="flex items-center justify-between gap-2 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800"
                      >
                        <span className="truncate">
                          {source.purchaseNo} · {source.supplierName || '-'} ·{' '}
                          {source.status}
                        </span>
                        <span className="shrink-0">
                          {t('productionIncomingQty')}: {source.incomingQty}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 space-y-1">
                  <p className="text-xs font-medium text-slate-700">
                    {t('productionMaterialAffectedOrders')}
                  </p>
                  {row.affectedWorkOrders.slice(0, 3).map((source) => (
                    <div
                      key={`${row.materialId}-${source.workOrderId}`}
                      className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600"
                    >
                      <span className="truncate">
                        {source.workOrderNo} · {source.productName}
                      </span>
                      <span className="shrink-0">
                        {t('productionRequiredQty')}: {source.requiredQty}
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-400">
            {t('productionMaterialNoDemand')}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        {grouped.map((group) => (
          <section
            key={group.status}
            className="min-h-[420px] rounded-xl border border-slate-200 bg-slate-50 p-3"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Factory className="h-4 w-4 text-slate-500" />
                <h2 className="text-sm font-semibold text-slate-800">
                  {statusLabel(group.status, t)}
                </h2>
              </div>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">
                {group.items.length}
              </span>
            </div>

            <div className="space-y-3">
              {group.items.map((order) => {
                const draft = readDraft(order.id);
                const progress =
                  order.plannedQty > 0
                    ? Math.min(
                        100,
                        Math.round((order.actualQty / order.plannedQty) * 100),
                      )
                    : 0;
                return (
                  <article
                    key={order.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-sm font-semibold text-slate-900">
                          {order.workOrderNo}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {order.order?.orderNo || '-'} ·{' '}
                          {order.order?.partner?.name || '-'}
                        </p>
                      </div>
                      {order.status === 'COMPLETED' ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <PackageCheck className="h-5 w-5 text-blue-500" />
                      )}
                    </div>

                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>{t('productionProgress')}</span>
                        <span>
                          {order.actualQty}/{order.plannedQty}
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-blue-600"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    {order.engineeringRevisionPins?.length ? (
                      <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-2">
                        <p className="text-[11px] font-semibold text-blue-800">
                          固定工程版本
                        </p>
                        <div className="mt-1 space-y-1">
                          {order.engineeringRevisionPins.map((pin) => (
                            <p
                              key={pin.engineeringRevision.id}
                              className="truncate font-mono text-[11px] text-blue-700"
                            >
                              {pin.engineeringRevision.engineeringDocument.documentNo}
                              {' · R'}
                              {String(pin.engineeringRevision.revisionNo).padStart(
                                2,
                                '0',
                              )}{' '}
                              · {pin.engineeringRevision.engineeringDocument.title}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {order.status !== 'COMPLETED' ? (
                      <div className="mt-3 grid gap-2 text-xs">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="space-y-1">
                            <span className="text-slate-500">
                              {t('productionGoodQty')}
                            </span>
                            <input
                              type="number"
                              min={0}
                              value={draft.goodQty}
                              onChange={(event) =>
                                updateDraft(order.id, {
                                  goodQty: Number(event.target.value),
                                })
                              }
                              className="w-full rounded border border-slate-200 px-2 py-1"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-slate-500">
                              {t('productionDefectQty')}
                            </span>
                            <input
                              type="number"
                              min={0}
                              value={draft.defectQty}
                              onChange={(event) =>
                                updateDraft(order.id, {
                                  defectQty: Number(event.target.value),
                                })
                              }
                              className="w-full rounded border border-slate-200 px-2 py-1"
                            />
                          </label>
                        </div>

                        <label className="space-y-1">
                          <span className="text-slate-500">
                            {t('productionSourceLocation')}
                          </span>
                          <select
                            value={draft.sourceLocationId}
                            onChange={(event) =>
                              updateDraft(order.id, {
                                sourceLocationId: event.target.value,
                              })
                            }
                            className="w-full rounded border border-slate-200 px-2 py-1"
                          >
                            <option value="">{t('selectPlaceholder')}</option>
                            {locations.map((location) => (
                              <option key={location.id} value={location.id}>
                                {location.code ? `${location.code} · ` : ''}
                                {location.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="text-slate-500">
                            {t('productionDestLocation')}
                          </span>
                          <select
                            value={draft.destLocationId}
                            onChange={(event) =>
                              updateDraft(order.id, {
                                destLocationId: event.target.value,
                              })
                            }
                            className="w-full rounded border border-slate-200 px-2 py-1"
                          >
                            <option value="">{t('selectPlaceholder')}</option>
                            {locations.map((location) => (
                              <option key={location.id} value={location.id}>
                                {location.code ? `${location.code} · ` : ''}
                                {location.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="text-slate-500">
                            {t('productionBatchNo')}
                          </span>
                          <input
                            value={draft.batchNo}
                            onChange={(event) =>
                              updateDraft(order.id, {
                                batchNo: event.target.value,
                              })
                            }
                            className="w-full rounded border border-slate-200 px-2 py-1"
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => void submitReport(order)}
                          disabled={submittingId === order.id}
                          className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                          {submittingId === order.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          {t('productionSubmitReport')}
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}

              {group.items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-center text-sm text-slate-400">
                  {t('productionNoOrders')}
                </div>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
