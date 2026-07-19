"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import { clsx } from "clsx";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useI18n, type Language } from "@/lib/i18n";

type CashFlowCategory = "OPERATING" | "INVESTING" | "FINANCING";

type CashFlowRow = {
  journalEntryId: string;
  entryNo: string;
  date: string;
  ref: string | null;
  description: string | null;
  accountCode: string;
  accountName: string;
  category: CashFlowCategory;
  cashInflow: number;
  cashOutflow: number;
  netCashFlow: number;
};

type CashFlowData = {
  startDate: string | null;
  endDate: string;
  beginningCash: number;
  totalCashInflow: number;
  totalCashOutflow: number;
  operatingCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  netCashFlow: number;
  endingCash: number;
  cashAccountCodes: string[];
  rows: CashFlowRow[];
};

function inputDateValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function monthStart() {
  const now = new Date();
  return inputDateValue(new Date(now.getFullYear(), now.getMonth(), 1));
}

function monthEnd() {
  const now = new Date();
  return inputDateValue(new Date(now.getFullYear(), now.getMonth() + 1, 0));
}

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

function categoryLabel(
  category: CashFlowCategory,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (category === "INVESTING") return t("cashFlowInvesting");
  if (category === "FINANCING") return t("cashFlowFinancing");
  return t("cashFlowOperating");
}

export function CashFlowStatementView() {
  const { t, language } = useI18n();
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(monthEnd());
  const [data, setData] = useState<CashFlowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const groupedRows = useMemo(
    () => ({
      OPERATING: data?.rows.filter((row) => row.category === "OPERATING") ?? [],
      INVESTING: data?.rows.filter((row) => row.category === "INVESTING") ?? [],
      FINANCING: data?.rows.filter((row) => row.category === "FINANCING") ?? [],
    }),
    [data],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<CashFlowData>("/finance/cash-flow", {
        params: {
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        },
      });
      setData(response.data);
    } catch (reason: unknown) {
      setError(readApiError(reason, t("cashFlowLoadFailed")));
    } finally {
      setLoading(false);
    }
  }, [endDate, startDate, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {t("cashFlowTitle")}
          </h3>
          <p className="mt-1 text-xs text-slate-500">{t("cashFlowHint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="rounded-md border border-slate-300 p-2 text-sm"
            aria-label={t("cashFlowStartDate")}
          />
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="rounded-md border border-slate-300 p-2 text-sm"
            aria-label={t("cashFlowEndDate")}
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("refresh")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <SummaryTile
              label={t("cashFlowBeginningCash")}
              value={data.beginningCash}
              locale={language}
              tone="cash"
            />
            <SummaryTile
              label={t("cashFlowInflow")}
              value={data.totalCashInflow}
              locale={language}
              tone="inflow"
            />
            <SummaryTile
              label={t("cashFlowOutflow")}
              value={data.totalCashOutflow}
              locale={language}
              tone="outflow"
            />
            <SummaryTile
              label={t("cashFlowEndingCash")}
              value={data.endingCash}
              locale={language}
              tone="cash"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <SummaryTile
              label={t("cashFlowOperating")}
              value={data.operatingCashFlow}
              locale={language}
              tone="net"
            />
            <SummaryTile
              label={t("cashFlowInvesting")}
              value={data.investingCashFlow}
              locale={language}
              tone="net"
            />
            <SummaryTile
              label={t("cashFlowFinancing")}
              value={data.financingCashFlow}
              locale={language}
              tone="net"
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            {t("cashFlowAccounts")}: {data.cashAccountCodes.join(", ")}
          </div>

          <CashFlowSection
            title={t("cashFlowOperating")}
            rows={groupedRows.OPERATING}
            locale={language}
            t={t}
          />
          <CashFlowSection
            title={t("cashFlowInvesting")}
            rows={groupedRows.INVESTING}
            locale={language}
            t={t}
          />
          <CashFlowSection
            title={t("cashFlowFinancing")}
            rows={groupedRows.FINANCING}
            locale={language}
            t={t}
          />
        </>
      ) : null}
    </section>
  );
}

function SummaryTile({
  label,
  value,
  locale,
  tone,
}: {
  label: string;
  value: number;
  locale: Language;
  tone: "cash" | "inflow" | "outflow" | "net";
}) {
  return (
    <div
      className={clsx(
        "rounded-lg border p-4",
        tone === "cash" && "border-sky-100 bg-sky-50",
        tone === "inflow" && "border-emerald-100 bg-emerald-50",
        tone === "outflow" && "border-rose-100 bg-rose-50",
        tone === "net" && "border-slate-200 bg-white",
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-600">
        {tone === "inflow" ? (
          <ArrowDownToLine className="h-4 w-4" />
        ) : tone === "outflow" ? (
          <ArrowUpFromLine className="h-4 w-4" />
        ) : (
          <WalletCards className="h-4 w-4" />
        )}
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-950">
        {formatCurrency(value, locale)}
      </p>
    </div>
  );
}

function CashFlowSection({
  title,
  rows,
  locale,
  t,
}: {
  title: string;
  rows: CashFlowRow[];
  locale: Language;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[760px] divide-y divide-slate-200 text-sm">
          <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">{t("cashFlowEntry")}</th>
              <th className="px-3 py-2 text-left">{t("cashFlowCategory")}</th>
              <th className="px-3 py-2 text-left">{t("cashFlowAccount")}</th>
              <th className="px-3 py-2 text-right">{t("cashFlowInflow")}</th>
              <th className="px-3 py-2 text-right">{t("cashFlowOutflow")}</th>
              <th className="px-3 py-2 text-right">{t("cashFlowNet")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr key={`${row.journalEntryId}-${row.accountCode}-${index}`}>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">
                    {row.entryNo}
                  </div>
                  <div className="text-xs text-slate-500">
                    {row.date.slice(0, 10)} / {row.ref ?? "-"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {row.description ?? "-"}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {categoryLabel(row.category, t)}
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {row.accountCode} / {row.accountName}
                </td>
                <td className="px-3 py-2 text-right font-mono text-emerald-700">
                  {row.cashInflow > 0
                    ? formatCurrency(row.cashInflow, locale)
                    : "-"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-rose-700">
                  {row.cashOutflow > 0
                    ? formatCurrency(row.cashOutflow, locale)
                    : "-"}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-slate-950">
                  {formatCurrency(row.netCashFlow, locale)}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-sm text-slate-500"
                >
                  <AlertCircle className="mx-auto mb-2 h-5 w-5 text-slate-300" />
                  {t("cashFlowNoRows")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
