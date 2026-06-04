"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuthStore } from "@/store/authStore";

type AgingBucket =
  | "CURRENT"
  | "DAYS_1_30"
  | "DAYS_31_60"
  | "DAYS_61_90"
  | "DAYS_90_PLUS";

type AgingRow = {
  invoiceId: string;
  invoiceNo: string;
  orderNo: string | null;
  partnerName: string | null;
  issuedDate: string;
  dueDate: string | null;
  daysOverdue: number;
  amount: number;
  paidAmount: number;
  creditedAmount: number;
  openAmount: number;
  bucket: AgingBucket;
};

type AgingResult = {
  asOfDate: string;
  totalOpen: number;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  rows: AgingRow[];
};

function readApiError(reason: unknown, fallback: string) {
  if (reason && typeof reason === "object" && "response" in reason) {
    const response = (reason as { response?: { data?: { message?: unknown } } })
      .response;
    if (typeof response?.data?.message === "string") {
      return response.data.message;
    }
  }
  return fallback;
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return value.slice(0, 10);
}

function money(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ReceivablesAgingView() {
  const { t } = useI18n();
  const { currentCompanyId } = useAuthStore();
  const [asOfDate, setAsOfDate] = useState(() => toDateInputValue(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<AgingResult | null>(null);

  const summary = useMemo(
    () =>
      data
        ? [
            { label: t("agingTotalOpen"), value: data.totalOpen },
            { label: t("agingCurrent"), value: data.current },
            { label: t("agingDays1To30"), value: data.days1To30 },
            { label: t("agingDays31To60"), value: data.days31To60 },
            { label: t("agingDays61To90"), value: data.days61To90 },
            { label: t("agingDays90Plus"), value: data.days90Plus },
          ]
        : [],
    [data, t],
  );

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    setLoading(true);
    setError("");
    try {
      const response = await api.get<AgingResult>(
        "/finance/receivables-aging",
        { params: { asOfDate } },
      );
      setData(response.data);
    } catch (reason: unknown) {
      setError(readApiError(reason, t("agingLoadFailed")));
    } finally {
      setLoading(false);
    }
  }, [asOfDate, currentCompanyId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {t("agingTitle")}
          </h3>
          <p className="mt-1 text-xs text-slate-500">{t("agingHint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={asOfDate}
            onChange={(event) => setAsOfDate(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
            title={t("commonRefresh")}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {summary.map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-slate-200 bg-white p-3"
          >
            <div className="text-xs text-slate-500">{item.label}</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {money(item.value)}
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">{t("agingInvoice")}</th>
              <th className="px-3 py-2 text-left">{t("agingPartner")}</th>
              <th className="px-3 py-2 text-left">{t("agingDueDate")}</th>
              <th className="px-3 py-2 text-right">{t("agingDaysOverdue")}</th>
              <th className="px-3 py-2 text-right">{t("agingAmount")}</th>
              <th className="px-3 py-2 text-right">{t("agingPaid")}</th>
              <th className="px-3 py-2 text-right">{t("agingCredited")}</th>
              <th className="px-3 py-2 text-right">{t("agingOpen")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.rows.map((row) => (
              <tr key={row.invoiceId} className="hover:bg-slate-50">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">
                    {row.invoiceNo}
                  </div>
                  <div className="text-xs text-slate-500">
                    {row.orderNo ?? "-"}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {row.partnerName ?? "-"}
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {formatDate(row.dueDate)}
                </td>
                <td className="px-3 py-2 text-right text-slate-700">
                  {row.daysOverdue}
                </td>
                <td className="px-3 py-2 text-right text-slate-700">
                  {money(row.amount)}
                </td>
                <td className="px-3 py-2 text-right text-slate-700">
                  {money(row.paidAmount)}
                </td>
                <td className="px-3 py-2 text-right text-slate-700">
                  {money(row.creditedAmount)}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-slate-900">
                  {money(row.openAmount)}
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-8 text-center text-sm text-slate-500"
                >
                  {t("agingEmpty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
