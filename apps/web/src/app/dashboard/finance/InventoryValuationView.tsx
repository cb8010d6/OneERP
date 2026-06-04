"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  ReceiptText,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import api from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type InventoryValuationRow = {
  materialId: string;
  sku: string;
  name: string;
  quantityOnHand: number;
  averageCost: number;
  inventoryValue: number;
};

type InventoryValuationResult = {
  asOfDate: string;
  inventoryAccount: {
    code: string;
    name: string;
    type: string;
  };
  inventoryValue: number;
  generalLedgerBalance: number;
  difference: number;
  reconciled: boolean;
  materialCount: number;
  rows: InventoryValuationRow[];
  diagnostics: {
    recentGeneralLedgerLines: Array<{
      journalEntryId: string;
      entryNo: string;
      date: string;
      ref: string | null;
      description: string | null;
      memo: string | null;
      debit: number;
      credit: number;
      balance: number;
    }>;
    pendingEvents: Array<{
      id: string;
      eventName: string;
      status: string;
      attempts: number;
      maxAttempts: number;
      nextRetryAt: string | null;
      updatedAt: string;
      error: string | null;
    }>;
    unpostedPurchaseInvoices: Array<{
      id: string;
      invoiceNo: string;
      purchaseOrderId: string;
      purchaseNo: string;
      supplierName: string;
      issuedDate: string;
      amount: number;
      postingStatus: string;
      matchStatus:
        | "PARTIAL_RECEIPT"
        | "OVER_RECEIPT"
        | "PRICE_VARIANCE"
        | "MATCHED";
      isPostable: boolean;
      matchReasons: string[];
      amountVariance: number;
    }>;
  };
};

type RetryResult = {
  total: number;
  results: Array<{ id: string; status: string; error?: string }>;
};

type BulkPostPayablesResult = {
  total: number;
  posted: number;
  failed: number;
  skipped: number;
  results: Array<{
    purchaseInvoiceId: string;
    status: "POSTED" | "SKIPPED" | "FAILED";
    invoiceNo?: string;
    message?: string;
    error?: string;
  }>;
};

type BulkPostAuditEvent = {
  id: string;
  createdAt: string;
  user?: { id: string; name?: string | null; email?: string | null } | null;
  details?: Partial<BulkPostPayablesResult> & {
    results?: BulkPostPayablesResult["results"];
  } | null;
};

type BulkPostAuditResponse = {
  events: BulkPostAuditEvent[];
};

type BulkPostAuditFilters = {
  status: "" | "POSTED" | "FAILED" | "SKIPPED";
  startDate: string;
  endDate: string;
  userId: string;
};

function money(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

function qty(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 4,
  }).format(value ?? 0);
}

