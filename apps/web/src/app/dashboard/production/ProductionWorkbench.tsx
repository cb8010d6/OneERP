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

type MaterialAvailabilityRow = {
  materialId: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  requiredQty: number;
  onHandQty: number;
  shortageQty: number;
  coveragePct: number;
  status: 'AVAILABLE' | 'SHORTAGE';
  affectedWorkOrders: MaterialAvailabilitySource[];
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
  const [locations, setLocations] = useState<Location[]>([]);
  const [materialAvailability, setMaterialAvailability] =
    useState<MaterialAvailabilityData>(emptyMaterialAvailability);
  const [drafts, setDrafts] = useState<Record<string, ReportDraft>>({});
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [ordersResp, locationsResp, availabilityResp] = await Promise.all([
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

  const grouped = useMemo(() => {
    return statuses.map((status) => ({
      status,
      items: orders.filter((order) => order.status === status),
    }));
  }, [orders]);

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
        { skipExisting: true },
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
          </div>
          <button
            type="button"
            onClick={() => void generateWorkOrders()}
            disabled={!selectedSalesOrderId || generating}
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

                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
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

                <div className="mt-3">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>{t('productionMaterialCoverage')}</span>
                    <span>{row.coveragePct}%</span>
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
