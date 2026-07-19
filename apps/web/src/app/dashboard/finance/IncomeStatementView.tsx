"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Calculator, Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { clsx } from "clsx";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useI18n, type Language } from "@/lib/i18n";

type IncomeStatementRow = {
  accountId: string;
  code: string;
  name: string;
  type: "REVENUE" | "EXPENSE";
  debit: number;
  credit: number;
  amount: number;
};

type IncomeStatementData = {
  startDate: string | null;
  endDate: string | null;
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
  rows: IncomeStatementRow[];
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

export function IncomeStatementView() {
  const { t, language } = useI18n();
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(monthEnd());
  const [data, setData] = useState<IncomeStatementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const revenueRows = useMemo(
    () => data?.rows.filter((row) => row.type === "REVENUE") ?? [],
    [data],
  );
  const expenseRows = useMemo(
    () => data?.rows.filter((row) => row.type === "EXPENSE") ?? [],
    [data],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<IncomeStatementData>(
        "/finance/income-statement",
        {
          params: {
            startDate: startDate || undefined,
            endDate: endDate || undefined,
          },
        },
      );
      setData(response.data);
    } catch (reason: unknown) {
      setError(readApiError(reason, t("incomeStatementLoadFailed")));
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
            {t("incomeStatementTitle")}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {t("incomeStatementHint")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="rounded-md border border-slate-300 p-2 text-sm"
            aria-label={t("incomeStatementStartDate")}
          />
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="rounded-md border border-slate-300 p-2 text-sm"
            aria-label={t("incomeStatementEndDate")}
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
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryTile
              label={t("incomeStatementRevenue")}
              value={data.totalRevenue}
              locale={language}
              tone="revenue"
            />
            <SummaryTile
              label={t("incomeStatementExpense")}
              value={data.totalExpense}
              locale={language}
              tone="expense"
            />
            <SummaryTile
              label={t("incomeStatementNetIncome")}
              value={data.netIncome}
              locale={language}
              tone={data.netIncome >= 0 ? "profit" : "loss"}
            />
          </div>

          <StatementSection
            title={t("incomeStatementRevenue")}
            rows={revenueRows}
            locale={language}
            emptyText={t("incomeStatementNoRevenue")}
            codeLabel={t("incomeStatementCode")}
            accountLabel={t("incomeStatementAccount")}
            debitLabel={t("incomeStatementDebit")}
            creditLabel={t("incomeStatementCredit")}
            amountLabel={t("incomeStatementAmount")}
          />
          <StatementSection
            title={t("incomeStatementExpense")}
            rows={expenseRows}
            locale={language}
            emptyText={t("incomeStatementNoExpense")}
            codeLabel={t("incomeStatementCode")}
            accountLabel={t("incomeStatementAccount")}
            debitLabel={t("incomeStatementDebit")}
            creditLabel={t("incomeStatementCredit")}
            amountLabel={t("incomeStatementAmount")}
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
  tone: "revenue" | "expense" | "profit" | "loss";
}) {
  return (
    <div
      className={clsx(
        "rounded-lg border p-4",
        tone === "revenue" && "border-emerald-100 bg-emerald-50",
        tone === "expense" && "border-rose-100 bg-rose-50",
        tone === "profit" && "border-sky-100 bg-sky-50",
        tone === "loss" && "border-amber-100 bg-amber-50",
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-600">
        {tone === "revenue" ? (
          <TrendingUp className="h-4 w-4" />
        ) : (
          <Calculator className="h-4 w-4" />
        )}
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
}: {
  title: string;
  rows: IncomeStatementRow[];
  locale: Language;
  emptyText: string;
  codeLabel: string;
  accountLabel: string;
  debitLabel: string;
  creditLabel: string;
  amountLabel: string;
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
          {rows.length === 0 ? (
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
