"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, BookOpen, Loader2, RefreshCw, Search } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useI18n, type Language } from "@/lib/i18n";

type AccountOption = {
  id: string;
  code: string;
  name: string;
  type: string;
};

type GeneralLedgerLine = {
  lineId: string;
  journalEntryId: string;
  entryNo: string;
  date: string;
  ref: string | null;
  description: string | null;
  lineNo: number;
  partnerName: string | null;
  memo: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
};

type GeneralLedgerAccount = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  endingBalance: number;
  lines: GeneralLedgerLine[];
};

type GeneralLedgerData = {
  startDate: string | null;
  endDate: string;
  accountCode: string | null;
  totalOpeningBalance: number;
  totalDebit: number;
  totalCredit: number;
  totalEndingBalance: number;
  accounts: GeneralLedgerAccount[];
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

function dateText(value: string) {
  return value.slice(0, 10);
}

function money(value: number, language: Language) {
  return value === 0 ? "-" : formatCurrency(value, language);
}

export function GeneralLedgerView() {
  const { t, language } = useI18n();
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(monthEnd());
  const [accountCode, setAccountCode] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [data, setData] = useState<GeneralLedgerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ledgerResponse, accountResponse] = await Promise.all([
        api.get<GeneralLedgerData>("/finance/general-ledger", {
          params: {
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            accountCode: accountCode || undefined,
          },
        }),
        api.get<AccountOption[]>("/finance/account-options"),
      ]);
      setData(ledgerResponse.data);
      setAccounts(accountResponse.data);
    } catch (reason: unknown) {
      setError(readApiError(reason, t("generalLedgerLoadFailed")));
    } finally {
      setLoading(false);
    }
  }, [accountCode, endDate, startDate, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {t("generalLedgerTitle")}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {t("generalLedgerHint")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={accountCode}
            onChange={(event) => setAccountCode(event.target.value)}
            className="min-w-56 rounded-md border border-slate-300 p-2 text-sm"
            aria-label={t("generalLedgerAccountFilter")}
          >
            <option value="">{t("generalLedgerAllAccounts")}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.code}>
                {account.code} {account.name} / {account.type}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="rounded-md border border-slate-300 p-2 text-sm"
            aria-label={t("generalLedgerStartDate")}
          />
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="rounded-md border border-slate-300 p-2 text-sm"
            aria-label={t("generalLedgerEndDate")}
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
            {t("commonRefresh")}
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
          <div className="grid gap-3 md:grid-cols-5">
            <SummaryTile
              label={t("generalLedgerAccountCount")}
              value={String(data.accounts.length)}
              icon={<BookOpen className="h-4 w-4" />}
            />
            <SummaryTile
              label={t("generalLedgerOpeningBalance")}
              value={formatCurrency(data.totalOpeningBalance, language)}
              icon={<Search className="h-4 w-4" />}
            />
            <SummaryTile
              label={t("generalLedgerDebit")}
              value={formatCurrency(data.totalDebit, language)}
              icon={<BookOpen className="h-4 w-4" />}
            />
            <SummaryTile
              label={t("generalLedgerCredit")}
              value={formatCurrency(data.totalCredit, language)}
              icon={<BookOpen className="h-4 w-4" />}
            />
            <SummaryTile
              label={t("generalLedgerEndingBalance")}
              value={formatCurrency(data.totalEndingBalance, language)}
              icon={<Search className="h-4 w-4" />}
            />
          </div>

          {data.accounts.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
              <AlertCircle className="mb-2 h-5 w-5 text-slate-300" />
              {t("generalLedgerNoRows")}
            </div>
          ) : (
            data.accounts.map((account) => (
              <AccountLedgerTable
                key={account.accountId}
                account={account}
                language={language}
                t={t}
              />
            ))
          )}
        </>
      ) : null}
    </section>
  );
}

function SummaryTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function AccountLedgerTable({
  account,
  language,
  t,
}: {
  account: GeneralLedgerAccount;
  language: Language;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {account.code} / {account.name}
          </div>
          <div className="mt-1 text-xs text-slate-500">{account.type}</div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-right text-xs text-slate-500 md:grid-cols-4">
          <span>
            {t("generalLedgerOpeningBalance")}:{" "}
            <strong className="text-slate-900">
              {formatCurrency(account.openingBalance, language)}
            </strong>
          </span>
          <span>
            {t("generalLedgerDebit")}:{" "}
            <strong className="text-slate-900">
              {formatCurrency(account.periodDebit, language)}
            </strong>
          </span>
          <span>
            {t("generalLedgerCredit")}:{" "}
            <strong className="text-slate-900">
              {formatCurrency(account.periodCredit, language)}
            </strong>
          </span>
          <span>
            {t("generalLedgerEndingBalance")}:{" "}
            <strong className="text-slate-900">
              {formatCurrency(account.endingBalance, language)}
            </strong>
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[920px] divide-y divide-slate-200 text-sm">
          <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">{t("date")}</th>
              <th className="px-3 py-2 text-left">{t("generalLedgerEntry")}</th>
              <th className="px-3 py-2 text-left">
                {t("generalLedgerPartner")}
              </th>
              <th className="px-3 py-2 text-left">{t("generalLedgerMemo")}</th>
              <th className="px-3 py-2 text-right">
                {t("generalLedgerDebit")}
              </th>
              <th className="px-3 py-2 text-right">
                {t("generalLedgerCredit")}
              </th>
              <th className="px-3 py-2 text-right">
                {t("generalLedgerRunningBalance")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {account.lines.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-sm text-slate-500"
                >
                  {t("generalLedgerNoRows")}
                </td>
              </tr>
            ) : (
              account.lines.map((line) => (
                <tr key={line.lineId} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-700">
                    {dateText(line.date)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">
                      {line.entryNo}
                    </div>
                    <div className="text-xs text-slate-500">
                      {line.ref ?? "-"} / {line.description ?? "-"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {line.partnerName ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {line.memo ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">
                    {money(line.debit, language)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">
                    {money(line.credit, language)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-slate-950">
                    {formatCurrency(line.runningBalance, language)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
