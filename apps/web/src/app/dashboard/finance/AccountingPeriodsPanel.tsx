"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  Unlock,
} from "lucide-react";
import api from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type AccountingPeriod = {
  id: string;
  periodKey: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "CLOSED";
  closedAt?: string | null;
  closedBy?: string | null;
  closeBlockerTotal?: number;
  closeBlockers?: CloseBlockerCounts;
};

type CloseBlockerCounts = {
  invoices: number;
  customerPayments: number;
  creditNotes: number;
  customerRefunds: number;
  purchaseInvoices: number;
  supplierCreditNotes: number;
  supplierPayments: number;
  financeEvents: number;
};

type PeriodForm = {
  periodKey: string;
  startDate: string;
  endDate: string;
};

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthForm(): PeriodForm {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return {
    periodKey: `${year}-${String(month + 1).padStart(2, "0")}`,
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
  };
}

function displayDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function closeBlockerItems(
  blockers: CloseBlockerCounts | undefined,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (!blockers) return [];
  return [
    ["invoices", t("accountingPeriodsBlockerInvoices")],
    ["customerPayments", t("accountingPeriodsBlockerCustomerPayments")],
    ["creditNotes", t("accountingPeriodsBlockerCreditNotes")],
    ["customerRefunds", t("accountingPeriodsBlockerCustomerRefunds")],
    ["purchaseInvoices", t("accountingPeriodsBlockerPurchaseInvoices")],
    ["supplierCreditNotes", t("accountingPeriodsBlockerSupplierCreditNotes")],
    ["supplierPayments", t("accountingPeriodsBlockerSupplierPayments")],
    ["financeEvents", t("accountingPeriodsBlockerFinanceEvents")],
  ]
    .map(([key, label]) => ({
      key,
      label,
      count: blockers[key as keyof CloseBlockerCounts] ?? 0,
    }))
    .filter((item) => item.count > 0);
}

export function AccountingPeriodsPanel() {
  const { t } = useI18n();
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [form, setForm] = useState<PeriodForm>(() => currentMonthForm());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyPeriodKey, setBusyPeriodKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const sortedPeriods = useMemo(
    () =>
      [...periods].sort(
        (a, b) =>
          new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
      ),
    [periods],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<AccountingPeriod[]>(
        "/finance/accounting-periods",
      );
      setPeriods(response.data ?? []);
    } catch {
      setError(t("accountingPeriodsLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePeriod = useCallback(async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await api.post("/finance/accounting-periods", form);
      setMessage(t("accountingPeriodsSaved"));
      await load();
    } catch {
      setError(t("accountingPeriodsSaveFailed"));
    } finally {
      setSaving(false);
    }
  }, [form, load, t]);

  const togglePeriod = useCallback(
    async (period: AccountingPeriod) => {
      setBusyPeriodKey(period.periodKey);
      setMessage("");
      setError("");
      try {
        const action = period.status === "OPEN" ? "close" : "reopen";
        await api.post(
          `/finance/accounting-periods/${encodeURIComponent(period.periodKey)}/${action}`,
        );
        setMessage(
          period.status === "OPEN"
            ? t("accountingPeriodsClosed")
            : t("accountingPeriodsReopened"),
        );
        await load();
      } catch {
        setError(
          period.status === "OPEN"
            ? t("accountingPeriodsCloseFailed")
            : t("accountingPeriodsReopenFailed"),
        );
      } finally {
        setBusyPeriodKey("");
      }
    },
    [load, t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {t("accountingPeriodsTitle")}
          </h2>
          <p className="text-sm text-slate-500">
            {t("accountingPeriodsSubtitle")}
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

      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-md border border-slate-200 bg-white">
        <div className="grid gap-3 border-b border-slate-100 p-3 md:grid-cols-[1fr_1fr_1fr_auto]">
          <label className="text-xs font-medium text-slate-600">
            {t("accountingPeriodsPeriodKey")}
            <input
              type="text"
              value={form.periodKey}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  periodKey: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            {t("accountingPeriodsStartDate")}
            <input
              type="date"
              value={form.startDate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  startDate: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            {t("accountingPeriodsEndDate")}
            <input
              type="date"
              value={form.endDate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  endDate: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <button
            type="button"
            onClick={() => void savePeriod()}
            disabled={saving}
            className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t("accountingPeriodsSave")}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">
                  {t("accountingPeriodsPeriodKey")}
                </th>
                <th className="px-3 py-2">
                  {t("accountingPeriodsDateRange")}
                </th>
                <th className="px-3 py-2">
                  {t("accountingPeriodsStatus")}
                </th>
                <th className="px-3 py-2">
                  {t("accountingPeriodsCloseBlockers")}
                </th>
                <th className="px-3 py-2">
                  {t("accountingPeriodsClosedAt")}
                </th>
                <th className="px-3 py-2 text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedPeriods.map((period) => {
                const blockers = closeBlockerItems(period.closeBlockers, t);
                const hasBlockers = (period.closeBlockerTotal ?? 0) > 0;
                const closeDisabled =
                  busyPeriodKey === period.periodKey ||
                  (period.status === "OPEN" && hasBlockers);
                return (
                  <tr key={period.id}>
                    <td className="px-3 py-2 font-medium text-slate-900">
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          periodKey: period.periodKey,
                          startDate: formatDateInput(new Date(period.startDate)),
                          endDate: formatDateInput(new Date(period.endDate)),
                        })
                      }
                      className="inline-flex items-center gap-2 text-left hover:text-blue-700"
                    >
                      <CalendarDays className="h-4 w-4 text-slate-400" />
                      {period.periodKey}
                    </button>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                    {displayDate(period.startDate)} -{" "}
                    {displayDate(period.endDate)}
                    </td>
                    <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        period.status === "OPEN"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {period.status === "OPEN" ? (
                        <Unlock className="h-3.5 w-3.5" />
                      ) : (
                        <Lock className="h-3.5 w-3.5" />
                      )}
                      {period.status === "OPEN"
                        ? t("accountingPeriodsOpen")
                        : t("accountingPeriodsClosedStatus")}
                    </span>
                    </td>
                    <td className="px-3 py-2">
                      {hasBlockers ? (
                        <div className="max-w-md space-y-1">
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {t("accountingPeriodsBlockerTotal")}:{" "}
                            {period.closeBlockerTotal}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {blockers.slice(0, 4).map((item) => (
                              <span
                                key={item.key}
                                className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                              >
                                {item.label}: {item.count}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">
                          {t("accountingPeriodsNoBlockers")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                    {displayDate(period.closedAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void togglePeriod(period)}
                      disabled={closeDisabled}
                      title={
                        period.status === "OPEN" && hasBlockers
                          ? t("accountingPeriodsCloseBlocked")
                          : undefined
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyPeriodKey === period.periodKey ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : period.status === "OPEN" ? (
                        <Lock className="h-3.5 w-3.5" />
                      ) : (
                        <Unlock className="h-3.5 w-3.5" />
                      )}
                      {period.status === "OPEN"
                        ? t("accountingPeriodsClose")
                        : t("accountingPeriodsReopen")}
                    </button>
                    </td>
                  </tr>
                );
              })}
              {sortedPeriods.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-8 text-center text-slate-500"
                    colSpan={6}
                  >
                    {loading ? t("loading") : t("accountingPeriodsEmpty")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