function dateText(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function payableMatchLabel(
  status: InventoryValuationResult["diagnostics"]["unpostedPurchaseInvoices"][number]["matchStatus"],
  t: ReturnType<typeof useI18n>["t"],
) {
  if (status === "MATCHED") return t("inventoryValuationPayableMatched");
  if (status === "PRICE_VARIANCE")
    return t("inventoryValuationPayablePriceVariance");
  if (status === "OVER_RECEIPT")
    return t("inventoryValuationPayableOverReceipt");
  return t("inventoryValuationPayablePartialReceipt");
}

function bulkPostStatusLabel(
  status: BulkPostPayablesResult["results"][number]["status"],
  t: ReturnType<typeof useI18n>["t"],
) {
  if (status === "POSTED") return t("inventoryValuationPostStatusPosted");
  if (status === "FAILED") return t("inventoryValuationPostStatusFailed");
  return t("inventoryValuationPostStatusSkipped");
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportBulkPostAuditCsv(
  events: BulkPostAuditEvent[],
  t: ReturnType<typeof useI18n>["t"],
) {
  const headers = [
    t("inventoryValuationAuditCsvCreatedAt"),
    t("inventoryValuationAuditCsvOperator"),
    t("inventoryValuationPostStatusPosted"),
    t("inventoryValuationPostStatusFailed"),
    t("inventoryValuationPostStatusSkipped"),
    t("inventoryValuationAuditCsvInvoice"),
    t("inventoryValuationAuditCsvInvoiceId"),
    t("inventoryValuationAuditCsvResult"),
    t("inventoryValuationAuditCsvNote"),
  ];
  const rows = events.flatMap((event) => {
    const details = event.details ?? {};
    const results = details.results ?? [];
    const createdAt = Number.isNaN(new Date(event.createdAt).getTime())
      ? event.createdAt
      : new Date(event.createdAt).toISOString();
    const operator =
      event.user?.name || event.user?.email || event.user?.id || "-";
    const summary = [
      createdAt,
      operator,
      details.posted ?? 0,
      details.failed ?? 0,
      details.skipped ?? 0,
    ];

    if (results.length === 0) {
      return [[...summary, "", "", "", ""]];
    }

    return results.map((item) => [
      ...summary,
      item.invoiceNo ?? "",
      item.purchaseInvoiceId,
      bulkPostStatusLabel(item.status, t),
      item.error || item.message || "",
    ]);
  });
  const csv = [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `bulk-post-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function InventoryValuationView({
  onOpenDlq,
  onOpenTrialBalance,
}: {
  onOpenDlq?: () => void;
  onOpenTrialBalance?: () => void;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [retryingEvents, setRetryingEvents] = useState(false);
  const [postingPayables, setPostingPayables] = useState(false);
  const [payablePostResult, setPayablePostResult] =
    useState<BulkPostPayablesResult | null>(null);
  const [bulkPostAudits, setBulkPostAudits] = useState<BulkPostAuditEvent[]>(
    [],
  );
  const [auditFilters, setAuditFilters] = useState<BulkPostAuditFilters>({
    status: "",
    startDate: "",
    endDate: "",
    userId: "",
  });
  const [data, setData] = useState<InventoryValuationResult | null>(null);

  const retryableEventNames = useMemo(() => {
    return [
      ...new Set(
        data?.diagnostics.pendingEvents.map((event) => event.eventName) ?? [],
      ),
    ];
  }, [data]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [valuationResponse, auditResponse] = await Promise.all([
        api.get<InventoryValuationResult>("/finance/inventory-valuation"),
        api.get<BulkPostAuditResponse>(
          "/v1/timeline/actions/BULK_POST_PURCHASE_INVOICES",
          {
            params: {
              entity: "PurchaseInvoice",
              limit: 20,
              status: auditFilters.status || undefined,
              startDate: auditFilters.startDate || undefined,
              endDate: auditFilters.endDate || undefined,
              userId: auditFilters.userId.trim() || undefined,
            },
          },
        ),
      ]);
      setData(valuationResponse.data);
      setBulkPostAudits(auditResponse.data.events ?? []);
    } catch {
      setError(t("inventoryValuationLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [auditFilters, t]);

  const retryInventoryEvents = useCallback(async () => {
    if (retryableEventNames.length === 0) return;
    setRetryingEvents(true);
    setActionError("");
    setActionMessage("");
    try {
      const response = await api.post<RetryResult>("/finance/dlq/retry", {
        limit: 20,
        eventNames: retryableEventNames,
      });
      setActionMessage(
        `${t("inventoryValuationRetryResult")}: ${response.data.total}`,
      );
      await load();
    } catch {
      setActionError(t("inventoryValuationRetryFailed"));
    } finally {
      setRetryingEvents(false);
    }
  }, [load, retryableEventNames, t]);

  const postUnpostedPayables = useCallback(async () => {
    const purchaseInvoiceIds =
      data?.diagnostics.unpostedPurchaseInvoices
        .filter((invoice) => invoice.isPostable)
        .map((invoice) => invoice.id) ??
      [];
    if (purchaseInvoiceIds.length === 0) return;

    setPostingPayables(true);
    setActionError("");
    setActionMessage("");
    setPayablePostResult(null);
    try {
      const response = await api.post<BulkPostPayablesResult>(
        "/purchase/invoices/bulk-post",
        { purchaseInvoiceIds },
      );
      setPayablePostResult(response.data);
      setActionMessage(
        `${t("inventoryValuationPostPayablesResult")}: ${response.data.posted}/${response.data.total}`,
      );
      if (response.data.failed > 0) {
        setActionError(
          `${t("inventoryValuationPostPayablesFailedCount")}: ${response.data.failed}`,
        );
      }
      await load();
    } catch {
      setActionError(t("inventoryValuationPostPayablesFailed"));
    } finally {
      setPostingPayables(false);
    }
  }, [data, load, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {t("inventoryValuationTitle")}
          </h2>
          <p className="text-sm text-slate-500">
            {data
              ? `${data.inventoryAccount.code} ${data.inventoryAccount.name}`
              : t("inventoryValuationSubtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t("refresh")}
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {actionMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {actionMessage}
        </div>
      ) : null}

      {actionError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

      {payablePostResult ? (
        <PayablePostResultPanel result={payablePostResult} />
      ) : null}

      <BulkPostAuditPanel
        events={bulkPostAudits}
        filters={auditFilters}
        onFiltersChange={setAuditFilters}
      />

      {data ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <SummaryCard
              label={t("inventoryValuationStockValue")}
              value={money(data.inventoryValue)}
            />
            <SummaryCard
              label={t("inventoryValuationGlBalance")}
              value={money(data.generalLedgerBalance)}
            />
            <SummaryCard
              label={t("inventoryValuationDifference")}
              value={money(data.difference)}
              tone={data.reconciled ? "good" : "warn"}
            />
            <div
              className={`rounded-md border p-4 ${
                data.reconciled
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                {data.reconciled ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                )}
                {data.reconciled
                  ? t("inventoryValuationReconciled")
                  : t("inventoryValuationUnreconciled")}
              </div>
              <div className="mt-2 text-xs text-slate-500">
                {t("inventoryValuationMaterialCount")}: {data.materialCount}
              </div>
            </div>
          </div>

          <DiagnosticsPanel
            data={data}
            retryingEvents={retryingEvents}
            postingPayables={postingPayables}
            onOpenDlq={onOpenDlq}
            onOpenTrialBalance={onOpenTrialBalance}
            onRetryEvents={() => void retryInventoryEvents()}
            onPostPayables={() => void postUnpostedPayables()}
          />

          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">{t("purchaseMaterial")}</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2 text-right">
                    {t("inventoryValuationQty")}
                  </th>
                  <th className="px-3 py-2 text-right">
                    {t("inventoryValuationAverageCost")}
                  </th>
                  <th className="px-3 py-2 text-right">
                    {t("inventoryValuationStockValue")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((row) => (
                  <tr key={row.materialId}>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {row.name}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-500">
                      {row.sku}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {qty(row.quantityOnHand)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {money(row.averageCost)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">
                      {money(row.inventoryValue)}
                    </td>
                  </tr>
                ))}
                {data.rows.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-8 text-center text-slate-500"
                      colSpan={5}
                    >
                      {t("inventoryValuationEmpty")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white py-12 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
      ) : null}
    </div>
  );
}

function PayablePostResultPanel({
  result,
}: {
  result: BulkPostPayablesResult;
}) {
  const { t } = useI18n();
  const visibleResults = result.results.slice(0, 8);

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <div className="text-sm font-semibold text-slate-900">
          {t("inventoryValuationPostPayablesDetail")}
        </div>
        <div className="text-xs text-slate-500">
          {result.posted}/{result.total}
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {visibleResults.map((item) => (
          <div
            key={item.purchaseInvoiceId}
            className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <div className="font-medium text-slate-900">
                {item.invoiceNo ?? item.purchaseInvoiceId}
              </div>
              {item.error || item.message ? (
                <div className="mt-1 text-xs text-slate-500">
                  {item.error || item.message}
                </div>
              ) : null}
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                item.status === "POSTED"
                  ? "bg-emerald-50 text-emerald-700"
                  : item.status === "FAILED"
                    ? "bg-red-50 text-red-700"
                    : "bg-slate-100 text-slate-600"
              }`}
            >
              {item.status === "POSTED"
                ? t("inventoryValuationPostStatusPosted")
                : item.status === "FAILED"
                  ? t("inventoryValuationPostStatusFailed")
                  : t("inventoryValuationPostStatusSkipped")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BulkPostAuditPanel({
  events,
  filters,
  onFiltersChange,
}: {
  events: BulkPostAuditEvent[];
  filters: BulkPostAuditFilters;
  onFiltersChange: (filters: BulkPostAuditFilters) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div className="text-sm font-semibold text-slate-900">
          {t("inventoryValuationBulkAuditTitle")}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportBulkPostAuditCsv(events, t)}
            disabled={events.length === 0}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {t("inventoryValuationExportAuditCsv")}
          </button>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {events.length}
          </span>
        </div>
      </div>
      <div className="grid gap-2 border-b border-slate-100 px-3 py-2 text-xs md:grid-cols-4">
        <select
          value={filters.status}
          onChange={(event) =>
            onFiltersChange({
              ...filters,
              status: event.target.value as BulkPostAuditFilters["status"],
            })
          }
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700"
        >
          <option value="">{t("inventoryValuationAuditStatusAll")}</option>
          <option value="POSTED">
            {t("inventoryValuationPostStatusPosted")}
          </option>
          <option value="FAILED">
            {t("inventoryValuationPostStatusFailed")}
          </option>
          <option value="SKIPPED">
            {t("inventoryValuationPostStatusSkipped")}
          </option>
        </select>
        <input
          type="date"
          value={filters.startDate}
          onChange={(event) =>
            onFiltersChange({ ...filters, startDate: event.target.value })
          }
          className="rounded-md border border-slate-200 px-2 py-1 text-slate-700"
          aria-label={t("inventoryValuationAuditStartDate")}
        />
        <input
          type="date"
          value={filters.endDate}
          onChange={(event) =>
            onFiltersChange({ ...filters, endDate: event.target.value })
          }
          className="rounded-md border border-slate-200 px-2 py-1 text-slate-700"
          aria-label={t("inventoryValuationAuditEndDate")}
        />
        <input
          type="text"
          value={filters.userId}
          onChange={(event) =>
            onFiltersChange({ ...filters, userId: event.target.value })
          }
          placeholder={t("inventoryValuationAuditUserFilter")}
          className="rounded-md border border-slate-200 px-2 py-1 text-slate-700"
        />
      </div>
      <div className="divide-y divide-slate-100">
        {events.map((event) => {
          const details = event.details ?? {};
          const invoiceResults = (details.results ?? []).slice(0, 5);
          return (
            <div key={event.id} className="px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-900">
                  {event.user?.name || event.user?.email || "-"}
                </span>
                <span className="text-xs text-slate-500">
                  {dateText(event.createdAt)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-600">
                <span>
                  {t("inventoryValuationPostStatusPosted")}:{" "}
                  {details.posted ?? 0}
                </span>
                <span>
                  {t("inventoryValuationPostStatusFailed")}:{" "}
                  {details.failed ?? 0}
                </span>
                <span>
                  {t("inventoryValuationPostStatusSkipped")}:{" "}
                  {details.skipped ?? 0}
                </span>
              </div>
              {invoiceResults.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {invoiceResults.map((item) => (
                    <div
                      key={`${event.id}-${item.purchaseInvoiceId}`}
                      className="flex items-start justify-between gap-3 rounded-md bg-slate-50 px-2 py-1 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-700">
                          {item.invoiceNo ?? item.purchaseInvoiceId}
                        </div>
                        {item.error || item.message ? (
                          <div className="mt-0.5 truncate text-slate-500">
                            {item.error || item.message}
                          </div>
                        ) : null}
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${
                          item.status === "POSTED"
                            ? "bg-emerald-50 text-emerald-700"
                            : item.status === "FAILED"
                              ? "bg-red-50 text-red-700"
                              : "bg-white text-slate-600"
                        }`}
                      >
                        {item.status === "POSTED"
                          ? t("inventoryValuationPostStatusPosted")
                          : item.status === "FAILED"
                            ? t("inventoryValuationPostStatusFailed")
                            : t("inventoryValuationPostStatusSkipped")}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {events.length === 0 ? (
          <EmptyLine text={t("inventoryValuationBulkAuditEmpty")} />
        ) : null}
      </div>
    </div>
  );
}

function DiagnosticsPanel({
  data,
  retryingEvents,
  postingPayables,
  onOpenDlq,
  onOpenTrialBalance,
  onRetryEvents,
  onPostPayables,
}: {
  data: InventoryValuationResult;
  retryingEvents: boolean;
  postingPayables: boolean;
  onOpenDlq?: () => void;
  onOpenTrialBalance?: () => void;
  onRetryEvents: () => void;
  onPostPayables: () => void;
}) {
  const { t } = useI18n();
  const diagnostics = data.diagnostics ?? {
    recentGeneralLedgerLines: [],
    pendingEvents: [],
    unpostedPurchaseInvoices: [],
  };
  const postablePayableCount = diagnostics.unpostedPurchaseInvoices.filter(
    (invoice) => invoice.isPostable,
  ).length;
  const blockedPayableCount =
    diagnostics.unpostedPurchaseInvoices.length - postablePayableCount;

  return (
    <div className="grid gap-3 xl:grid-cols-3">
      <div className="rounded-md border border-slate-200 bg-white">
        <DiagnosticsHeader
          icon={<FileText className="h-4 w-4" />}
          title={t("inventoryValuationRecentGlLines")}
          count={diagnostics.recentGeneralLedgerLines.length}
          action={
            onOpenTrialBalance ? (
              <button
                type="button"
                onClick={onOpenTrialBalance}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
              >
                {t("inventoryValuationOpenTrialBalance")}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : null
          }
        />
        <div className="divide-y divide-slate-100">
          {diagnostics.recentGeneralLedgerLines.slice(0, 6).map((line) => (
            <div key={line.journalEntryId} className="px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-900">
                  {line.entryNo}
                </span>
                <span className="font-mono text-slate-700">
                  {money(line.balance)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-500">
                <span className="truncate">
                  {line.ref || line.memo || line.description || "-"}
                </span>
                <span>{dateText(line.date)}</span>
              </div>
            </div>
          ))}
          {diagnostics.recentGeneralLedgerLines.length === 0 ? (
            <EmptyLine text={t("inventoryValuationNoGlLines")} />
          ) : null}
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-white">
        <DiagnosticsHeader
          icon={<Activity className="h-4 w-4" />}
          title={t("inventoryValuationPendingEvents")}
          count={diagnostics.pendingEvents.length}
          action={
            <div className="flex items-center gap-2">
              {onOpenDlq ? (
                <button
                  type="button"
                  onClick={onOpenDlq}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
                >
                  {t("inventoryValuationOpenDlq")}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={onRetryEvents}
                disabled={
                  retryingEvents || diagnostics.pendingEvents.length === 0
                }
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {retryingEvents ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                {t("inventoryValuationRetryEvents")}
              </button>
            </div>
          }
        />
        <div className="divide-y divide-slate-100">
          {diagnostics.pendingEvents.slice(0, 6).map((event) => (
            <div key={event.id} className="px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-medium text-slate-900">
                  {event.eventName}
                </span>
                <StatusBadge status={event.status} />
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {t("inventoryValuationAttempts")}: {event.attempts}/
                {event.maxAttempts}
              </div>
              {event.error ? (
                <div className="mt-1 truncate text-xs text-red-600">
                  {event.error}
                </div>
              ) : null}
            </div>
          ))}
          {diagnostics.pendingEvents.length === 0 ? (
            <EmptyLine text={t("inventoryValuationNoPendingEvents")} />
          ) : null}
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-white">
        <DiagnosticsHeader
          icon={<ReceiptText className="h-4 w-4" />}
          title={t("inventoryValuationUnpostedInvoices")}
          count={diagnostics.unpostedPurchaseInvoices.length}
          action={
            <div className="flex items-center gap-2">
              {blockedPayableCount > 0 ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                  {t("inventoryValuationBlockedPayables")}:{" "}
                  {blockedPayableCount}
                </span>
              ) : null}
              <button
                type="button"
                onClick={onPostPayables}
                disabled={
                  postingPayables ||
                  postablePayableCount === 0
                }
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {postingPayables ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                {t("inventoryValuationPostPayables")} ({postablePayableCount})
              </button>
              <Link
                href="/dashboard/purchase?tab=purchaseInvoice"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
              >
                {t("inventoryValuationOpenPurchaseInvoices")}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          }
        />
        <div className="divide-y divide-slate-100">
          {diagnostics.unpostedPurchaseInvoices.slice(0, 6).map((invoice) => (
            <div key={invoice.id} className="px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-medium text-slate-900">
                    {invoice.invoiceNo}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      invoice.isPostable
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {payableMatchLabel(invoice.matchStatus, t)}
                  </span>
                </div>
                <span className="font-mono text-slate-700">
                  {money(invoice.amount)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-500">
                <span className="truncate">
                  {invoice.purchaseNo} · {invoice.supplierName}
                </span>
                <span>{dateText(invoice.issuedDate)}</span>
              </div>
              {invoice.matchReasons.length > 0 ? (
                <div className="mt-1 text-xs text-amber-700">
                  {invoice.matchReasons.join("；")}
                </div>
              ) : null}
            </div>
          ))}
          {diagnostics.unpostedPurchaseInvoices.length === 0 ? (
            <EmptyLine text={t("inventoryValuationNoUnpostedInvoices")} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DiagnosticsHeader({
  icon,
  title,
  count,
  action,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="text-slate-500">{icon}</span>
        {title}
      </div>
      <div className="flex items-center gap-2">
        {action}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          {count}
        </span>
      </div>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="px-3 py-6 text-center text-sm text-slate-500">{text}</div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "FAILED"
      ? "bg-red-50 text-red-700"
      : status === "RETRYING"
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-600";

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {status}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
}) {
  return (
    <div
      className={`rounded-md border bg-white p-4 ${
        tone === "good"
          ? "border-emerald-200"
          : tone === "warn"
            ? "border-amber-200"
            : "border-slate-200"
      }`}
    >
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}
