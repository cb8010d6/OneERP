"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  Calculator,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { clsx } from "clsx";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useI18n, type Language } from "@/lib/i18n";

type BalanceSheetRow = {
  accountId: string;
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY";
  debit: number;
  credit: number;
  amount: number;
};

type BalanceSheetData = {
  asOfDate: string;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  currentEarnings: number;
  totalLiabilitiesAndEquity: number;
  difference: number;
  balanced: boolean;
  rows: BalanceSheetRow[];
};

function inputDateValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function todayInputValue() {
  return inputDateValue(new Date());
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

export function BalanceSheetView() {
  const { t, language } = useI18n();
  const [asOfDate, setAsOfDate] = useState(todayInputValue());
  const [data, setData] = useState<BalanceSheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const assetRows = useMemo(
    () => data?.rows.filter((row) => row.type === "ASSET") ?? [],
    [data],
  );
  const liabilityRows = useMemo(
    () => data?.rows.filter((row) => row.type === "LIABILITY") ?? [],
    [data],
  );
  const equityRows = useMemo(
    () => data?.rows.filter((row) => row.type === "EQUITY") ?? [],
    [data],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<BalanceSheetData>(
        "/finance/balance-sheet",
        { params: { asOfDate: asOfDate || undefined } },
      );
      setData(response.data);
    } catch (reason: unknown) {
      setError(readApiError(reason, t("balanceSheetLoadFailed")));
    } finally {
      setLoading(false);
    }
  }, [asOfDate, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {t("balanceSheetTitle")}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {t("balanceSheetHint")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={asOfDate}
            onChange={(event) => setAsOfDate(event.target.value)}
            className="rounded-md border border-slate-300 p-2 text-sm"
            aria-label={t("balanceSheetAsOfDate")}
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
              label={t("balanceSheetAssets")}
              value={data.totalAssets}
              locale={language}
              tone="asset"
            />
            <SummaryTile
              label={t("balanceSheetLiabilities")}
              value={data.totalLiabilities}
              locale={language}
              tone="liability"
            />
            <SummaryTile
              label={t("balanceSheetEquity")}
              value={data.totalEquity + data.currentEarnings}
              locale={language}
              tone="equity"
            />
            <SummaryTile
              label={
                data.balanced
                  ? t("balanceSheetBalanced")
                  : t("balanceSheetDifference")
              }
              value={Math.abs(data.difference)}
              locale={language}
              tone={data.balanced ? "balanced" : "difference"}
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div className="flex flex-wrap items-center gap-3 text-slate-600">
              <BadgeCheck
                className={clsx(
                  "h-4 w-4",
                  data.balanced ? "text-emerald-600" : "text-amber-600",
                )}
              />
              <span>
                {t("balanceSheetEquation")}:{" "}
                <strong className="text-slate-950">
                  {formatCurrency(data.totalAssets, language)}
                </strong>{" "}
                = {formatCurrency(data.totalLiabilities, language)} +{" "}
                {formatCurrency(data.totalEquity, language)} +{" "}
                {formatCurrency(data.currentEarnings, language)}
              </span>
            </div>
          </div>

          <StatementSection
            title={t("balanceSheetAssets")}
            rows={assetRows}
            locale={language}
            emptyText={t("balanceSheetNoAssets")}
            codeLabel={t("balanceSheetCode")}
            accountLabel={t("balanceSheetAccount")}
            debitLabel={t("balanceSheetDebit")}
            creditLabel={t("balanceSheetCredit")}
            amountLabel={t("balanceSheetAmount")}
          />
          <StatementSection
            title={t("balanceSheetLiabilities")}
            rows={liabilityRows}
            locale={language}
            emptyText={t("balanceSheetNoLiabilities")}
            codeLabel={t("balanceSheetCode")}
            accountLabel={t("balanceSheetAccount")}
            debitLabel={t("balanceSheetDebit")}
            creditLabel={t("balanceSheetCredit")}
            amountLabel={t("balanceSheetAmount")}
          />
          <StatementSection
            title={t("balanceSheetEquity")}
            rows={equityRows}
            locale={language}
            emptyText={t("balanceSheetNoEquity")}
            codeLabel={t("balanceSheetCode")}
            accountLabel={t("balanceSheetAccount")}
            debitLabel={t("balanceSheetDebit")}
            creditLabel={t("balanceSheetCredit")}
            amountLabel={t("balanceSheetAmount")}
            footerLabel={t("balanceSheetCurrentEarnings")}
            footerAmount={data.currentEarnings}
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
  tone: "asset" | "liability" | "equity" | "balanced" | "difference";
}) {
  return (
    <div
      className={clsx(
        "rounded-lg border p-4",
        tone === "asset" && "border-sky-100 bg-sky-50",
        tone === "liability" && "border-rose-100 bg-rose-50",
        tone === "equity" && "border-emerald-100 bg-emerald-50",
        tone === "balanced" && "border-slate-200 bg-white",
        tone === "difference" && "border-amber-100 bg-amber-50",
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-600">
        <Calculator className="h-4 w-4" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-950">
        {formatCurrency(value, locale)}
      </p>
    </div>
  );
}

function StatementSection({
  title,
  rows,
  locale,
  emptyText,
  codeLabel,
  accountLabel,
  debitLabel,
  creditLabel,
  amountLabel,
  footerLabel,
  footerAmount,
}: {
  title: string;
  rows: BalanceSheetRow[];
  locale: Language;
  emptyText: string;
  codeLabel: string;
  accountLabel: string;
  debitLabel: string;
  creditLabel: string;
  amountLabel: string;
  footerLabel?: string;
  footerAmount?: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
        {title}
      </div>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">{codeLabel}</th>
            <th className="px-3 py-2 text-left">{accountLabel}</th>
            <th className="px-3 py-2 text-right">{debitLabel}</th>
            <th className="px-3 py-2 text-right">{creditLabel}</th>
            <th className="px-3 py-2 text-right">{amountLabel}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.accountId} className="hover:bg-slate-50">
              <td className="px-3 py-2 font-mono text-slate-600">
                {row.code}
              </td>
              <td className="px-3 py-2 font-medium text-slate-900">
                {row.name}
              </td>
              <td className="px-3 py-2 text-right font-mono text-slate-600">
                {row.debit > 0 ? formatCurrency(row.debit, locale) : "-"}
              </td>
              <td className="px-3 py-2 text-right font-mono text-slate-600">
                {row.credit > 0 ? formatCurrency(row.credit, locale) : "-"}
              </td>
              <td className="px-3 py-2 text-right font-mono font-semibold text-slate-950">
                {formatCurrency(row.amount, locale)}
              </td>
            </tr>
          ))}
          {footerLabel ? (
            <tr className="bg-slate-50">
              <td className="px-3 py-2 font-mono text-slate-500">-</td>
              <td className="px-3 py-2 font-medium text-slate-900">
                {footerLabel}
              </td>
              <td className="px-3 py-2 text-right text-slate-500">-</td>
              <td className="px-3 py-2 text-right text-slate-500">-</td>
              <td className="px-3 py-2 text-right font-mono font-semibold text-slate-950">
                {formatCurrency(footerAmount ?? 0, locale)}
              </td>
            </tr>
          ) : null}
          {rows.length === 0 && !footerLabel ? (
            <tr>
              <td
                colSpan={5}
                className="px-3 py-8 text-center text-sm text-slate-500"
              >
                <AlertCircle className="mx-auto mb-2 h-5 w-5 text-slate-300" />
                {emptyText}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
